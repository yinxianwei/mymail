package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Account struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	IMAPHost string `json:"imapHost"`
	IMAPPort int    `json:"imapPort"`
	IMAPTLS  string `json:"imapTLS"`
	SMTPHost string `json:"smtpHost"`
	SMTPPort int    `json:"smtpPort"`
	SMTPTLS  string `json:"smtpTLS"`
	Demo     bool   `json:"demo"`
}
type AccountInput struct {
	Account
	Password string `json:"password"`
}
type Message struct {
	ID          string       `json:"id"`
	AccountID   string       `json:"accountId"`
	Folder      string       `json:"folder"`
	UID         uint32       `json:"uid"`
	Validity    uint32       `json:"validity"`
	Subject     string       `json:"subject"`
	From        string       `json:"from"`
	To          string       `json:"to"`
	Date        string       `json:"date"`
	Seen        bool         `json:"seen"`
	Flagged     bool         `json:"flagged"`
	Text        string       `json:"text"`
	HTML        string       `json:"html"`
	Cached      bool         `json:"cached"`
	Attachments []Attachment `json:"attachments"`
}

// Attachment is one MIME part that is not the message body. The bytes are kept
// in the attachments table so a download works offline; Index is the position
// inside the message, which is what the reader sends back when saving.
type Attachment struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Index int    `json:"index"`
}

// UnmarshalJSON also accepts the `["name"]` form written by older builds,
// which only listed filenames and kept no bytes.
func (a *Attachment) UnmarshalJSON(raw []byte) error {
	if trimmed := bytes.TrimSpace(raw); len(trimmed) > 0 && trimmed[0] == '"' {
		var name string
		if err := json.Unmarshal(trimmed, &name); err != nil {
			return err
		}
		*a = Attachment{Name: name}
		return nil
	}
	type plain Attachment
	var value plain
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	*a = Attachment(value)
	return nil
}

// UnmarshalJSON trusts the position in the array over the stored index: the
// filename-only rows written by older builds all carry index 0, and the reader
// needs distinct indices to open the right part.
func (m *Message) UnmarshalJSON(raw []byte) error {
	type plain Message
	shadow := struct {
		*plain
		Attachments []json.RawMessage `json:"attachments"`
	}{plain: (*plain)(m)}
	if err := json.Unmarshal(raw, &shadow); err != nil {
		return err
	}
	m.Attachments = make([]Attachment, 0, len(shadow.Attachments))
	for i, item := range shadow.Attachments {
		var attachment Attachment
		if err := json.Unmarshal(item, &attachment); err != nil {
			return err
		}
		attachment.Index = i
		m.Attachments = append(m.Attachments, attachment)
	}
	return nil
}

// DraftAttachment points at a file the reader picked in the native open panel.
// Only the path travels through IPC; the bytes are read by Go when sending so
// the webview never gets raw file contents.
type DraftAttachment struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	Path string `json:"path"`
}

type Draft struct {
	SenderAccountID string            `json:"senderAccountId,omitempty"`
	AccountID       string            `json:"accountId"`
	Key             string            `json:"key"`
	To              string            `json:"to"`
	Cc              string            `json:"cc"`
	Bcc             string            `json:"bcc"`
	Subject         string            `json:"subject"`
	Body            string            `json:"body"`
	Attachments     []DraftAttachment `json:"attachments"`
}

// Settings live in `metadata`; CacheLimit is the number of cached message
// headers kept per account/folder (0 keeps everything).
type Settings struct {
	SyncIntervalSec int    `json:"syncIntervalSec"`
	AutoMarkRead    bool   `json:"autoMarkRead"`
	RemoteDefault   string `json:"remoteDefault"`
	AppendSent      bool   `json:"appendSent"`
	CacheLimit      int    `json:"cacheLimit"`
}

func defaultSettings() Settings {
	return Settings{SyncIntervalSec: 60, AutoMarkRead: true, RemoteDefault: "trusted", AppendSent: false, CacheLimit: 2000}
}

func (v Settings) normalised() Settings {
	if v.SyncIntervalSec < 15 {
		v.SyncIntervalSec = 15
	}
	if v.SyncIntervalSec > 600 {
		v.SyncIntervalSec = 600
	}
	if v.CacheLimit < 0 {
		v.CacheLimit = 0
	}
	if v.CacheLimit > 20000 {
		v.CacheLimit = 20000
	}
	switch v.RemoteDefault {
	case "always", "never", "trusted":
	default:
		v.RemoteDefault = "trusted"
	}
	return v
}

type Snapshot struct {
	Accounts []Account `json:"accounts"`
	Database string    `json:"database"`
}
type MailService struct {
	translationMu      sync.Mutex
	translationCancels map[string]context.CancelFunc
	translateText      func(context.Context, nativeTranslationRequest) (nativeTranslationResponse, error)
	db                 *sql.DB
	path               string
	network            sync.Mutex
	sending            sync.Mutex
	monitorMu          sync.Mutex
	desktopMu          sync.RWMutex
	desktop            DesktopState
	inboxes            map[string]InboxCheckpoint
	checkRequests      chan struct{}
	idleMu             sync.Mutex
	idleStops          map[string]context.CancelFunc
	settingsChanged    chan struct{}
	flushMu            sync.Mutex
	mailTarget         MailTarget
	desktopChanged     func(DesktopState)
	newMail            func(newMailNotice)
	openMail           func()
	composeMailto      func(Draft)
	testNotification   func(context.Context) error
	systemLanguages    func() []string
	changeLocale       func(string)
}

func openService(path string) (*MailService, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL, validity INTEGER NOT NULL, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS drafts(account_id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS folders(account_id TEXT NOT NULL, name TEXT NOT NULL, validity INTEGER NOT NULL, PRIMARY KEY(account_id,name));
 CREATE TABLE IF NOT EXISTS sent(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, raw BLOB NOT NULL, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attachments(message_id TEXT NOT NULL, idx INTEGER NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(message_id, idx));
 CREATE TABLE IF NOT EXISTS drafts_v2(account_id TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_id,key));
 CREATE TABLE IF NOT EXISTS pending_ops(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, message_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	_ = os.Chmod(path, 0600)
	service := &MailService{db: db, path: path, settingsChanged: make(chan struct{}, 1)}
	if err = service.migrateDrafts(); err != nil {
		db.Close()
		return nil, err
	}
	if err = service.repairCachedHeaders(); err != nil {
		db.Close()
		return nil, err
	}
	if err = service.initMonitor(); err != nil {
		db.Close()
		return nil, err
	}
	// Enforce the cap at startup too: a laptop that was offline for weeks can
	// have a cache far beyond the limit before the next sync happens.
	if _, err = service.trimCache(); err != nil {
		slog.Warn("mail.cache.startup.trim.failed")
	}
	return service, nil
}

// Older builds kept exactly one draft per account in `drafts`. Copy it into
// the keyed table under "new" so reopening 写邮件 after an upgrade still finds
// the text; from then on only drafts_v2 is used.
func (s *MailService) migrateDrafts() error {
	rows, err := s.db.Query("SELECT account_id, data FROM drafts")
	if err != nil {
		return err
	}
	defer rows.Close()
	type legacy struct{ account, data string }
	old := []legacy{}
	for rows.Next() {
		var item legacy
		if err = rows.Scan(&item.account, &item.data); err != nil {
			return err
		}
		old = append(old, item)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	rows.Close()
	now := time.Now().Format(time.RFC3339)
	for _, item := range old {
		var d Draft
		if json.Unmarshal([]byte(item.data), &d) != nil {
			continue
		}
		d.Key = "new"
		raw, _ := json.Marshal(d)
		if _, err = s.db.Exec("INSERT OR IGNORE INTO drafts_v2 VALUES(?,?,?,?)", item.account, "new", string(raw), now); err != nil {
			return err
		}
		// Drop the legacy row. Otherwise a later ClearDraft on "new" would be
		// undone by the next restart resurrecting this old draft.
		if _, err = s.db.Exec("DELETE FROM drafts WHERE account_id=?", item.account); err != nil {
			return err
		}
	}
	return nil
}

func (s *MailService) State() (Snapshot, error) {
	result := Snapshot{Accounts: []Account{}, Database: s.path}
	rows, err := s.db.Query("SELECT data FROM accounts ORDER BY id")
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		var a Account
		if err = rows.Scan(&raw); err != nil {
			return result, err
		}
		if err = json.Unmarshal([]byte(raw), &a); err != nil {
			return result, err
		}
		result.Accounts = append(result.Accounts, a)
	}
	return result, rows.Err()
}
func (s *MailService) account(id string) (Account, error) {
	var a Account
	var raw string
	err := s.db.QueryRow("SELECT data FROM accounts WHERE id=?", id).Scan(&raw)
	if err != nil {
		return a, errors.New("账号不存在")
	}
	err = json.Unmarshal([]byte(raw), &a)
	return a, err
}
func (s *MailService) putMessage(m Message) error {
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO messages VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", m.ID, m.AccountID, m.Folder, m.UID, m.Validity, string(raw))
	return err
}

// bodyPart is one attachment as it came off the wire: the decoded filename and
// the decoded bytes, nothing about where it sat in the MIME tree.
type bodyPart struct {
	Name string
	Data []byte
}

// putAttachments replaces the stored parts of one message. An empty slice is
// still a write: a re-read that finds no attachments must clear the old ones.
func (s *MailService) putAttachments(messageID string, parts []bodyPart) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM attachments WHERE message_id=?", messageID); err != nil {
		tx.Rollback()
		return err
	}
	for i, part := range parts {
		if _, err = tx.Exec("INSERT INTO attachments VALUES(?,?,?,?,?)", messageID, i, part.Name, len(part.Data), part.Data); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// storedAttachment reads one part back; sql.ErrNoRows means the bytes were
// never cached (messages read before this version, or a cleared cache).
func (s *MailService) storedAttachment(messageID string, index int) (bodyPart, error) {
	var part bodyPart
	err := s.db.QueryRow("SELECT name, data FROM attachments WHERE message_id=? AND idx=?", messageID, index).Scan(&part.Name, &part.Data)
	return part, err
}
func (s *MailService) Messages(accountID, folder string) ([]Message, error) {
	rows, err := s.db.Query("SELECT json_remove(data,'$.text','$.html') FROM messages WHERE account_id=? AND folder=? ORDER BY uid DESC", accountID, folder)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Message{}
	for rows.Next() {
		var raw string
		var m Message
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &m); err != nil {
			return nil, err
		}
		m.Text = ""
		m.HTML = ""
		result = append(result, m)
	}
	return result, rows.Err()
}

// AllInboxMessages merges cached inboxes without mixing in sent, draft or trash
// folders. UIDs remain scoped to their account; bodies are not sent in the list.
func (s *MailService) AllInboxMessages() ([]Message, error) {
	rows, err := s.db.Query(`SELECT json_remove(m.data,'$.text','$.html') FROM messages m
 JOIN accounts a ON a.id=m.account_id WHERE m.folder='INBOX' COLLATE NOCASE
 ORDER BY julianday(json_extract(m.data,'$.date')) DESC,m.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Message{}
	for rows.Next() {
		var raw string
		var message Message
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(raw), &message); err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	return result, rows.Err()
}
func (s *MailService) cached(id string) (Message, error) {
	var raw string
	var m Message
	err := s.db.QueryRow("SELECT data FROM messages WHERE id=?", id).Scan(&raw)
	if err != nil {
		return m, errors.New("邮件不在本地缓存中")
	}
	err = json.Unmarshal([]byte(raw), &m)
	return m, err
}
func draftKey(d Draft) string {
	if d.Key == "" {
		return "new"
	}
	return d.Key
}

func (s *MailService) SaveDraft(d Draft) error {
	if _, err := s.account(d.AccountID); err != nil {
		return err
	}
	key := draftKey(d)
	d.Key = key
	raw, err := json.Marshal(d)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO drafts_v2 VALUES(?,?,?,?) ON CONFLICT(account_id,key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at", d.AccountID, key, string(raw), time.Now().Format(time.RFC3339))
	return err
}

func (s *MailService) GetDraft(accountID, key string) (Draft, error) {
	if key == "" {
		key = "new"
	}
	d := Draft{AccountID: accountID, Key: key, Attachments: []DraftAttachment{}}
	var raw string
	err := s.db.QueryRow("SELECT data FROM drafts_v2 WHERE account_id=? AND key=?", accountID, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return d, nil
	}
	if err != nil {
		return d, err
	}
	err = json.Unmarshal([]byte(raw), &d)
	if d.Key == "" {
		d.Key = key
	}
	return d, err
}

// ListDrafts powers the "继续编辑" hints; a reply draft is kept separately for
// every message instead of overwriting the one blank-message draft.
func (s *MailService) ListDrafts(accountID string) ([]Draft, error) {
	rows, err := s.db.Query("SELECT data FROM drafts_v2 WHERE account_id=? ORDER BY updated_at DESC", accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Draft{}
	for rows.Next() {
		var raw string
		var d Draft
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if json.Unmarshal([]byte(raw), &d) == nil {
			result = append(result, d)
		}
	}
	return result, rows.Err()
}

func (s *MailService) ClearDraft(accountID, key string) error {
	if key == "" {
		key = "new"
	}
	_, err := s.db.Exec("DELETE FROM drafts_v2 WHERE account_id=? AND key=?", accountID, key)
	return err
}
func (s *MailService) LoadDemo() (Account, error) {
	a := Account{ID: "local-demo", Email: "本地示例", Demo: true}
	raw, _ := json.Marshal(a)
	if _, err := s.db.Exec("INSERT OR IGNORE INTO accounts VALUES(?,?)", a.ID, string(raw)); err != nil {
		return a, err
	}
	m := Message{ID: "local-demo:INBOX:1:1", AccountID: a.ID, Folder: "INBOX", UID: 1, Validity: 1, Subject: "欢迎使用 My Mail", From: "My Mail <hello@example.invalid>", To: "you@example.invalid", Date: time.Now().Format(time.RFC3339), Cached: true, Attachments: []Attachment{}, Text: "这封示例邮件由 Go 写入 SQLite，经类型化 IPC 读取。断开网络、重启应用后，仍可阅读。\n\n添加真实邮箱后，可手动同步最近 50 封邮件，按需获取正文，并发送纯文本邮件。", HTML: "<h2>让邮件回到简单。</h2><p>这是一封保存在本机 SQLite 的示例邮件。</p><p>前端继承 <strong>Gr8r</strong> 的组件与主题，通过 MyGo 与 Go 通信。</p><p>远程图片与外部资源默认被阻止。</p><img src='https://example.invalid/tracker.png'><script>document.body.textContent='unsafe'</script>"}
	return a, s.putMessage(m)
}
