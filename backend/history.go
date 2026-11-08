package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

const historyPageSize = 50

type HistoryPage struct {
	Messages []Message `json:"messages"`
	HasMore  bool      `json:"hasMore"`
	NextUID  uint32    `json:"nextUID"`
	Validity uint32    `json:"validity"`
}

func cacheEnvelope(tx *sql.Tx, accountID, folder string, validity uint32, row *imapclient.FetchMessageBuffer) (Message, error) {
	if row.Envelope == nil || row.UID == 0 {
		return Message{}, errors.New("服务器未返回完整邮件头")
	}
	e := row.Envelope
	m := Message{ID: fmt.Sprintf("%s:%s:%d:%d", accountID, folder, validity, row.UID), AccountID: accountID, Folder: folder, UID: uint32(row.UID), Validity: validity, Subject: e.Subject, From: formatAddresses(e.From), To: formatAddresses(e.To), Date: e.Date.Format(time.RFC3339), Attachments: []Attachment{}}
	for _, flag := range row.Flags {
		if flag == imap.FlagSeen {
			m.Seen = true
		}
		if flag == imap.FlagFlagged {
			m.Flagged = true
		}
	}
	var raw string
	err := tx.QueryRow("SELECT data FROM messages WHERE id=?", m.ID).Scan(&raw)
	if err == nil {
		var old Message
		if err = json.Unmarshal([]byte(raw), &old); err != nil {
			return m, err
		}
		m.Text, m.HTML, m.Cached, m.Attachments = old.Text, old.HTML, old.Cached, old.Attachments
	} else if !errors.Is(err, sql.ErrNoRows) {
		return m, err
	}
	encoded, err := json.Marshal(m)
	if err != nil {
		return m, err
	}
	_, err = tx.Exec("INSERT INTO messages VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", m.ID, accountID, folder, m.UID, validity, string(encoded))
	return m, err
}

func (s *MailService) LoadOlder(parent context.Context, accountID, folder string, beforeUID, validity uint32) (page HistoryPage, err error) {
	defer operationLog("mail.history")(&err)
	page.Messages = []Message{}
	a, password, err := s.credentials(accountID)
	if a.Demo {
		rows, e := s.Messages(accountID, folder)
		if e != nil {
			return page, e
		}
		for _, m := range rows {
			if beforeUID == 0 || m.UID < beforeUID {
				page.Messages = append(page.Messages, m)
			}
		}
		page.HasMore = len(page.Messages) > historyPageSize
		if len(page.Messages) > historyPageSize {
			page.Messages = page.Messages[:historyPageSize]
		}
		if len(page.Messages) > 0 {
			page.NextUID = page.Messages[len(page.Messages)-1].UID
			page.Validity = page.Messages[0].Validity
		}
		return page, nil
	}
	if err != nil {
		return page, err
	}
	if beforeUID == 1 {
		return page, nil
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	s.network.Lock()
	defer s.network.Unlock()
	if ctx.Err() != nil {
		return page, errors.New("历史邮件加载超时，请重试")
	}
	c, err := imapConnectContext(ctx, a, password, &tls.Config{ServerName: a.IMAPHost, MinVersion: tls.VersionTLS12})
	if err != nil {
		return page, err
	}
	defer c.Close()
	return s.loadOlderWithClient(c, accountID, folder, beforeUID, validity)
}

func (s *MailService) loadOlderWithClient(c *imapclient.Client, accountID, folder string, beforeUID, validity uint32) (HistoryPage, error) {
	page := HistoryPage{Messages: []Message{}}
	box, err := c.Select(folder, &imap.SelectOptions{ReadOnly: true}).Wait()
	if err != nil {
		return page, errors.New("无法打开文件夹")
	}
	if validity != 0 && box.UIDValidity != validity {
		return page, errors.New("服务器邮件标识已变化，请刷新文件夹后重试")
	}
	page.Validity = box.UIDValidity
	criteria := &imap.SearchCriteria{}
	if beforeUID > 0 {
		if beforeUID == 1 {
			return page, nil
		}
		set := imap.UIDSet{}
		set.AddRange(1, imap.UID(beforeUID-1))
		criteria.UID = []imap.UIDSet{set}
	}
	found, err := c.UIDSearch(criteria, nil).Wait()
	if err != nil {
		return page, errors.New("查找历史邮件失败，请重试")
	}
	uids := found.AllUIDs()
	sort.Slice(uids, func(i, j int) bool { return uids[i] < uids[j] })
	page.HasMore = len(uids) > historyPageSize
	if len(uids) > historyPageSize {
		uids = uids[len(uids)-historyPageSize:]
	}
	if len(uids) == 0 {
		return page, nil
	}
	page.NextUID = uint32(uids[0])
	rows, err := c.Fetch(imap.UIDSetNum(uids...), &imap.FetchOptions{UID: true, Envelope: true, Flags: true}).Collect()
	if err != nil {
		return page, errors.New("历史邮件获取失败，本地缓存已保留")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return page, err
	}
	defer tx.Rollback()
	var oldValidity uint32
	err = tx.QueryRow("SELECT validity FROM folders WHERE account_id=? AND name=?", accountID, folder).Scan(&oldValidity)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return page, err
	}
	if oldValidity != 0 && oldValidity != box.UIDValidity {
		if _, err = tx.Exec("DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE account_id=? AND folder=?)", accountID, folder); err != nil {
			return page, err
		}
		if _, err = tx.Exec("DELETE FROM messages WHERE account_id=? AND folder=?", accountID, folder); err != nil {
			return page, err
		}
	}
	if _, err = tx.Exec("INSERT INTO folders VALUES(?,?,?) ON CONFLICT(account_id,name) DO UPDATE SET validity=excluded.validity", accountID, folder, box.UIDValidity); err != nil {
		return page, err
	}
	for _, row := range rows {
		m, e := cacheEnvelope(tx, accountID, folder, box.UIDValidity, row)
		if e != nil {
			return page, e
		}
		m.Text, m.HTML = "", ""
		page.Messages = append(page.Messages, m)
	}
	if err = tx.Commit(); err != nil {
		return page, err
	}
	sort.Slice(page.Messages, func(i, j int) bool { return page.Messages[i].UID > page.Messages[j].UID })
	return page, nil
}
