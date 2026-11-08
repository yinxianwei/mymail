package main

import (
	"bytes"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-message/mail"
)

func TestSQLiteSurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mail.db")
	s, err := openService(path)
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.LoadDemo()
	if err != nil {
		t.Fatal(err)
	}
	draft := Draft{AccountID: a.ID, To: "friend@example.com", Subject: "未完成", Body: "重启后继续写"}
	if err = s.SaveDraft(draft); err != nil {
		t.Fatal(err)
	}
	s.db.Close()
	s, err = openService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	state, err := s.State()
	if err != nil || len(state.Accounts) != 1 {
		t.Fatalf("state: %+v %v", state, err)
	}
	ms, err := s.Messages(a.ID, "INBOX")
	if err != nil || len(ms) != 1 {
		t.Fatalf("messages: %+v %v", ms, err)
	}
	if ms[0].HTML != "" || ms[0].Text != "" {
		t.Fatal("list leaked body payload")
	}
	body, err := s.ReadMessage(ms[0].ID)
	if err != nil || !strings.Contains(body.Text, "SQLite") {
		t.Fatalf("offline read: %+v %v", body, err)
	}
	restored, err := s.GetDraft(a.ID, "new")
	if err != nil || restored.To != draft.To || restored.Subject != draft.Subject || restored.Body != draft.Body || restored.Key != "new" {
		t.Fatalf("draft: %+v %v", restored, err)
	}
}
func TestMIMERoundTripChinese(t *testing.T) {
	d := Draft{To: "小王 <friend@example.com>,other@example.com", Subject: "你好，世界", Body: "中文正文\n第二行 <script>不能执行</script>"}
	raw, to, err := buildMail(Account{Email: "me@example.com"}, d)
	if err != nil {
		t.Fatal(err)
	}
	if len(to) != 2 {
		t.Fatal(to)
	}
	plain, rich, _, err := parseBody(raw)
	if err != nil {
		t.Fatal(err)
	}
	// MIME transport canonicalizes newlines to CRLF.
	if strings.ReplaceAll(plain, "\r\n", "\n") != d.Body {
		t.Fatalf("plain: %q", plain)
	}
	if !strings.Contains(rich, "&lt;script&gt;") || strings.Contains(rich, "<script>") {
		t.Fatal("outgoing HTML was not escaped")
	}
	if !bytes.Contains(raw, []byte("multipart/alternative")) {
		t.Fatal("missing alternative MIME")
	}
}
func TestLegacyGBKBody(t *testing.T) {
	raw := []byte("From: a@example.com\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=gb2312\r\nContent-Transfer-Encoding: base64\r\n\r\nxOO6ww==\r\n")
	plain, _, _, err := parseBody(raw)
	if err != nil || strings.TrimSpace(plain) != "你好" {
		t.Fatalf("GBK: %q %v", plain, err)
	}
}
func TestRejectHeaderInjectionAndInvalidRecipients(t *testing.T) {
	for _, d := range []Draft{{To: "invalid", Body: "x"}, {To: "a@example.com", Subject: "ok\r\nBcc: secret@example.com"}} {
		if _, _, err := buildMail(Account{Email: "me@example.com"}, d); err == nil {
			t.Fatal("unsafe input accepted")
		}
	}
	a := Account{Email: "me@example.com", IMAPHost: "imap.example.com", IMAPPort: 993, IMAPTLS: "none", SMTPHost: "smtp.example.com", SMTPPort: 465, SMTPTLS: "tls"}
	if validateAccount(a) == nil {
		t.Fatal("unencrypted account accepted")
	}
}
func TestIMAPTLSFailureDoesNotSendPassword(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	received := make(chan []byte, 1)
	go func() {
		conn, e := listener.Accept()
		if e != nil {
			received <- nil
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		buf := make([]byte, 8192)
		n, _ := conn.Read(buf)
		_, _ = conn.Write([]byte("not a TLS server\r\n"))
		received <- buf[:n]
	}()
	port := listener.Addr().(*net.TCPAddr).Port
	_, err = imapConnect(Account{Email: "me@example.com", IMAPHost: "127.0.0.1", IMAPPort: port, IMAPTLS: "tls"}, "never-leak-this-password")
	if err == nil {
		t.Fatal("invalid TLS accepted")
	}
	if bytes.Contains(<-received, []byte("never-leak-this-password")) {
		t.Fatal("password sent before TLS")
	}
}

func TestBuildMailCarriesCarbonCopies(t *testing.T) {
	d := Draft{To: "a@example.com", Cc: "b@example.com, c@example.com", Subject: "抄送测试", Body: "正文"}
	raw, envelope, err := buildMail(Account{Email: "me@example.com"}, d)
	if err != nil {
		t.Fatal(err)
	}
	// Cc is delivered by RCPT TO, so the envelope must contain it too.
	if len(envelope) != 3 {
		t.Fatalf("envelope: %v", envelope)
	}
	r, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	cc := r.Header.Get("Cc")
	if !strings.Contains(cc, "b@example.com") || !strings.Contains(cc, "c@example.com") {
		t.Fatalf("Cc header: %q", cc)
	}
	// A duplicate between To and Cc is delivered once, not twice.
	dup := Draft{To: "a@example.com", Cc: "a@example.com", Subject: "重复", Body: "正文"}
	if _, envelope, err = buildMail(Account{Email: "me@example.com"}, dup); err != nil {
		t.Fatal(err)
	}
	if len(envelope) != 1 {
		t.Fatalf("duplicate envelope: %v", envelope)
	}
	// Header injection through Cc must not reach the message.
	if _, _, err = buildMail(Account{Email: "me@example.com"}, Draft{To: "a@example.com", Cc: "b@example.com\r\nBcc: secret@example.com", Body: "x"}); err == nil {
		t.Fatal("Cc injection accepted")
	}
}
