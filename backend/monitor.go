package main

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/egoist/mygo"
	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

type InboxCheckpoint struct {
	AccountID string `json:"accountId"`
	Validity  uint32 `json:"validity"`
	UIDNext   uint32 `json:"uidNext"`
	Unread    int    `json:"unread"`
	CheckedAt string `json:"checkedAt"`
}
type DesktopState struct {
	Unread             int            `json:"unread"`
	AccountUnread      map[string]int `json:"accountUnread"`
	Notifications      bool           `json:"notifications"`
	NotificationStatus string         `json:"notificationStatus"`
	Checking           bool           `json:"checking"`
	LastError          string         `json:"lastError"`
	Revision           uint64         `json:"revision"`
}
type MailTarget struct {
	AccountID string `json:"accountId"`
	UID       uint32 `json:"uid"`
	Validity  uint32 `json:"validity"`
}
type newMailNotice struct {
	Target MailTarget
	Count  int
}

var MailChanged = mygo.NewEvent[DesktopState]("mail-changed")
var OpenMail = mygo.NewEvent[bool]("open-mail")

func (s *MailService) initMonitor() error {
	s.inboxes = map[string]InboxCheckpoint{}
	s.desktop = DesktopState{AccountUnread: map[string]int{}, Notifications: true}
	s.checkRequests = make(chan struct{}, 1)
	s.idleStops = map[string]context.CancelFunc{}
	rows, err := s.db.Query("SELECT key,value FROM metadata WHERE key LIKE 'inbox:%' OR key='notifications'")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if err = rows.Scan(&key, &value); err != nil {
			return err
		}
		if key == "notifications" {
			s.desktop.Notifications = value != "false"
			continue
		}
		var checkpoint InboxCheckpoint
		if json.Unmarshal([]byte(value), &checkpoint) == nil {
			s.inboxes[checkpoint.AccountID] = checkpoint
			s.desktop.AccountUnread[checkpoint.AccountID] = checkpoint.Unread
			s.desktop.Unread += checkpoint.Unread
		}
	}
	return rows.Err()
}
func (s *MailService) DesktopState() DesktopState {
	s.desktopMu.RLock()
	defer s.desktopMu.RUnlock()
	result := s.desktop
	result.AccountUnread = map[string]int{}
	for id, count := range s.desktop.AccountUnread {
		result.AccountUnread[id] = count
	}
	return result
}
func (s *MailService) publishDesktop() {
	s.desktopMu.Lock()
	s.desktop.Revision++
	callback := s.desktopChanged
	s.desktopMu.Unlock()
	if callback != nil {
		callback(s.DesktopState())
	}
}
func (s *MailService) SetNotifications(enabled bool) (DesktopState, error) {
	value := "false"
	if enabled {
		value = "true"
	}
	if _, err := s.db.Exec("INSERT INTO metadata VALUES('notifications',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", value); err != nil {
		return s.DesktopState(), errors.New("通知设置保存失败")
	}
	s.desktopMu.Lock()
	s.desktop.Notifications = enabled
	s.desktopMu.Unlock()
	s.publishDesktop()
	return s.DesktopState(), nil
}
func (s *MailService) setNotificationStatus(status string) {
	s.desktopMu.Lock()
	s.desktop.NotificationStatus = status
	s.desktopMu.Unlock()
	s.publishDesktop()
}
func (s *MailService) TestNotification(parent context.Context) error {
	s.desktopMu.RLock()
	fn := s.testNotification
	enabled := s.desktop.Notifications
	s.desktopMu.RUnlock()
	if !enabled {
		return errors.New("请先开启新邮件通知")
	}
	if fn == nil {
		return errors.New("桌面通知尚未就绪")
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	return fn(ctx)
}
func (s *MailService) TakeMailTarget() MailTarget {
	s.desktopMu.Lock()
	defer s.desktopMu.Unlock()
	target := s.mailTarget
	s.mailTarget = MailTarget{}
	return target
}
func (s *MailService) queueMailTarget(target MailTarget) {
	s.desktopMu.Lock()
	s.mailTarget = target
	callback := s.openMail
	s.desktopMu.Unlock()
	if callback != nil {
		callback()
	}
}
func notificationID(target MailTarget) string {
	raw, _ := json.Marshal(target)
	return "mail:" + base64.RawURLEncoding.EncodeToString(raw)
}
func parseNotificationID(id string) (MailTarget, bool) {
	var target MailTarget
	if len(id) < 6 || len(id) > 1024 || id[:5] != "mail:" {
		return target, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(id[5:])
	if err != nil || json.Unmarshal(raw, &target) != nil || target.AccountID == "" || target.UID == 0 || target.Validity == 0 {
		return MailTarget{}, false
	}
	return target, true
}
func (s *MailService) requestMailCheck() {
	if s.checkRequests != nil {
		select {
		case s.checkRequests <- struct{}{}:
		default:
		}
	}
}
func checkInterval(v Settings) time.Duration {
	return time.Duration(v.SyncIntervalSec) * time.Second
}

func (s *MailService) runMonitor(ctx context.Context) {
	current := checkInterval(s.GetSettings())
	ticker := time.NewTicker(current)
	defer ticker.Stop()
	for {
		_, _ = s.CheckMail(ctx)
		// A successful check means the network is back: replay anything the
		// reader did while offline.
		go s.flushPending(ctx)
		// The poll keeps unread counts honest and works on servers without
		// IDLE; the watchers make new mail arrive as a push.
		if snapshot, err := s.State(); err == nil {
			s.syncIdleWatchers(ctx, snapshot.Accounts)
		}
		want := checkInterval(s.GetSettings())
		if want != current {
			ticker.Reset(want)
			current = want
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.settingsChanged:
		case <-s.checkRequests:
			// Something (IDLE, a read flag, the tray menu) asked for a
			// check. A UI sync may be holding the monitor lock, and
			// `CheckMail` gives up instead of queueing, so wait for it to
			// finish rather than letting the push sit until the next tick.
			for i := 0; i < 10 && s.DesktopState().Checking; i++ {
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Second):
				}
			}
		}
	}
}

// Only new UIDs count as incoming mail; first sync and UIDVALIDITY resets are baselines.
func inspectInbox(c *imapclient.Client, accountID string, previous InboxCheckpoint) (InboxCheckpoint, newMailNotice, error) {
	current := InboxCheckpoint{AccountID: accountID}
	notice := newMailNotice{}
	status, err := c.Status("INBOX", &imap.StatusOptions{UIDNext: true, UIDValidity: true, NumUnseen: true}).Wait()
	if err != nil || status.NumUnseen == nil || status.UIDValidity == 0 || status.UIDNext == 0 {
		return current, notice, errors.New("无法获取收件箱未读状态")
	}
	current.Validity = status.UIDValidity
	current.UIDNext = uint32(status.UIDNext)
	current.Unread = int(*status.NumUnseen)
	current.CheckedAt = time.Now().Format(time.RFC3339)
	if previous.Validity != current.Validity || previous.UIDNext == 0 || current.UIDNext <= previous.UIDNext {
		return current, notice, nil
	}
	box, err := c.Select("INBOX", &imap.SelectOptions{ReadOnly: true}).Wait()
	if err != nil || box.UIDValidity != current.Validity {
		return current, notice, errors.New("收件箱状态变化，请稍后重试")
	}
	set := imap.UIDSet{}
	set.AddRange(imap.UID(previous.UIDNext), imap.UID(current.UIDNext-1))
	found, err := c.UIDSearch(&imap.SearchCriteria{UID: []imap.UIDSet{set}, NotFlag: []imap.Flag{imap.FlagSeen}}, nil).Wait()
	if err != nil {
		return current, notice, errors.New("检查新邮件失败")
	}
	for _, uid := range found.AllUIDs() {
		notice.Count++
		if uint32(uid) > notice.Target.UID {
			notice.Target = MailTarget{AccountID: accountID, UID: uint32(uid), Validity: current.Validity}
		}
	}
	return current, notice, nil
}
func (s *MailService) CheckMail(parent context.Context) (DesktopState, error) {
	if !s.monitorMu.TryLock() {
		return s.DesktopState(), nil
	}
	defer s.monitorMu.Unlock()
	s.desktopMu.Lock()
	s.desktop.Checking = true
	s.desktopMu.Unlock()
	s.publishDesktop()
	defer func() { s.desktopMu.Lock(); s.desktop.Checking = false; s.desktopMu.Unlock(); s.publishDesktop() }()
	snapshot, err := s.State()
	if err != nil {
		return s.DesktopState(), err
	}
	failed := false
	for _, a := range snapshot.Accounts {
		if a.Demo {
			continue
		}
		if parent.Err() != nil {
			break
		}
		s.desktopMu.RLock()
		previous := s.inboxes[a.ID]
		s.desktopMu.RUnlock()
		// Persist the checkpoint and raise the notification as soon as the
		// STATUS reply is in, before the message window is synced: a push that
		// arrives while a slow sync holds the network lock should still show up
		// in seconds.
		commit := func(checkpoint InboxCheckpoint, notice newMailNotice) {
			raw, _ := json.Marshal(checkpoint)
			if _, e := s.db.Exec("INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", "inbox:"+a.ID, string(raw)); e != nil {
				failed = true
				slog.Error("mail.background.checkpoint.failed")
				return
			}
			s.desktopMu.Lock()
			s.inboxes[a.ID] = checkpoint
			s.desktop.AccountUnread[a.ID] = checkpoint.Unread
			s.desktop.Unread = 0
			for _, count := range s.desktop.AccountUnread {
				s.desktop.Unread += count
			}
			notify := s.desktop.Notifications
			callback := s.newMail
			s.desktopMu.Unlock()
			s.publishDesktop()
			if notice.Count > 0 && notify && callback != nil {
				callback(notice)
			}
		}
		if _, _, e := s.checkAccountInbox(parent, a, previous, commit); e != nil {
			failed = true
			slog.Warn("mail.background.check.failed", "error_category", "connection_or_sync")
			continue
		}
	}
	s.desktopMu.Lock()
	s.desktop.LastError = ""
	if failed {
		s.desktop.LastError = "部分账号未能更新，保留上次未读数"
	}
	s.desktopMu.Unlock()
	return s.DesktopState(), nil
}
func (s *MailService) checkAccountInbox(parent context.Context, a Account, previous InboxCheckpoint, onInspected func(InboxCheckpoint, newMailNotice)) (InboxCheckpoint, newMailNotice, error) {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	ctx = context.WithValue(ctx, connectionTraceKey{}, randomID())
	defer cancel()
	_, password, err := s.credentials(a.ID)
	if err != nil {
		return InboxCheckpoint{}, newMailNotice{}, err
	}
	c, err := imapConnectContext(ctx, a, password, &tls.Config{ServerName: a.IMAPHost, MinVersion: tls.VersionTLS12})
	if err != nil {
		return InboxCheckpoint{}, newMailNotice{}, err
	}
	defer c.Close()
	current, notice, err := inspectInbox(c, a.ID, previous)
	if err != nil {
		return current, notice, err
	}
	if onInspected != nil {
		onInspected(current, notice)
	}
	s.network.Lock()
	_, err = s.syncWithClient(c, a.ID, "INBOX")
	s.network.Unlock()
	return current, notice, err
}
// A notification can outlive the current 50-message window. Resolve its exact
// UID and UIDVALIDITY rather than opening an unrelated recent message.
func (s *MailService) ResolveMailTarget(target MailTarget) (Message, error) {
	if target.AccountID == "" || target.UID == 0 || target.Validity == 0 {
		return Message{}, errors.New("无效的邮件通知")
	}
	id := fmt.Sprintf("%s:INBOX:%d:%d", target.AccountID, target.Validity, target.UID)
	if cached, err := s.cached(id); err == nil {
		return cached, nil
	}
	s.network.Lock()
	defer s.network.Unlock()
	a, password, err := s.credentials(target.AccountID)
	if err != nil {
		return Message{}, err
	}
	c, err := imapConnect(a, password)
	if err != nil {
		return Message{}, err
	}
	defer c.Close()
	box, err := c.Select("INBOX", &imap.SelectOptions{ReadOnly: true}).Wait()
	if err != nil || box.UIDValidity != target.Validity {
		return Message{}, errors.New("这封通知对应的邮件已失效或被移动")
	}
	rows, err := c.Fetch(imap.UIDSetNum(imap.UID(target.UID)), &imap.FetchOptions{UID: true, Envelope: true, Flags: true}).Collect()
	if err != nil || len(rows) != 1 || rows[0].Envelope == nil {
		return Message{}, errors.New("这封邮件已被移动或删除")
	}
	e := rows[0].Envelope
	m := Message{ID: id, AccountID: target.AccountID, Folder: "INBOX", UID: target.UID, Validity: target.Validity, Subject: e.Subject, From: formatAddresses(e.From), To: formatAddresses(e.To), Date: e.Date.Format(time.RFC3339), Attachments: []Attachment{}}
	for _, flag := range rows[0].Flags {
		if flag == imap.FlagSeen {
			m.Seen = true
		}
		if flag == imap.FlagFlagged {
			m.Flagged = true
		}
	}
	return m, s.putMessage(m)
}
