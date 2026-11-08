package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	stdmail "net/mail"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
)

func testService(t *testing.T) (*MailService, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mail.db")
	s, err := openService(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.db.Close() })
	return s, path
}

func TestSettingsRoundTripAndNormalise(t *testing.T) {
	s, path := testService(t)
	if got := s.GetSettings(); got.SyncIntervalSec != 60 || !got.AutoMarkRead || got.RemoteDefault != "trusted" || got.AppendSent {
		t.Fatalf("defaults: %+v", got)
	}
	want, err := s.SetSettings(Settings{SyncIntervalSec: 5, AutoMarkRead: false, RemoteDefault: "??", AppendSent: true})
	if err != nil {
		t.Fatal(err)
	}
	if want.SyncIntervalSec != 15 || want.RemoteDefault != "trusted" || !want.AppendSent {
		t.Fatalf("normalised: %+v", want)
	}
	if len(s.settingsChanged) != 1 {
		t.Fatal("the monitor was not told to pick up the new interval")
	}
	s.db.Close()
	reopened, err := openService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.db.Close()
	if got := reopened.GetSettings(); got != want {
		t.Fatalf("after restart: %+v want %+v", got, want)
	}
}

func TestDraftSlotsAreIndependentAndLegacyMigrates(t *testing.T) {
	s, path := testService(t)
	a, err := s.LoadDemo()
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct{ key, subject string }{{"reply:A", "回复 A"}, {"reply:B", "回复 B"}} {
		if err = s.SaveDraft(Draft{AccountID: a.ID, Key: item.key, Subject: item.subject, Body: "正文"}); err != nil {
			t.Fatal(err)
		}
	}
	first, err := s.GetDraft(a.ID, "reply:A")
	if err != nil || first.Subject != "回复 A" || first.Key != "reply:A" {
		t.Fatalf("slot A: %+v %v", first, err)
	}
	second, err := s.GetDraft(a.ID, "reply:B")
	if err != nil || second.Subject != "回复 B" {
		t.Fatalf("slot B: %+v %v", second, err)
	}
	all, err := s.ListDrafts(a.ID)
	if err != nil || len(all) != 2 {
		t.Fatalf("list: %d %v", len(all), err)
	}
	if err = s.ClearDraft(a.ID, "reply:A"); err != nil {
		t.Fatal(err)
	}
	first, _ = s.GetDraft(a.ID, "reply:A")
	if first.Subject != "" {
		t.Fatal("cleared slot still has a draft")
	}
	// A database written by 0.1.8 keeps its single draft in the old table.
	old, _ := json.Marshal(Draft{AccountID: a.ID, To: "old@example.com", Subject: "旧草稿", Body: "升级前"})
	if _, err = s.db.Exec("INSERT OR REPLACE INTO drafts VALUES(?,?)", a.ID, string(old)); err != nil {
		t.Fatal(err)
	}
	s.db.Close()
	upgraded, err := openService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.db.Close()
	migrated, err := upgraded.GetDraft(a.ID, "new")
	if err != nil || migrated.Subject != "旧草稿" || migrated.Key != "new" {
		t.Fatalf("migration: %+v %v", migrated, err)
	}
}

func TestBuildMailBccAttachmentsAndBody(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(path, []byte("附件内容"), 0600); err != nil {
		t.Fatal(err)
	}
	d := Draft{
		To:      "a@example.com",
		Cc:      "c@example.com",
		Bcc:     "b@example.com, a@example.com",
		Subject: "测试",
		Body:    "中文正文\n第二行",
		Attachments: []DraftAttachment{
			{Name: "notes.txt", Size: 12, Path: path},
		},
	}
	raw, to, err := buildMail(Account{Email: "me@example.com"}, d)
	if err != nil {
		t.Fatal(err)
	}
	if len(to) != 3 || to[0] != "a@example.com" || to[1] != "c@example.com" || to[2] != "b@example.com" {
		t.Fatalf("envelope: %+v", to)
	}
	parsed, err := stdmail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Header.Get("Bcc") != "" {
		t.Fatal("Bcc leaked into the headers")
	}
	if parsed.Header.Get("Cc") == "" {
		t.Fatal("Cc header missing")
	}
	plain, rich, parts, err := parseBody(raw)
	if err != nil {
		t.Fatal(err)
	}
	wantPlain := strings.ReplaceAll(d.Body, "\n", "\r\n")
	if plain != wantPlain || !bytes.Contains([]byte(rich), []byte("中文正文")) {
		t.Fatalf("body: plain=%q rich=%q", plain, rich)
	}
	if len(parts) != 1 || parts[0].Name != "notes.txt" || string(parts[0].Data) != "附件内容" {
		t.Fatalf("attachments: %+v", parts)
	}
	if _, _, err = buildMail(Account{Email: "me@example.com"}, Draft{To: "a@example.com", Attachments: []DraftAttachment{{Path: filepath.Join(t.TempDir(), "gone")}}}); err == nil {
		t.Fatal("a missing attachment should be rejected before sending")
	}
}

func TestMailOpsAreLocalFirstForDemo(t *testing.T) {
	s, _ := testService(t)
	_, err := s.LoadDemo()
	if err != nil {
		t.Fatal(err)
	}
	id := "local-demo:INBOX:1:1"
	if _, err = s.SetSeen(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SetFlagged(id, true); err != nil {
		t.Fatal(err)
	}
	m, err := s.cached(id)
	if err != nil || !m.Seen || !m.Flagged {
		t.Fatalf("local flags: %+v %v", m, err)
	}
	if got := s.PendingCount(); got != 0 {
		t.Fatalf("demo accounts must not queue IMAP writes: %d", got)
	}
	if _, err = s.DeleteMessage(id, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.cached(id); err == nil {
		t.Fatal("deleted message is still cached")
	}
}

func TestPendingQueueSurvivesRestartAndReconciles(t *testing.T) {
	s, path := testService(t)
	a, err := s.LoadDemo()
	if err != nil {
		t.Fatal(err)
	}
	id := "local-demo:INBOX:1:1"
	before, _ := s.cached(id)
	op := PendingOp{
		ID: "demo:" + id + ":seen", Kind: "seen", MessageID: id,
		AccountID: a.ID, Folder: "INBOX", UID: 1, Validity: 1,
		Value: true, Before: &before, CreatedAt: time.Now().Format(time.RFC3339Nano),
	}
	if err = s.writeOp(op); err != nil {
		t.Fatal(err)
	}
	// A header sync must not undo the optimistic value.
	s.reconcilePending(a.ID)
	m, _ := s.cached(id)
	if !m.Seen {
		t.Fatal("sync overwrote the pending seen flag")
	}
	s.db.Close()
	reopened, err := openService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.db.Close()
	ops, err := reopened.pendingOps(a.ID)
	if err != nil || len(ops) != 1 || ops[0].Kind != "seen" {
		t.Fatalf("queue after restart: %+v %v", ops, err)
	}
	reopened.rollbackOp(ops[0])
	reopened.finishOp(ops[0].ID)
	restored, err := reopened.cached(id)
	if err != nil || restored.Seen {
		t.Fatalf("rollback: %+v %v", restored, err)
	}
	if got := reopened.PendingCount(); got != 0 {
		t.Fatalf("queue not drained: %d", got)
	}
}

func TestApplyRemoteOnClientFlagsAndMove(t *testing.T) {
	serverTLS, clientTLS := testTLS(t)
	listener := listenTest(t, "tls", serverTLS)
	memory := imapmemserver.New()
	user := imapmemserver.NewUser("test@example.com", "test-only-password")
	for _, name := range []string{"INBOX", "Archive", "Trash"} {
		if err := user.Create(name, nil); err != nil {
			t.Fatal(err)
		}
	}
	memory.AddUser(user)
	server := imapserver.New(&imapserver.Options{
		TLSConfig: serverTLS,
		Caps:      imap.CapSet{imap.CapIMAP4rev1: {}, imap.CapUIDPlus: {}, imap.CapMove: {}},
		NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
			return memory.NewSession(), nil, nil
		},
	})
	go server.Serve(listener)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	account := Account{Email: "test@example.com", IMAPHost: "127.0.0.1", IMAPPort: listener.Addr().(*net.TCPAddr).Port, IMAPTLS: "tls"}
	client, err := imapConnectContext(ctx, account, "test-only-password", clientTLS)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	raw := []byte("From: test@example.com\r\nSubject: test\r\n\r\nbody")
	cmd := client.Append("INBOX", int64(len(raw)), nil)
	if _, err = cmd.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err = cmd.Close(); err != nil {
		t.Fatal(err)
	}
	appended, err := cmd.Wait()
	if err != nil {
		t.Fatal(err)
	}
	box, err := client.Select("INBOX", nil).Wait()
	if err != nil {
		t.Fatal(err)
	}
	op := PendingOp{Kind: "seen", Folder: "INBOX", UID: uint32(appended.UID), Validity: box.UIDValidity, Value: true}
	if err = applyRemoteOnClient(client, op); err != nil {
		t.Fatalf("set seen: %v", err)
	}
	op.Kind, op.Value = "flagged", true
	if err = applyRemoteOnClient(client, op); err != nil {
		t.Fatalf("set flagged: %v", err)
	}
	rows, err := client.Fetch(imap.UIDSetNum(appended.UID), &imap.FetchOptions{UID: true, Flags: true}).Collect()
	if err != nil || len(rows) != 1 {
		t.Fatalf("fetch flags: %v", err)
	}
	found := map[imap.Flag]bool{}
	for _, flag := range rows[0].Flags {
		found[flag] = true
	}
	if !found[imap.FlagSeen] || !found[imap.FlagFlagged] {
		t.Fatalf("flags on server: %+v", rows[0].Flags)
	}
	op.Kind, op.Target = "move", "Archive"
	if err = applyRemoteOnClient(client, op); err != nil {
		t.Fatalf("move: %v", err)
	}
	archive, err := client.Select("Archive", nil).Wait()
	if err != nil || archive.NumMessages != 1 {
		t.Fatalf("archive: %+v %v", archive, err)
	}
	op.Kind, op.Target, op.Validity, op.Folder = "delete", "", archive.UIDValidity, "Archive"
	// A message already in the archive has a different UID; look it up rather
	// than assuming the UID survived the MOVE.
	list, err := client.Fetch(imap.SeqSetNum(1), &imap.FetchOptions{UID: true}).Collect()
	if err != nil || len(list) != 1 {
		t.Fatalf("archived uid: %v", err)
	}
	op.UID, op.Permanent = uint32(list[0].UID), true
	if err = applyRemoteOnClient(client, op); err != nil {
		t.Fatalf("permanent delete: %v", err)
	}
	after, err := client.Select("Archive", nil).Wait()
	if err != nil || after.NumMessages != 0 {
		t.Fatalf("archive after delete: %+v %v", after, err)
	}
}
