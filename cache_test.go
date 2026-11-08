package main

import (
	"fmt"
	"testing"
)

func insertCachedMessage(t *testing.T, s *MailService, id, account, folder string, uid int) {
	t.Helper()
	data := fmt.Sprintf(`{"id":%q,"accountId":%q,"folder":%q,"uid":%d,"validity":1,"subject":"cached"}`, id, account, folder, uid)
	if _, err := s.db.Exec("INSERT INTO messages VALUES(?,?,?,?,?,?)", id, account, folder, uid, 1, data); err != nil {
		t.Fatal(err)
	}
}

func countRows(t *testing.T, s *MailService, table string) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCacheStatsAndTrim(t *testing.T) {
	s, _ := testService(t)
	for i := 1; i <= 6; i++ {
		insertCachedMessage(t, s, fmt.Sprintf("a-inbox-%d", i), "account-a", "INBOX", i)
		insertCachedMessage(t, s, fmt.Sprintf("a-archive-%d", i), "account-a", "Archive", i)
		insertCachedMessage(t, s, fmt.Sprintf("b-inbox-%d", i), "account-b", "INBOX", i)
	}
	// Attachments for an old row, plus an orphan left by an older build.
	_, err := s.db.Exec("INSERT INTO attachments VALUES(?,?,?,?,?)", "a-inbox-1", 0, "old.pdf", 3, []byte("abc"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.db.Exec("INSERT INTO attachments VALUES(?,?,?,?,?)", "gone", 0, "orphan.pdf", 3, []byte("abc"))
	if err != nil {
		t.Fatal(err)
	}
	// A queued IMAP operation must not lose its message row.
	_, err = s.db.Exec("INSERT INTO pending_ops VALUES(?,?,?,?,?)",
		"op-1", "account-a", "a-archive-1", "2026-11-08T00:00:00Z", `{"kind":"seen"}`)
	if err != nil {
		t.Fatal(err)
	}

	settings := s.GetSettings()
	settings.CacheLimit = 3
	if _, err = s.SetSettings(settings); err != nil {
		t.Fatal(err)
	}
	// Three partitions × three newest rows, plus the queued old row.
	if got := countRows(t, s, "messages"); got != 10 {
		t.Fatalf("expected 10 retained messages, got %d", got)
	}
	for _, id := range []string{"a-inbox-6", "a-archive-6", "b-inbox-6", "a-archive-1"} {
		var n int
		if err = s.db.QueryRow("SELECT count(*) FROM messages WHERE id=?", id).Scan(&n); err != nil || n != 1 {
			t.Fatalf("row %s should have been kept (n=%d err=%v)", id, n, err)
		}
	}
	if got := countRows(t, s, "attachments"); got != 0 {
		t.Fatalf("attachments should be evicted with their message, got %d", got)
	}
	stats := s.CacheStats()
	if stats.Messages != 10 || stats.Limit != 3 || stats.HeaderBytes <= 0 {
		t.Fatalf("stats: %+v", stats)
	}
}

func TestCacheLimitZeroKeepsEverything(t *testing.T) {
	s, _ := testService(t)
	for i := 1; i <= 5; i++ {
		insertCachedMessage(t, s, fmt.Sprintf("m-%d", i), "account-a", "INBOX", i)
	}
	settings := s.GetSettings()
	settings.CacheLimit = 0
	if _, err := s.SetSettings(settings); err != nil {
		t.Fatal(err)
	}
	if _, err := s.TrimCache(); err != nil {
		t.Fatal(err)
	}
	if got := countRows(t, s, "messages"); got != 5 {
		t.Fatalf("unlimited cache evicted rows: %d", got)
	}
}

func TestSettingsNormaliseCacheLimit(t *testing.T) {
	cases := map[int]int{-5: 0, 0: 0, 3: 3, 500: 500, 99999: 20000}
	for input, want := range cases {
		if got := (Settings{CacheLimit: input}).normalised().CacheLimit; got != want {
			t.Fatalf("limit %d normalised to %d, want %d", input, got, want)
		}
	}
}
