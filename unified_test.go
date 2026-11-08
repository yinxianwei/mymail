package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestAllInboxesKeepAccountIdentityAndSortDates(t *testing.T) {
	s, err := openService(filepath.Join(t.TempDir(), "mail.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	for _, id := range []string{"first", "second"} {
		a := Account{ID: id, Email: id + "@example.invalid"}
		raw, _ := json.Marshal(a)
		if _, err = s.db.Exec("INSERT INTO accounts VALUES(?,?)", id, string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	fixtures := []Message{
		{ID: "first-inbox", AccountID: "first", Folder: "INBOX", UID: 1, Date: "2026-11-07T10:00:00+08:00", Subject: "first", Text: "private body", HTML: "<p>private</p>", Cached: true},
		{ID: "second-inbox", AccountID: "second", Folder: "INBOX", UID: 1, Date: "2026-11-07T03:00:00Z", Subject: "second", Text: "private body", Cached: true},
		{ID: "sent", AccountID: "first", Folder: "Sent", UID: 2, Date: "2026-11-07T12:00:00Z"},
		{ID: "orphan", AccountID: "removed", Folder: "INBOX", UID: 3, Date: "2026-11-07T12:00:00Z"},
	}
	for _, m := range fixtures {
		if err = s.putMessage(m); err != nil {
			t.Fatal(err)
		}
	}
	messages, err := s.AllInboxMessages()
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 || messages[0].ID != "second-inbox" || messages[1].ID != "first-inbox" {
		t.Fatal("unified inbox mixed folders or sorted timezone strings incorrectly")
	}
	for _, m := range messages {
		if m.UID != 1 || m.AccountID == "" || m.Text != "" || m.HTML != "" {
			t.Fatal("account identity lost or body leaked into list")
		}
	}
	first, err := s.Messages("first", "INBOX")
	if err != nil || len(first) != 1 || first[0].ID != "first-inbox" {
		t.Fatal("account-specific view mixed accounts")
	}
}
