package main

import (
	"bytes"
	"context"
	"encoding/json"
	"mime"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
	"golang.org/x/text/encoding/simplifiedchinese"
)

func gbkWord(t *testing.T, text string, encoding mime.WordEncoder) string {
	t.Helper()
	raw, err := simplifiedchinese.GBK.NewEncoder().String(text)
	if err != nil {
		t.Fatal(err)
	}
	return encoding.Encode("GBK", raw)
}
func TestDecodeLegacyHeaders(t *testing.T) {
	for _, encoding := range []mime.WordEncoder{mime.BEncoding, mime.QEncoding} {
		word := gbkWord(t, "中文发件人", encoding)
		if got := decodeHeaderText(word); got != "中文发件人" {
			t.Fatalf("decoded: %q", got)
		}
		if got := decodeHeaderText("通知 " + word + "\r\n " + gbkWord(t, "测试", encoding)); got != "通知 中文发件人测试" {
			t.Fatalf("folded header: %q", got)
		}
	}
	for _, raw := range []string{"普通中文标题", "ASCII subject", "=?unknown-charset?B?xOO6ww==?=", "=?GBK?B?invalid%?="} {
		if got := decodeHeaderText(raw); got != raw {
			t.Fatalf("unexpected fallback %q", got)
		}
	}
	display := formatAddresses([]imap.Address{{Name: "中文发件人", Mailbox: "test", Host: "example.com"}})
	if display != "中文发件人 <test@example.com>" || strings.Contains(display, "=?") {
		t.Fatalf("display header re-encoded: %q", display)
	}
}
func TestCachedHeaderRepair(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mail.db")
	service, err := openService(path)
	if err != nil {
		t.Fatal(err)
	}
	before := Message{ID: "legacy:1", AccountID: "legacy", Folder: "INBOX", UID: 1, Validity: 2, Subject: gbkWord(t, "中文主题", mime.BEncoding), From: gbkWord(t, "中文发件人", mime.BEncoding) + " <test@example.com>", To: mime.QEncoding.Encode("utf-8", "收件人") + " <friend@example.com>", Text: "原始正文", HTML: "<p>原始排版</p>", Cached: true, Attachments: []Attachment{{Name: "附件.txt"}}, Seen: true}
	if err = service.putMessage(before); err != nil {
		t.Fatal(err)
	}
	if _, err = service.db.Exec("DELETE FROM metadata WHERE key='decoded_mail_headers'"); err != nil {
		t.Fatal(err)
	}
	service.db.Close()
	for range 2 {
		service, err = openService(path)
		if err != nil {
			t.Fatal(err)
		}
		m, e := service.cached(before.ID)
		if e != nil {
			t.Fatal(e)
		}
		expected := before
		expected.Subject = "中文主题"
		expected.From = "中文发件人 <test@example.com>"
		expected.To = "收件人 <friend@example.com>"
		actual, _ := json.Marshal(m)
		want, _ := json.Marshal(expected)
		if !bytes.Equal(actual, want) {
			t.Fatal("repair changed message content or failed to decode display headers")
		}
		list, e := service.Messages("legacy", "INBOX")
		if e != nil || len(list) != 1 || list[0].Subject != "中文主题" {
			t.Fatal("list still contains encoded headers")
		}
		service.db.Close()
	}
}

// Keep encoded words on the wire; the normal memory server decodes headers itself.
type encodedEnvelopeSession struct {
	imapserver.Session
	envelope *imap.Envelope
}

func (s *encodedEnvelopeSession) Fetch(w *imapserver.FetchWriter, _ imap.NumSet, _ *imap.FetchOptions) error {
	response := w.CreateMessage(1)
	response.WriteEnvelope(s.envelope)
	return response.Close()
}

func TestIMAPGBKEnvelopeTLSAndSTARTTLS(t *testing.T) {
	for _, mode := range []string{"tls", "starttls"} {
		t.Run(mode, func(t *testing.T) {
			serverTLS, clientTLS := testTLS(t)
			listener := listenTest(t, mode, serverTLS)
			memory := imapmemserver.New()
			user := imapmemserver.NewUser("test@example.com", "test-only-password")
			if err := user.Create("INBOX", nil); err != nil {
				t.Fatal(err)
			}
			memory.AddUser(user)
			server := imapserver.New(&imapserver.Options{TLSConfig: serverTLS, NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
				return &encodedEnvelopeSession{Session: memory.NewSession(), envelope: &imap.Envelope{
					Subject: gbkWord(t, "中文主题", mime.BEncoding),
					From:    []imap.Address{{Name: gbkWord(t, "中文发件人", mime.BEncoding), Mailbox: "test", Host: "example.com"}},
					To:      []imap.Address{{Name: gbkWord(t, "中文收件人", mime.QEncoding), Mailbox: "friend", Host: "example.com"}},
				}}, nil, nil
			}})
			go server.Serve(listener)
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			account := Account{Email: "test@example.com", IMAPHost: "127.0.0.1", IMAPPort: listener.Addr().(*net.TCPAddr).Port, IMAPTLS: mode}
			client, err := imapConnectContext(ctx, account, "test-only-password", clientTLS)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			raw := []byte("From: " + gbkWord(t, "中文发件人", mime.BEncoding) + " <test@example.com>\r\nTo: " + gbkWord(t, "中文收件人", mime.QEncoding) + " <friend@example.com>\r\nSubject: " + gbkWord(t, "中文主题", mime.BEncoding) + "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n正文")
			cmd := client.Append("INBOX", int64(len(raw)), nil)
			if _, err = cmd.Write(raw); err != nil {
				t.Fatal(err)
			}
			if err = cmd.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err = cmd.Wait(); err != nil {
				t.Fatal(err)
			}
			if _, err = client.Select("INBOX", nil).Wait(); err != nil {
				t.Fatal(err)
			}
			messages, err := client.Fetch(imap.SeqSetNum(1), &imap.FetchOptions{Envelope: true}).Collect()
			if err != nil || len(messages) != 1 {
				t.Fatalf("fetch: %v", err)
			}
			e := messages[0].Envelope
			if e.Subject != "中文主题" || formatAddresses(e.From) != "中文发件人 <test@example.com>" || formatAddresses(e.To) != "中文收件人 <friend@example.com>" {
				t.Fatal("IMAP envelope charset decoder not applied")
			}
		})
	}
}
