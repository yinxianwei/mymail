package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStalledConnectionIsCancelledAndLogsAreRedacted(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(previous)
	for _, protocol := range []string{"imap", "smtp"} {
		for _, mode := range []string{"tls", "starttls"} {
			t.Run(protocol+"/"+mode, func(t *testing.T) {
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				defer listener.Close()
				serverDone := make(chan struct{})
				go func() {
					defer close(serverDone)
					conn, e := listener.Accept()
					if e != nil {
						return
					}
					defer conn.Close()
					_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
					_, _ = io.Copy(io.Discard, conn)
				}()
				port := listener.Addr().(*net.TCPAddr).Port
				a := Account{Email: "private-address@example.com", IMAPHost: "127.0.0.1", IMAPPort: port, IMAPTLS: mode, SMTPHost: "127.0.0.1", SMTPPort: port, SMTPTLS: mode}
				ctx, cancel := context.WithTimeout(context.WithValue(context.Background(), connectionTraceKey{}, "test-stall"), 120*time.Millisecond)
				defer cancel()
				result := make(chan error, 1)
				go func() {
					cfg := &tls.Config{ServerName: "127.0.0.1", MinVersion: tls.VersionTLS12}
					if protocol == "imap" {
						c, e := imapConnectContext(ctx, a, "secret-never-log-this", cfg)
						if c != nil {
							c.Close()
						}
						result <- e
					} else {
						c, e := smtpConnectContext(ctx, a, "secret-never-log-this", cfg)
						if c != nil {
							c.Close()
						}
						result <- e
					}
				}()
				select {
				case err := <-result:
					if err == nil {
						t.Fatal("silent server accepted")
					}
				case <-time.After(time.Second):
					t.Fatal("connection ignored context deadline")
				}
				<-serverDone
			})
		}
	}
	text := logs.String()
	for _, sensitive := range []string{"secret-never-log-this", "private-address@example.com"} {
		if strings.Contains(text, sensitive) {
			t.Fatal("sensitive data in logs")
		}
	}
	for _, expected := range []string{"connection.step.started", "connection.step.finished", "test-stall", "duration_ms", "error_category"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("missing diagnostic: %s", expected)
		}
	}
}
func TestLogRotationAndPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "logs", "app.jsonl")
	w, err := newRotatingLog(path, 60)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		if _, err = w.Write([]byte(strings.Repeat("x", 39) + "\n")); err != nil {
			t.Fatal(err)
		}
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(path + "*")
	if err != nil || len(files) != 4 {
		t.Fatalf("rotation files: %v %v", files, err)
	}
	for _, file := range files {
		stat, err := os.Stat(file)
		if err != nil {
			t.Fatal(err)
		}
		if stat.Size() > 60 {
			t.Fatal("log exceeded rotation limit")
		}
		if stat.Mode().Perm()&0077 != 0 {
			t.Fatal("log is readable by other users")
		}
	}
}
