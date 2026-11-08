package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
)

// QQ discards LOGIN commands sent before its greeting. A server that writes its
// greeting immediately (such as the in-memory fixture) does not expose this race.
func TestIMAPWaitsForGreetingBeforeLogin(t *testing.T) {
	serverTLS, clientTLS := testTLS(t)
	listener := listenTest(t, "tls", serverTLS)
	outcome := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			outcome <- err
			return
		}
		defer conn.Close()
		secure := conn.(*tls.Conn)
		if err := secure.Handshake(); err != nil {
			outcome <- err
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
		probe := make([]byte, 1024)
		n, err := conn.Read(probe)
		if n != 0 {
			outcome <- errors.New("client sent a command before the greeting")
			return
		}
		var timeout net.Error
		if !errors.As(err, &timeout) || !timeout.Timeout() {
			outcome <- errors.New("expected greeting delay")
			return
		}
		_ = conn.SetDeadline(time.Now().Add(time.Second))
		if _, err = io.WriteString(conn, "* OK [CAPABILITY IMAP4rev1] test ready\r\n"); err != nil {
			outcome <- err
			return
		}
		line, err := bufio.NewReader(conn).ReadString('\n')
		if err != nil {
			outcome <- err
			return
		}
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[1] != "LOGIN" {
			outcome <- errors.New("expected LOGIN after greeting")
			return
		}
		_, err = fmt.Fprintf(conn, "%s NO [AUTHENTICATIONFAILED] Test credentials denied\r\n", fields[0])
		outcome <- err
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	account := Account{Email: "test@example.com", IMAPHost: "127.0.0.1", IMAPPort: listener.Addr().(*net.TCPAddr).Port, IMAPTLS: "tls"}
	client, err := imapConnectContext(ctx, account, "test-only-password", clientTLS)
	if client != nil {
		client.Close()
	}
	if serverErr := <-outcome; serverErr != nil {
		t.Fatal(serverErr)
	}
	if err == nil || ctx.Err() != nil {
		t.Fatalf("expected immediate authentication rejection, got err=%v context=%v", err, ctx.Err())
	}
}

func testTLS(t *testing.T) (*tls.Config, *tls.Config) {
	t.Helper()
	temp := httptest.NewTLSServer(nil)
	defer temp.Close()
	cert := temp.TLS.Certificates[0]
	root, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(root)
	return &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}, &tls.Config{RootCAs: pool, ServerName: "127.0.0.1", MinVersion: tls.VersionTLS12}
}
func listenTest(t *testing.T, mode string, cfg *tls.Config) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	if mode == "tls" {
		return tls.NewListener(ln, cfg)
	}
	return ln
}
func TestIMAPTLSAndSTARTTLS(t *testing.T) {
	for _, mode := range []string{"tls", "starttls"} {
		t.Run(mode, func(t *testing.T) {
			serverTLS, clientTLS := testTLS(t)
			ln := listenTest(t, mode, serverTLS)
			memory := imapmemserver.New()
			user := imapmemserver.NewUser("test@example.com", "test-only-password")
			if err := user.Create("INBOX", nil); err != nil {
				t.Fatal(err)
			}
			memory.AddUser(user)
			server := imapserver.New(&imapserver.Options{TLSConfig: serverTLS, NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
				return memory.NewSession(), nil, nil
			}})
			go server.Serve(ln)
			defer server.Close()
			a := Account{Email: "test@example.com", IMAPHost: "127.0.0.1", IMAPPort: ln.Addr().(*net.TCPAddr).Port, IMAPTLS: mode}
			client, err := imapConnectWithTLS(a, "test-only-password", clientTLS)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			raw, _, err := buildMail(a, Draft{To: "friend@example.com", Subject: "协议联调", Body: "中文邮件通过 TLS 链路"})
			if err != nil {
				t.Fatal(err)
			}
			appendCmd := client.Append("INBOX", int64(len(raw)), nil)
			if _, err = appendCmd.Write(raw); err != nil {
				t.Fatal(err)
			}
			if err = appendCmd.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err = appendCmd.Wait(); err != nil {
				t.Fatal(err)
			}
			box, err := client.Select("INBOX", &imap.SelectOptions{ReadOnly: true}).Wait()
			if err != nil || box.NumMessages != 1 {
				t.Fatalf("select: %+v %v", box, err)
			}
			section := &imap.FetchItemBodySection{Peek: true, Partial: &imap.SectionPartial{Size: maxBodyBytes + 1}}
			items, err := client.Fetch(imap.SeqSetNum(1), &imap.FetchOptions{UID: true, Envelope: true, BodySection: []*imap.FetchItemBodySection{section}}).Collect()
			if err != nil || len(items) != 1 {
				t.Fatalf("fetch: %v", err)
			}
			if items[0].Envelope.Subject != "协议联调" || items[0].UID == 0 {
				t.Fatal("invalid envelope or UID")
			}
			plain, _, _, err := parseBody(items[0].FindBodySection(section))
			if err != nil || !strings.Contains(plain, "中文邮件通过 TLS 链路") {
				t.Fatalf("body: %q %v", plain, err)
			}
		})
	}
}

type testSMTPBackend struct{ received chan []byte }

func (b *testSMTPBackend) NewSession(*smtp.Conn) (smtp.Session, error) {
	return &testSMTPSession{received: b.received}, nil
}

type testSMTPSession struct {
	auth     bool
	received chan []byte
}

func (s *testSMTPSession) AuthMechanisms() []string { return []string{sasl.Plain} }
func (s *testSMTPSession) Auth(string) (sasl.Server, error) {
	return sasl.NewPlainServer(func(_, user, password string) error {
		if user != "test@example.com" || password != "test-only-password" {
			return errors.New("bad credentials")
		}
		s.auth = true
		return nil
	}), nil
}
func (s *testSMTPSession) Mail(string, *smtp.MailOptions) error {
	if !s.auth {
		return smtp.ErrAuthRequired
	}
	return nil
}
func (s *testSMTPSession) Rcpt(string, *smtp.RcptOptions) error {
	if !s.auth {
		return smtp.ErrAuthRequired
	}
	return nil
}
func (s *testSMTPSession) Data(r io.Reader) error {
	data, err := io.ReadAll(r)
	if err == nil {
		s.received <- data
	}
	return err
}
func (s *testSMTPSession) Reset()        {}
func (s *testSMTPSession) Logout() error { return nil }
func TestSMTPTLSAndSTARTTLS(t *testing.T) {
	for _, mode := range []string{"tls", "starttls"} {
		t.Run(mode, func(t *testing.T) {
			serverTLS, clientTLS := testTLS(t)
			ln := listenTest(t, mode, serverTLS)
			received := make(chan []byte, 1)
			server := smtp.NewServer(&testSMTPBackend{received: received})
			server.Domain = "localhost"
			server.TLSConfig = serverTLS
			server.ReadTimeout = 5 * time.Second
			server.WriteTimeout = 5 * time.Second
			go server.Serve(ln)
			defer server.Close()
			a := Account{Email: "test@example.com", SMTPHost: "127.0.0.1", SMTPPort: ln.Addr().(*net.TCPAddr).Port, SMTPTLS: mode}
			client, err := smtpConnectWithTLS(a, "test-only-password", clientTLS)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			raw, to, err := buildMail(a, Draft{To: "friend@example.com", Subject: "发送测试", Body: "测试 SMTP 中文正文"})
			if err != nil {
				t.Fatal(err)
			}
			if err = client.SendMail(a.Email, to, bytes.NewReader(raw)); err != nil {
				t.Fatal(err)
			}
			select {
			case data := <-received:
				plain, _, _, err := parseBody(data)
				if err != nil || !strings.Contains(plain, "测试 SMTP 中文正文") {
					t.Fatalf("received: %q %v", plain, err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("SMTP delivery timed out")
			}
		})
	}
}
