package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"mime"
	"net"
	stdmail "net/mail"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/egoist/mygo"
	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	_ "github.com/emersion/go-message/charset"
	"github.com/emersion/go-message/mail"
	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
)

const operationTimeout = 35 * time.Second
const maxBodyBytes = 8 << 20

func (s *MailService) OpenLink(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil {
		slog.Warn("mail.openlink.rejected", "result", "invalid")
		return errors.New("只允许打开 HTTP 或 HTTPS 链接")
	}
	// The host is enough to tell whether a click reached the app; the address
	// itself may carry a token and never goes to the log.
	if err := mygo.Shell.OpenExternal(u.String()); err != nil {
		slog.Warn("mail.openlink.finished", "host", u.Host, "result", "failed")
		return errors.New("系统浏览器未能打开该链接")
	}
	slog.Info("mail.openlink.finished", "host", u.Host, "result", "ok")
	return nil
}

func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func validateAccount(a Account) error {
	parsed, err := stdmail.ParseAddress(a.Email)
	if err != nil || parsed.Address != a.Email {
		return errors.New("请输入有效的邮箱地址")
	}
	for _, v := range []struct {
		host string
		port int
		mode string
	}{{a.IMAPHost, a.IMAPPort, a.IMAPTLS}, {a.SMTPHost, a.SMTPPort, a.SMTPTLS}} {
		if strings.TrimSpace(v.host) == "" || strings.ContainsAny(v.host, " /\r\n@?#") || v.port < 1 || v.port > 65535 {
			return errors.New("请检查服务器地址和端口")
		}
		if v.mode != "tls" && v.mode != "starttls" {
			return errors.New("仅支持 TLS 或 STARTTLS 加密连接")
		}
	}
	return nil
}

// Generic errors deliberately exclude server response text, which may contain credentials.
func imapConnect(a Account, password string) (*imapclient.Client, error) {
	return imapConnectWithTLS(a, password, &tls.Config{ServerName: a.IMAPHost, MinVersion: tls.VersionTLS12})
}
func imapConnectWithTLS(a Account, password string, cfg *tls.Config) (*imapclient.Client, error) {
	return imapConnectContext(context.Background(), a, password, cfg)
}
func imapConnectContext(ctx context.Context, a Account, password string, cfg *tls.Config) (*imapclient.Client, error) {
	addr := net.JoinHostPort(a.IMAPHost, strconv.Itoa(a.IMAPPort))
	done := connectionStep(ctx, "imap", "tcp")
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", addr)
	done(err)
	if err != nil {
		return nil, errors.New("IMAP 无法连接，请检查服务器、端口和网络")
	}
	_ = conn.SetDeadline(time.Now().Add(operationTimeout))
	timer := time.AfterFunc(operationTimeout, func() { conn.Close() })
	context.AfterFunc(ctx, func() { conn.Close() })
	var c *imapclient.Client
	if a.IMAPTLS == "tls" {
		secure := tls.Client(conn, cfg)
		done = connectionStep(ctx, "imap", "tls")
		err = secure.HandshakeContext(ctx)
		done(err)
		if err != nil {
			conn.Close()
			return nil, errors.New("IMAP TLS 证书或握手失败")
		}
		c = imapclient.New(secure, &imapclient.Options{WordDecoder: headerDecoder()})
	} else {
		done = connectionStep(ctx, "imap", "starttls")
		c, err = imapclient.NewStartTLS(conn, &imapclient.Options{TLSConfig: cfg, WordDecoder: headerDecoder()})
		done(err)
		if err != nil {
			conn.Close()
			return nil, errors.New("IMAP STARTTLS 失败，未发送凭证")
		}
	}
	// Read the greeting before authentication; some servers discard an early LOGIN.
	done = connectionStep(ctx, "imap", "greeting")
	err = c.WaitGreeting()
	done(err)
	if err != nil {
		timer.Stop()
		c.Close()
		return nil, errors.New("IMAP 服务器欢迎响应失败，请检查端口与加密方式")
	}
	// The absolute operation deadline also bounds servers that never finish a response.
	done = connectionStep(ctx, "imap", "authentication")
	err = c.Login(a.Email, password).Wait()
	done(err)
	if err != nil {
		timer.Stop()
		c.Close()
		return nil, errors.New("IMAP 认证失败，请检查授权码并确认已开启 IMAP")
	}
	// Closing the connection ends the timer's only side effect; it cannot affect a later connection.
	return c, nil
}
func smtpConnect(a Account, password string) (*smtp.Client, error) {
	return smtpConnectWithTLS(a, password, &tls.Config{ServerName: a.SMTPHost, MinVersion: tls.VersionTLS12})
}
func smtpConnectWithTLS(a Account, password string, cfg *tls.Config) (*smtp.Client, error) {
	return smtpConnectContext(context.Background(), a, password, cfg)
}
func smtpConnectContext(ctx context.Context, a Account, password string, cfg *tls.Config) (*smtp.Client, error) {
	done := connectionStep(ctx, "smtp", "tcp")
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(a.SMTPHost, strconv.Itoa(a.SMTPPort)))
	done(err)
	if err != nil {
		return nil, errors.New("SMTP 无法连接，请检查服务器、端口和网络")
	}
	_ = conn.SetDeadline(time.Now().Add(operationTimeout))
	timer := time.AfterFunc(operationTimeout, func() { conn.Close() })
	context.AfterFunc(ctx, func() { conn.Close() })
	var c *smtp.Client
	if a.SMTPTLS == "tls" {
		secure := tls.Client(conn, cfg)
		done = connectionStep(ctx, "smtp", "tls")
		err = secure.HandshakeContext(ctx)
		done(err)
		if err != nil {
			conn.Close()
			return nil, errors.New("SMTP TLS 证书或握手失败")
		}
		c = smtp.NewClient(secure)
	} else {
		done = connectionStep(ctx, "smtp", "starttls")
		c, err = smtp.NewClientStartTLS(conn, cfg)
		done(err)
		if err != nil {
			conn.Close()
			return nil, errors.New("SMTP STARTTLS 失败，未发送凭证")
		}
	}
	c.CommandTimeout = 15 * time.Second
	c.SubmissionTimeout = 25 * time.Second
	done = connectionStep(ctx, "smtp", "authentication")
	err = c.Auth(sasl.NewPlainClient("", a.Email, password))
	done(err)
	if err != nil {
		timer.Stop()
		c.Close()
		return nil, errors.New("SMTP 认证失败，请检查授权码或服务商认证要求")
	}
	return c, nil
}

// TestConnection is bounded independently for each protocol and never saves credentials.
func (s *MailService) TestConnection(parent context.Context, in AccountInput, protocol, requestID string) error {
	if err := validateAccount(in.Account); err != nil {
		return err
	}
	if in.Password == "" {
		return errors.New("请输入授权码")
	}
	if protocol != "imap" && protocol != "smtp" {
		return errors.New("不支持的连接测试")
	}
	if len(requestID) > 64 || strings.ContainsAny(requestID, "\r\n") {
		return errors.New("无效测试编号")
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	ctx = context.WithValue(ctx, connectionTraceKey{}, requestID)
	started := time.Now()
	host, port, mode := in.IMAPHost, in.IMAPPort, in.IMAPTLS
	if protocol == "smtp" {
		host, port, mode = in.SMTPHost, in.SMTPPort, in.SMTPTLS
	}
	slog.Info("connection.test.started", "request_id", requestID, "protocol", protocol, "host", host, "port", port, "encryption", mode, "timeout_seconds", 15)
	var err error
	if protocol == "imap" {
		var c *imapclient.Client
		c, err = imapConnectContext(ctx, in.Account, in.Password, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
		if c != nil {
			_ = c.Close()
		}
	} else {
		var c *smtp.Client
		c, err = smtpConnectContext(ctx, in.Account, in.Password, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
		if c != nil {
			_ = c.Close()
		}
	}
	result := "ok"
	if errors.Is(ctx.Err(), context.Canceled) {
		result = "cancelled"
		err = errors.New("连接测试已取消")
	} else if ctx.Err() != nil {
		result = "timeout"
		err = fmt.Errorf("%s 连接测试超过 15 秒，请检查服务器、端口及 TLS/STARTTLS 设置（测试编号 %s）", strings.ToUpper(protocol), requestID)
	} else if err != nil {
		result = "failed"
	}
	slog.Info("connection.test.finished", "request_id", requestID, "protocol", protocol, "result", result, "duration_ms", time.Since(started).Milliseconds())
	return err
}
func (s *MailService) AddAccount(ctx context.Context, in AccountInput) (Account, error) {
	id := randomID()
	for _, protocol := range []string{"imap", "smtp"} {
		if err := s.TestConnection(ctx, in, protocol, id); err != nil {
			return Account{}, err
		}
	}
	return s.SaveAccount(in, id)
}

// SaveAccount follows the explicit, separately reported connection tests in the UI.
func (s *MailService) SaveAccount(in AccountInput, requestID string) (Account, error) {
	a := in.Account
	if err := validateAccount(a); err != nil {
		return Account{}, err
	}
	if in.Password == "" {
		return Account{}, errors.New("请输入授权码")
	}
	// Never log input structs, addresses, secrets or raw credential-store errors.
	if len(requestID) > 64 || strings.ContainsAny(requestID, "\r\n") {
		return Account{}, errors.New("无效测试编号")
	}
	a.ID = randomID()
	a.Demo = false
	started := time.Now()
	slog.Info("account.credentials.save.started", "request_id", requestID)
	if err := mygo.Secrets.Set("mail:"+a.ID, []byte(in.Password)); err != nil {
		slog.Error("account.credentials.save.failed", "request_id", requestID, "duration_ms", time.Since(started).Milliseconds())
		return Account{}, errors.New("系统凭证库不可用，账号未保存；请先解锁系统钥匙串")
	}
	slog.Info("account.credentials.save.finished", "request_id", requestID, "duration_ms", time.Since(started).Milliseconds())
	raw, _ := json.Marshal(a)
	if _, err := s.db.Exec("INSERT INTO accounts VALUES(?,?)", a.ID, string(raw)); err != nil {
		_ = mygo.Secrets.Delete("mail:" + a.ID)
		slog.Error("account.database.save.failed", "request_id", requestID)
		return Account{}, errors.New("保存账号失败")
	}
	slog.Info("account.save.finished", "request_id", requestID)
	s.requestMailCheck()
	return a, nil
}
func (s *MailService) credentials(id string) (Account, string, error) {
	a, err := s.account(id)
	if err != nil {
		return a, "", err
	}
	if a.Demo {
		return a, "", errors.New("本地示例不连接邮件服务器")
	}
	secret, err := mygo.Secrets.Get("mail:" + id)
	if err != nil {
		return a, "", errors.New("无法读取授权码，请检查系统钥匙串")
	}
	return a, string(secret), nil
}

type FolderInfo struct {
	Name       string `json:"name"`
	Delimiter  string `json:"delimiter"`
	Role       string `json:"role"`
	Selectable bool   `json:"selectable"`
}

func folderInfo(v *imap.ListData) FolderInfo {
	f := FolderInfo{Name: v.Mailbox, Selectable: true}
	if v.Delim != 0 {
		f.Delimiter = string(v.Delim)
	}
	if strings.EqualFold(v.Mailbox, "INBOX") {
		f.Role = "inbox"
	}
	roles := map[imap.MailboxAttr]string{imap.MailboxAttrSent: "sent", imap.MailboxAttrDrafts: "drafts", imap.MailboxAttrFlagged: "flagged", imap.MailboxAttrArchive: "archive", imap.MailboxAttrAll: "all", imap.MailboxAttrJunk: "junk", imap.MailboxAttrTrash: "trash"}
	for _, attr := range v.Attrs {
		if attr == imap.MailboxAttrNoSelect {
			f.Selectable = false
		}
		if role := roles[attr]; role != "" && f.Role == "" {
			f.Role = role
		}
	}
	return f
}
func (s *MailService) Folders(id string) ([]FolderInfo, error) {
	a, p, err := s.credentials(id)
	if err != nil {
		if a.Demo {
			return []FolderInfo{{Name: "INBOX", Role: "inbox", Selectable: true}}, nil
		}
		return nil, err
	}
	c, err := imapConnect(a, p)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	options := &imap.ListOptions{}
	if c.Caps().Has(imap.CapSpecialUse) {
		options.ReturnSpecialUse = true
	}
	list, err := c.List("", "*", options).Collect()
	if err != nil {
		return nil, errors.New("获取文件夹失败")
	}
	result := []FolderInfo{}
	for _, v := range list {
		result = append(result, folderInfo(v))
	}
	return result, nil
}
func (s *MailService) Sync(id, folder string) (result []Message, err error) {
	defer operationLog("mail.sync")(&err)
	s.network.Lock()
	defer s.network.Unlock()
	a, p, err := s.credentials(id)
	if a.Demo {
		return s.Messages(id, folder)
	}
	if err != nil {
		return nil, err
	}
	c, err := imapConnect(a, p)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	result, err = s.syncWithClient(c, id, folder)
	if err == nil {
		s.requestMailCheck()
		go s.flushPending(context.Background())
	}
	return result, err
}
func (s *MailService) syncWithClient(c *imapclient.Client, id, folder string) ([]Message, error) {
	box, err := c.Select(folder, &imap.SelectOptions{ReadOnly: true}).Wait()
	if err != nil {
		return nil, errors.New("无法打开文件夹")
	}
	var existing uint32
	err = s.db.QueryRow("SELECT validity FROM folders WHERE account_id=? AND name=?", id, folder).Scan(&existing)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var fetched []*imapclient.FetchMessageBuffer
	if box.NumMessages > 0 {
		start := uint32(1)
		if box.NumMessages > 50 {
			start = box.NumMessages - 49
		}
		set := imap.SeqSet{}
		set.AddRange(start, box.NumMessages)
		fetched, err = c.Fetch(set, &imap.FetchOptions{UID: true, Envelope: true, Flags: true}).Collect()
		if err != nil {
			return nil, errors.New("邮件头同步失败，本地缓存已保留")
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if existing != box.UIDValidity {
		if _, err = tx.Exec("DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE account_id=? AND folder=?)", id, folder); err != nil {
			return nil, err
		}
		if _, err = tx.Exec("DELETE FROM messages WHERE account_id=? AND folder=?", id, folder); err != nil {
			return nil, err
		}
	}
	if _, err = tx.Exec("INSERT INTO folders VALUES(?,?,?) ON CONFLICT(account_id,name) DO UPDATE SET validity=excluded.validity", id, folder, box.UIDValidity); err != nil {
		return nil, err
	}
	// Reconcile only the recent window; older cached pages and bodies remain available.
	keep := map[string]bool{}
	cutoff := uint32(0)
	if box.NumMessages > 50 {
		cutoff = ^uint32(0)
		for _, row := range fetched {
			if uint32(row.UID) < cutoff {
				cutoff = uint32(row.UID)
			}
		}
	}
	for _, row := range fetched {
		if row.Envelope == nil {
			continue
		}
		message, e := cacheEnvelope(tx, id, folder, box.UIDValidity, row)
		if e != nil {
			return nil, e
		}
		keep[message.ID] = true
	}
	rows, err := tx.Query("SELECT id FROM messages WHERE account_id=? AND folder=? AND uid>=?", id, folder, cutoff)
	if err != nil {
		return nil, err
	}
	remove := []string{}
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			rows.Close()
			return nil, err
		}
		if !keep[key] {
			remove = append(remove, key)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, key := range remove {
		if _, err = tx.Exec("DELETE FROM attachments WHERE message_id=?", key); err != nil {
			return nil, err
		}
		if _, err = tx.Exec("DELETE FROM messages WHERE id=?", key); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	s.reconcilePending(id)
	s.trimCacheIfNeeded()
	return s.Messages(id, folder)
}
func formatAddresses(as []imap.Address) string {
	list := []string{}
	for _, a := range as {
		if a.Mailbox != "" {
			address := a.Mailbox + "@" + a.Host
			if a.Name != "" {
				address = a.Name + " <" + address + ">"
			}
			list = append(list, address)
		}
	}
	return strings.Join(list, ", ")
}
func parseBody(raw []byte) (string, string, []bodyPart, error) {
	r, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil {
		return "", "", nil, errors.New("无法解析邮件编码或格式")
	}
	defer r.Close()
	var plain, rich string
	parts := []bodyPart{}
	for {
		part, e := r.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			return "", "", nil, errors.New("邮件正文不完整或编码不支持")
		}
		switch h := part.Header.(type) {
		case *mail.InlineHeader:
			t, _, _ := h.ContentType()
			data, e := io.ReadAll(io.LimitReader(part.Body, maxBodyBytes+1))
			if e != nil || len(data) > maxBodyBytes {
				return "", "", nil, errors.New("正文超过 8 MB，请使用网页邮箱阅读")
			}
			if t == "text/plain" && plain == "" {
				plain = string(data)
			}
			if t == "text/html" && rich == "" {
				rich = string(data)
			}
		case *mail.AttachmentHeader:
			name, _ := h.Filename()
			data, e := io.ReadAll(io.LimitReader(part.Body, maxBodyBytes+1))
			if e != nil || len(data) > maxBodyBytes {
				return "", "", nil, errors.New("附件超过 8 MB，请使用网页邮箱下载")
			}
			parts = append(parts, bodyPart{Name: name, Data: data})
		}
	}
	return plain, rich, parts, nil
}

// attachmentList is what the reader shows: names, sizes and the index it sends
// back to save one.
func attachmentList(parts []bodyPart) []Attachment {
	list := make([]Attachment, 0, len(parts))
	for i, part := range parts {
		list = append(list, Attachment{Name: part.Name, Size: int64(len(part.Data)), Index: i})
	}
	return list
}

// safeFilename keeps a MIME filename from escaping the folder the reader picks:
// no separators, no control characters, no leading dots, and a sane length.
// The extension is part of the name and survives.
func safeFilename(name string) string {
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r == '/' || r == '\\' || r == ':' || r == 0:
			return -1
		case unicode.IsControl(r):
			return -1
		}
		return r
	}, strings.ToValidUTF8(name, ""))
	cleaned = strings.TrimSpace(strings.TrimLeft(cleaned, "."))
	if runes := []rune(cleaned); len(runes) > 120 {
		cleaned = string(runes[:120])
	}
	if cleaned == "" {
		return "附件"
	}
	return cleaned
}

// fetchRaw downloads the complete RFC 822 body of one message, bounded by
// maxBodyBytes. Callers hold no lock; the network mutex is taken here.
func (s *MailService) fetchRaw(m Message) ([]byte, error) {
	s.network.Lock()
	defer s.network.Unlock()
	a, p, err := s.credentials(m.AccountID)
	if err != nil {
		return nil, err
	}
	c, err := imapConnect(a, p)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	box, err := c.Select(m.Folder, &imap.SelectOptions{ReadOnly: true}).Wait()
	if err != nil {
		return nil, errors.New("无法打开文件夹")
	}
	if box.UIDValidity != m.Validity {
		return nil, errors.New("服务器邮件标识已变化，请刷新文件夹")
	}
	section := &imap.FetchItemBodySection{Peek: true, Partial: &imap.SectionPartial{Offset: 0, Size: maxBodyBytes + 1}}
	items, err := c.Fetch(imap.UIDSetNum(imap.UID(m.UID)), &imap.FetchOptions{BodySection: []*imap.FetchItemBodySection{section}}).Collect()
	if err != nil || len(items) != 1 {
		return nil, errors.New("获取正文失败，邮件可能已被移动或删除")
	}
	raw := items[0].FindBodySection(section)
	if len(raw) > maxBodyBytes {
		return nil, errors.New("邮件超过 8 MB，请使用网页邮箱阅读")
	}
	return raw, nil
}

func (s *MailService) ReadMessage(id string) (result Message, err error) {
	defer operationLog("mail.read")(&err)
	m, err := s.cached(id)
	if err != nil || m.Cached {
		return m, err
	}
	raw, err := s.fetchRaw(m)
	if err != nil {
		return m, err
	}
	plain, rich, parts, err := parseBody(raw)
	if err != nil {
		return m, err
	}
	if err = s.putAttachments(m.ID, parts); err != nil {
		return m, err
	}
	m.Text, m.HTML, m.Attachments = plain, rich, attachmentList(parts)
	m.Cached = true
	return m, s.putMessage(m)
}

// DownloadAttachment writes one attachment wherever the reader points the save
// panel. An empty path with a nil error means the panel was cancelled. The
// context is only used to attach the panel to the window that asked for it.
func (s *MailService) DownloadAttachment(ctx context.Context, id string, index int) (path string, err error) {
	defer operationLog("mail.attachment")(&err)
	m, err := s.cached(id)
	if err != nil {
		return "", err
	}
	part, err := s.attachmentPart(m, index)
	if err != nil {
		return "", err
	}
	name := safeFilename(part.Name)
	defaultPath := name
	if home, e := os.UserHomeDir(); e == nil {
		defaultPath = filepath.Join(home, "Downloads", name)
	}
	path, err = mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "保存附件",
		DefaultPath: defaultPath,
		ButtonLabel: "保存",
	})
	if err != nil {
		return "", errors.New("无法打开保存对话框")
	}
	if path == "" {
		return "", nil
	}
	if err = os.WriteFile(path, part.Data, 0600); err != nil {
		slog.Warn("mail.attachment.save.failed", "result", "write")
		return "", errors.New("附件写入失败，请换一个保存位置")
	}
	slog.Info("mail.attachment.save.finished", "bytes", len(part.Data))
	return path, nil
}

// attachmentPart prefers the cached bytes; a message read before attachments
// were kept is fetched again so old cache entries still download.
func (s *MailService) attachmentPart(m Message, index int) (bodyPart, error) {
	if index < 0 || index >= len(m.Attachments) {
		return bodyPart{}, errors.New("附件不存在")
	}
	part, err := s.storedAttachment(m.ID, index)
	if err == nil {
		return part, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return bodyPart{}, err
	}
	if owner, e := s.account(m.AccountID); e == nil && owner.Demo {
		return bodyPart{}, errors.New("示例邮件没有附件内容")
	}
	raw, err := s.fetchRaw(m)
	if err != nil {
		return bodyPart{}, err
	}
	plain, rich, parts, err := parseBody(raw)
	if err != nil {
		return bodyPart{}, err
	}
	if err = s.putAttachments(m.ID, parts); err != nil {
		return bodyPart{}, err
	}
	if index >= len(parts) {
		return bodyPart{}, errors.New("附件不存在")
	}
	m.Attachments, m.Text, m.HTML = attachmentList(parts), plain, rich
	if e := s.putMessage(m); e != nil {
		return bodyPart{}, e
	}
	return parts[index], nil
}

func buildMail(a Account, d Draft) ([]byte, []string, error) {
	recipients, err := stdmail.ParseAddressList(d.To)
	if err != nil || len(recipients) == 0 {
		return nil, nil, errors.New("请输入有效的收件人地址，多个地址用英文逗号分隔")
	}
	var copies, blind []*stdmail.Address
	if strings.TrimSpace(d.Cc) != "" {
		if copies, err = stdmail.ParseAddressList(d.Cc); err != nil {
			return nil, nil, errors.New("请输入有效的抄送地址，多个地址用英文逗号分隔")
		}
	}
	// Bcc travels in the SMTP envelope only: writing a Bcc header would reveal
	// the hidden recipients to everyone else on the message.
	if strings.TrimSpace(d.Bcc) != "" {
		if blind, err = stdmail.ParseAddressList(d.Bcc); err != nil {
			return nil, nil, errors.New("请输入有效的密送地址，多个地址用英文逗号分隔")
		}
	}
	if strings.ContainsAny(d.Subject, "\r\n") {
		return nil, nil, errors.New("主题不能包含换行")
	}
	if len(d.Body) > 1<<20 {
		return nil, nil, errors.New("正文过长")
	}
	parts, err := readComposeAttachments(d.Attachments)
	if err != nil {
		return nil, nil, err
	}
	from, err := stdmail.ParseAddress(a.Email)
	if err != nil {
		return nil, nil, err
	}
	// The envelope carries every recipient, carbon copies included: SMTP
	// delivers by RCPT TO, the Cc header only tells the reader who was copied.
	to := []string{}
	seen := map[string]bool{}
	all := append(append(append([]*stdmail.Address{}, recipients...), copies...), blind...)
	for _, r := range all {
		key := strings.ToLower(r.Address)
		if seen[key] {
			continue
		}
		seen[key] = true
		to = append(to, r.Address)
	}
	var h mail.Header
	h.SetAddressList("From", []*stdmail.Address{from})
	h.SetAddressList("To", recipients)
	if len(copies) > 0 {
		h.SetAddressList("Cc", copies)
	}
	h.SetSubject(d.Subject)
	h.SetDate(time.Now())
	h.Set("Message-ID", "<"+randomID()+"@"+strings.Split(a.Email, "@")[1]+">")
	var b bytes.Buffer
	var mixed *mail.Writer
	var w *mail.InlineWriter
	if len(parts) > 0 {
		mixed, err = mail.CreateWriter(&b, h)
		if err != nil {
			return nil, nil, err
		}
		w, err = mixed.CreateInline()
	} else {
		w, err = mail.CreateInlineWriter(&b, h)
	}
	if err != nil {
		return nil, nil, err
	}
	for _, part := range []struct{ kind, body string }{{"text/plain", d.Body}, {"text/html", "<html><body><pre>" + html.EscapeString(d.Body) + "</pre></body></html>"}} {
		var header mail.InlineHeader
		header.SetContentType(part.kind, map[string]string{"charset": "utf-8"})
		p, e := w.CreatePart(header)
		if e != nil {
			return nil, nil, e
		}
		if _, e = io.WriteString(p, part.body); e != nil {
			return nil, nil, e
		}
		if e = p.Close(); e != nil {
			return nil, nil, e
		}
	}
	if err = w.Close(); err != nil {
		return nil, nil, err
	}
	for _, part := range parts {
		var header mail.AttachmentHeader
		kind := mime.TypeByExtension(strings.ToLower(filepath.Ext(part.Name)))
		if semi := strings.IndexByte(kind, ';'); semi >= 0 {
			kind = strings.TrimSpace(kind[:semi])
		}
		if kind == "" {
			kind = "application/octet-stream"
		}
		header.SetContentType(kind, nil)
		header.SetFilename(part.Name)
		p, e := mixed.CreateAttachment(header)
		if e != nil {
			return nil, nil, e
		}
		if _, e = p.Write(part.Data); e != nil {
			return nil, nil, e
		}
		if e = p.Close(); e != nil {
			return nil, nil, e
		}
	}
	if mixed != nil {
		if err = mixed.Close(); err != nil {
			return nil, nil, err
		}
	}
	return b.Bytes(), to, nil
}

const maxAttachmentBytes = 10 << 20
const maxAttachmentsTotal = 25 << 20

// readComposeAttachments reads the file the user picked at send time; the
// webview only ever sees paths, never file bytes.
func readComposeAttachments(list []DraftAttachment) ([]bodyPart, error) {
	parts := []bodyPart{}
	var total int64
	for _, item := range list {
		if item.Path == "" {
			continue
		}
		info, err := os.Stat(item.Path)
		if err != nil {
			return nil, errors.New("附件文件已不存在，请重新添加")
		}
		if !info.Mode().IsRegular() || info.Size() > maxAttachmentBytes {
			return nil, errors.New("单个附件不能超过 10 MB，且只能是普通文件")
		}
		total += info.Size()
		if total > maxAttachmentsTotal {
			return nil, errors.New("附件总大小不能超过 25 MB")
		}
		data, err := os.ReadFile(item.Path)
		if err != nil {
			return nil, errors.New("附件读取失败，请重新添加")
		}
		name := safeFilename(filepath.Base(item.Path))
		if name == "" {
			name = "attachment"
		}
		parts = append(parts, bodyPart{Name: name, Data: data})
	}
	return parts, nil
}

// PickAttachments opens the native multi-select panel and returns metadata
// only. The compose window keeps these in the draft so a reopened draft still
// lists the files it will send.
func (s *MailService) PickAttachments(ctx context.Context) ([]DraftAttachment, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "添加附件",
		ButtonLabel: "添加",
		Multiple:    true,
	})
	if err != nil {
		return nil, errors.New("无法打开附件选择面板")
	}
	result := make([]DraftAttachment, 0, len(paths))
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if info.Size() > maxAttachmentBytes {
			return nil, errors.New("单个附件不能超过 10 MB")
		}
		result = append(result, DraftAttachment{Name: safeFilename(filepath.Base(path)), Size: info.Size(), Path: path})
	}
	return result, nil
}

// Send sends once. It never automatically retries an uncertain SMTP outcome.
func (s *MailService) Send(d Draft) (result string, err error) {
	defer operationLog("mail.send")(&err)
	if !s.sending.TryLock() {
		return "", errors.New("已有邮件正在发送，请稍候")
	}
	defer s.sending.Unlock()
	a, p, err := s.credentials(d.AccountID)
	if err != nil {
		return "", err
	}
	raw, to, err := buildMail(a, d)
	if err != nil {
		return "", err
	}
	if err = s.SaveDraft(d); err != nil {
		return "", errors.New("无法保存草稿，已取消发送")
	}
	c, err := smtpConnect(a, p)
	if err != nil {
		return "", err
	}
	defer c.Close()
	if err = c.SendMail(a.Email, to, bytes.NewReader(raw)); err != nil {
		return "", errors.New("发送未确认：请先检查网页邮箱中的已发送，再决定是否重试；草稿已保留")
	}
	note := ""
	if s.GetSettings().AppendSent {
		if e := s.appendSentCopy(a, p, raw); e != nil {
			// SMTP already succeeded. Never resend because IMAP failed; the
			// local `sent` record below is the source of truth.
			note = "；服务器「已发送」副本写入失败，可在设置中关闭该选项"
			slog.Warn("mail.send.append.failed")
		} else {
			note = "；已追加到服务器「已发送」文件夹"
		}
	}
	_, err = s.db.Exec("INSERT INTO sent VALUES(?,?,?,?)", randomID(), a.ID, raw, time.Now().Format(time.RFC3339))
	if err != nil {
		return "邮件已发送，但本地发送记录写入失败；请勿重复发送。", nil
	}
	if err = s.ClearDraft(a.ID, d.Key); err != nil {
		return "邮件已发送，但本地草稿清理失败；请勿重复发送。" + note, nil
	}
	return "邮件已通过 SMTP 发送，本地发送记录已保存" + note + "。", nil
}

// appendSentCopy writes one copy after a confirmed SMTP delivery. Many
// providers (Gmail, QQ) already file the message themselves, which is why the
// setting defaults to off: appending unconditionally produces duplicates.
func (s *MailService) appendSentCopy(a Account, password string, raw []byte) error {
	c, err := imapConnect(a, password)
	if err != nil {
		return err
	}
	defer c.Close()
	folder, err := specialFolder(c, "sent")
	if err != nil {
		return err
	}
	cmd := c.Append(folder, int64(len(raw)), &imap.AppendOptions{Flags: []imap.Flag{imap.FlagSeen}})
	if _, err = cmd.Write(raw); err != nil {
		_ = cmd.Close()
		return err
	}
	if err = cmd.Close(); err != nil {
		return err
	}
	_, err = cmd.Wait()
	return err
}
