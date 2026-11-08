package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

/**
 * Mail management follows the PRD's local-first rule: the cache changes
 * immediately, then a durable `pending_ops` row is replayed against IMAP.
 * A restart, a laptop that was asleep or a captive portal cannot lose the
 * operation — the flusher retries on the next successful check/sync. Only a
 * permanent failure (message gone, folder missing) rolls the cache back.
 */

var errOpPermanent = errors.New("操作无法在服务器上完成")

// Settings live in `metadata`, the same key/value table as the inbox
// checkpoints, so no schema change is needed for a preferences pane.
func (s *MailService) GetSettings() Settings {
	var raw string
	err := s.db.QueryRow("SELECT value FROM metadata WHERE key='settings'").Scan(&raw)
	if err != nil {
		return defaultSettings()
	}
	var v Settings
	if json.Unmarshal([]byte(raw), &v) != nil {
		return defaultSettings()
	}
	return v.normalised()
}

func (s *MailService) SetSettings(v Settings) (Settings, error) {
	v = v.normalised()
	raw, err := json.Marshal(v)
	if err != nil {
		return v, err
	}
	if _, err = s.db.Exec("INSERT INTO metadata VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(raw)); err != nil {
		return v, errors.New("设置保存失败")
	}
	// Lowering the cap takes effect immediately, not on the next sync.
	if _, err = s.trimCache(); err != nil {
		slog.Warn("mail.cache.trim.failed")
	}
	select {
	case s.settingsChanged <- struct{}{}:
	default:
	}
	return v, nil
}

type PendingOp struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"` // seen | flagged | move | delete
	MessageID string   `json:"messageId"`
	AccountID string   `json:"accountId"`
	Folder    string   `json:"folder"`
	UID       uint32   `json:"uid"`
	Validity  uint32   `json:"validity"`
	Value     bool     `json:"value"`
	Target    string   `json:"target"`
	Permanent bool     `json:"permanent"`
	Before    *Message `json:"before,omitempty"`
	Attempts  int      `json:"attempts"`
	LastError string   `json:"lastError"`
	CreatedAt string   `json:"createdAt"`
}

func (s *MailService) pendingOps(accountID string) ([]PendingOp, error) {
	query := "SELECT data FROM pending_ops"
	args := []any{}
	if accountID != "" {
		query += " WHERE account_id=?"
		args = append(args, accountID)
	}
	query += " ORDER BY created_at"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []PendingOp{}
	for rows.Next() {
		var raw string
		var op PendingOp
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if json.Unmarshal([]byte(raw), &op) == nil {
			result = append(result, op)
		}
	}
	return result, rows.Err()
}

func (s *MailService) writeOp(op PendingOp) error {
	raw, err := json.Marshal(op)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("INSERT INTO pending_ops VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", op.ID, op.AccountID, op.MessageID, op.CreatedAt, string(raw))
	return err
}

func (s *MailService) PendingCount() int {
	ops, _ := s.pendingOps("")
	return len(ops)
}

func (s *MailService) finishOp(id string) {
	_, _ = s.db.Exec("DELETE FROM pending_ops WHERE id=?", id)
}

func (s *MailService) failOp(op PendingOp, err error) {
	op.Attempts++
	op.LastError = err.Error()
	_ = s.writeOp(op)
}

func permanentOpError(err error) error {
	return fmt.Errorf("%w: %v", errOpPermanent, err)
}

func (s *MailService) rollbackOp(op PendingOp) {
	if op.Before != nil {
		_ = s.putMessage(*op.Before)
		return
	}
	_, _ = s.db.Exec("DELETE FROM messages WHERE id=?", op.MessageID)
}

// applyLocal makes the optimistic change visible to the UI at once.
func (s *MailService) applyLocal(op PendingOp) error {
	if op.Kind == "move" || op.Kind == "delete" {
		_, err := s.db.Exec("DELETE FROM messages WHERE id=?", op.MessageID)
		return err
	}
	m, err := s.cached(op.MessageID)
	if err != nil {
		return err
	}
	if op.Kind == "seen" {
		m.Seen = op.Value
	} else {
		m.Flagged = op.Value
	}
	return s.putMessage(m)
}

// reconcilePending stops the next header sync from undoing an operation that
// is still waiting for the server (or adding a deleted message back).
func (s *MailService) reconcilePending(accountID string) {
	ops, err := s.pendingOps(accountID)
	if err != nil {
		return
	}
	for _, op := range ops {
		if op.Kind == "seen" || op.Kind == "flagged" {
			m, e := s.cached(op.MessageID)
			if e != nil {
				continue
			}
			if op.Kind == "seen" {
				m.Seen = op.Value
			} else {
				m.Flagged = op.Value
			}
			_ = s.putMessage(m)
		} else {
			_, _ = s.db.Exec("DELETE FROM messages WHERE id=?", op.MessageID)
		}
	}
}

// flushPending replays the queue. One connection failure stops the pass: the
// remaining rows keep their place and the next successful check tries again.
func (s *MailService) flushPending(parent context.Context) {
	if !s.flushMu.TryLock() {
		return
	}
	defer s.flushMu.Unlock()
	ops, err := s.pendingOps("")
	if err != nil || len(ops) == 0 {
		return
	}
	changed := false
	for _, op := range ops {
		if parent.Err() != nil {
			return
		}
		ctx, cancel := context.WithTimeout(parent, 30*time.Second)
		e := s.applyRemote(ctx, op)
		cancel()
		if e == nil {
			s.finishOp(op.ID)
			changed = true
			continue
		}
		if errors.Is(e, errOpPermanent) {
			slog.Warn("mail.op.dropped", "result", "permanent")
			s.rollbackOp(op)
			s.finishOp(op.ID)
			changed = true
			continue
		}
		s.failOp(op, e)
		return
	}
	if changed {
		s.publishDesktop()
		s.requestMailCheck()
	}
}

func (s *MailService) applyRemote(parent context.Context, op PendingOp) error {
	a, password, err := s.credentials(op.AccountID)
	if err != nil {
		return err
	}
	if a.Demo {
		return nil
	}
	c, err := imapConnect(a, password)
	if err != nil {
		return err
	}
	defer c.Close()
	return applyRemoteOnClient(c, op)
}

// applyRemoteOnClient is split out so the protocol half can be exercised on a
// local IMAP test server without touching the system keychain.
func applyRemoteOnClient(c *imapclient.Client, op PendingOp) error {
	box, err := c.Select(op.Folder, nil).Wait()
	if err != nil {
		return err
	}
	if box.UIDValidity != op.Validity {
		return permanentOpError(errors.New("邮件标识变化"))
	}
	set := imap.UIDSetNum(imap.UID(op.UID))
	switch op.Kind {
	case "seen", "flagged":
		flag := imap.FlagSeen
		if op.Kind == "flagged" {
			flag = imap.FlagFlagged
		}
		mode := imap.StoreFlagsAdd
		if !op.Value {
			mode = imap.StoreFlagsDel
		}
		rows, e := c.Store(set, &imap.StoreFlags{Op: mode, Flags: []imap.Flag{flag}}, nil).Collect()
		if e != nil {
			return e
		}
		if len(rows) == 0 {
			return permanentOpError(errors.New("服务器上找不到这封邮件"))
		}
		return nil
	case "move":
		if _, e := c.Move(set, op.Target).Wait(); e != nil {
			return e
		}
		return nil
	case "delete":
		if !op.Permanent {
			if _, e := c.Move(set, op.Target).Wait(); e != nil {
				return e
			}
			return nil
		}
		rows, e := c.Store(set, &imap.StoreFlags{Op: imap.StoreFlagsAdd, Flags: []imap.Flag{imap.FlagDeleted}}, nil).Collect()
		if e != nil {
			return e
		}
		if len(rows) == 0 {
			return permanentOpError(errors.New("服务器上找不到这封邮件"))
		}
		if c.Caps().Has(imap.CapUIDPlus) || c.Caps().Has(imap.CapIMAP4rev2) {
			_, e = c.UIDExpunge(set).Collect()
			return e
		}
		// EXPUNGE would erase every \Deleted message in the mailbox, not just
		// this one. Refuse instead of deleting somebody else's mail.
		return permanentOpError(errors.New("服务器不支持按 UID 永久删除"))
	}
	return permanentOpError(errors.New("未知操作"))
}

// specialFolder finds a mailbox by SPECIAL-USE role, with the usual Chinese
// and English names as a fallback for servers that do not advertise it.
func specialFolder(c *imapclient.Client, role string) (string, error) {
	options := &imap.ListOptions{}
	if c.Caps().Has(imap.CapSpecialUse) {
		options.ReturnSpecialUse = true
	}
	list, err := c.List("", "*", options).Collect()
	if err != nil {
		return "", err
	}
	fallback := []string{}
	switch role {
	case "trash":
		fallback = []string{"trash", "deleted", "已删除", "垃圾箱"}
	case "sent":
		fallback = []string{"sent", "sent items", "sent messages", "已发送"}
	}
	for _, v := range list {
		if folderInfo(v).Selectable && folderInfo(v).Role == role {
			return v.Mailbox, nil
		}
	}
	for _, v := range list {
		lower := strings.ToLower(v.Mailbox)
		for _, hint := range fallback {
			if strings.Contains(lower, hint) && folderInfo(v).Selectable {
				return v.Mailbox, nil
			}
		}
	}
	return "", fmt.Errorf("找不到%s文件夹", map[string]string{"trash": "已删除", "sent": "已发送"}[role])
}

func (s *MailService) trashFolder(a Account, password string) (string, error) {
	c, err := imapConnect(a, password)
	if err != nil {
		return "", err
	}
	defer c.Close()
	return specialFolder(c, "trash")
}

// beginOp is shared by the four management actions. The id is deterministic
// so tapping "star" twice leaves one pending row with the latest value.
func (s *MailService) beginOp(id, kind string, value bool, target string, permanent bool) (string, error) {
	m, err := s.cached(id)
	if err != nil {
		return "", err
	}
	a, err := s.account(m.AccountID)
	if err != nil {
		return "", err
	}
	before := m
	op := PendingOp{
		ID:        fmt.Sprintf("%s:%s:%s", m.AccountID, m.ID, kind),
		Kind:      kind,
		MessageID: m.ID,
		AccountID: m.AccountID,
		Folder:    m.Folder,
		UID:       m.UID,
		Validity:  m.Validity,
		Value:     value,
		Target:    target,
		Permanent: permanent,
		Before:    &before,
		CreatedAt: time.Now().Format(time.RFC3339Nano),
	}
	if err = s.applyLocal(op); err != nil {
		return "", err
	}
	if a.Demo {
		s.publishDesktop()
		return "已在本地示例中更新（示例不会写入服务器）", nil
	}
	if err = s.writeOp(op); err != nil {
		s.rollbackOp(op)
		return "", errors.New("无法保存待同步操作")
	}
	s.publishDesktop()
	go s.flushPending(context.Background())
	return "已在本机生效，正在同步到服务器", nil
}

func (s *MailService) SetSeen(id string, seen bool) (string, error) {
	return s.beginOp(id, "seen", seen, "", false)
}

func (s *MailService) SetFlagged(id string, flagged bool) (string, error) {
	return s.beginOp(id, "flagged", flagged, "", false)
}

// MarkRead is kept for the reader's "open marks as read" path.
func (s *MailService) MarkRead(id string) error {
	_, err := s.SetSeen(id, true)
	return err
}

func (s *MailService) DeleteMessage(id string, permanent bool) (result string, err error) {
	m, err := s.cached(id)
	if err != nil {
		return "", err
	}
	target := ""
	if !permanent {
		a, password, e := s.credentials(m.AccountID)
		if e != nil && !a.Demo {
			return "", e
		}
		if !a.Demo {
			target, err = s.trashFolder(a, password)
			if err != nil {
				return "", err
			}
			if strings.EqualFold(target, m.Folder) {
				return "", errors.New("这封邮件已在已删除文件夹，请确认永久删除")
			}
		}
	}
	return s.beginOp(id, "delete", false, target, permanent)
}

func (s *MailService) MoveMessage(id, folder string) (string, error) {
	folder = strings.TrimSpace(folder)
	if folder == "" || strings.ContainsAny(folder, "\r\n") {
		return "", errors.New("请选择有效的目标文件夹")
	}
	m, err := s.cached(id)
	if err != nil {
		return "", err
	}
	if folder == m.Folder {
		return "", errors.New("邮件已经在这个文件夹里")
	}
	return s.beginOp(id, "move", false, folder, false)
}

// FoldersForMove is the picker data for the reader toolbar; it filters out
// the current folder and non-selectable entries.
func (s *MailService) FoldersForMove(id, current string) ([]FolderInfo, error) {
	all, err := s.Folders(id)
	if err != nil {
		return nil, err
	}
	result := []FolderInfo{}
	for _, f := range all {
		if f.Selectable && f.Name != current {
			result = append(result, f)
		}
	}
	return result, nil
}
