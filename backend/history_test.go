package main

import (
	"fmt"
	"net"
	"path/filepath"
	"testing"

	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
)

// A mailbox larger than the recent sync window must page backwards through
// UIDs, and a later sync must not discard the history pages already cached.
func TestHistoryPagingKeepsOlderPages(t *testing.T) {
	serverTLS, clientTLS := testTLS(t)
	listener := listenTest(t, "tls", serverTLS)
	memory := imapmemserver.New()
	user := imapmemserver.NewUser("test@example.com", "test-only-password")
	if err := user.Create("INBOX", nil); err != nil {
		t.Fatal(err)
	}
	memory.AddUser(user)
	server := imapserver.New(&imapserver.Options{
		TLSConfig: serverTLS,
		NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			return memory.NewSession(), nil, nil
		},
	})
	go server.Serve(listener)
	defer server.Close()

	account := Account{
		Email:    "test@example.com",
		IMAPHost: "127.0.0.1",
		IMAPPort: listener.Addr().(*net.TCPAddr).Port,
		IMAPTLS:  "tls",
	}
	client, err := imapConnectWithTLS(account, "test-only-password", clientTLS)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 120; i++ {
		raw, _, err := buildMail(account, Draft{
			To:      "friend@example.com",
			Subject: fmt.Sprintf("history %03d", i),
			Body:    "body",
		})
		if err != nil {
			t.Fatal(err)
		}
		appendCommand := client.Append("INBOX", int64(len(raw)), nil)
		if _, err = appendCommand.Write(raw); err != nil {
			t.Fatal(err)
		}
		if err = appendCommand.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err = appendCommand.Wait(); err != nil {
			t.Fatal(err)
		}
	}
	client.Close()

	service, err := openService(filepath.Join(t.TempDir(), "mail.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer service.db.Close()

	connect := func() *imapclient.Client {
		t.Helper()
		c, err := imapConnectWithTLS(account, "test-only-password", clientTLS)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}

	sync := func(c *imapclient.Client) []Message {
		t.Helper()
		rows, err := service.syncWithClient(c, "account", "INBOX")
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}

	recentClient := connect()
	recent := sync(recentClient)
	recentClient.Close()
	if len(recent) != historyPageSize {
		t.Fatalf("recent window = %d, want %d", len(recent), historyPageSize)
	}
	if recent[0].UID != 120 || recent[len(recent)-1].UID != 71 {
		t.Fatalf("recent window UIDs = %d..%d", recent[0].UID, recent[len(recent)-1].UID)
	}

	first := connect()
	page, err := service.loadOlderWithClient(first, "account", "INBOX", recent[len(recent)-1].UID, recent[0].Validity)
	first.Close()
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 50 || !page.HasMore || page.NextUID != 21 {
		t.Fatalf("first page: count=%d hasMore=%v next=%d", len(page.Messages), page.HasMore, page.NextUID)
	}
	if page.Messages[0].UID != 70 || page.Messages[len(page.Messages)-1].UID != 21 {
		t.Fatalf("first page UIDs = %d..%d", page.Messages[0].UID, page.Messages[len(page.Messages)-1].UID)
	}

	second := connect()
	page, err = service.loadOlderWithClient(second, "account", "INBOX", page.NextUID, page.Validity)
	second.Close()
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 20 || page.HasMore || page.NextUID != 1 {
		t.Fatalf("second page: count=%d hasMore=%v next=%d", len(page.Messages), page.HasMore, page.NextUID)
	}

	cached, err := service.Messages("account", "INBOX")
	if err != nil {
		t.Fatal(err)
	}
	if len(cached) != 120 {
		t.Fatalf("cached pages = %d, want 120", len(cached))
	}

	// The next refresh only reconciles the recent window and must keep the
	// older pages available for offline reading.
	afterClient := connect()
	after := sync(afterClient)
	afterClient.Close()
	if len(after) != 120 {
		t.Fatalf("refresh discarded history: %d rows", len(after))
	}
}
