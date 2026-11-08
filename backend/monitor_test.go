package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net"
	"path/filepath"
	"testing"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/emersion/go-imap/v2/imapserver/imapmemserver"
)

func TestInboxCountsAndNewMailDetection(t *testing.T) {
	serverTLS, clientTLS := testTLS(t)
	listener := listenTest(t, "tls", serverTLS)
	memory := imapmemserver.New()
	user := imapmemserver.NewUser("test@example.com", "test-only-password")
	if err := user.Create("INBOX", nil); err != nil {
		t.Fatal(err)
	}
	memory.AddUser(user)
	server := imapserver.New(&imapserver.Options{TLSConfig: serverTLS, Caps: imap.CapSet{imap.CapIMAP4rev1: {}, imap.CapUIDPlus: {}}, NewSession: func(*imapserver.Conn) (imapserver.Session, *imapserver.GreetingData, error) {
		return memory.NewSession(), nil, nil
	}})
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
	appendMail := func(seen bool) imap.UID {
		t.Helper()
		raw := []byte("From: test@example.com\r\nSubject: test\r\n\r\nbody")
		options := &imap.AppendOptions{}
		if seen {
			options.Flags = []imap.Flag{imap.FlagSeen}
		}
		cmd := client.Append("INBOX", int64(len(raw)), options)
		if _, err := cmd.Write(raw); err != nil {
			t.Fatal(err)
		}
		if err := cmd.Close(); err != nil {
			t.Fatal(err)
		}
		data, err := cmd.Wait()
		if err != nil {
			t.Fatal(err)
		}
		return data.UID
	}
	// More unseen mail than the UI's 50-message cache window.
	for range 61 {
		appendMail(false)
	}
	baseline, notice, err := inspectInbox(client, "account-a", InboxCheckpoint{})
	if err != nil {
		t.Fatal(err)
	}
	if baseline.Unread != 61 || notice.Count != 0 {
		t.Fatalf("first run: unread=%d new=%d", baseline.Unread, notice.Count)
	}
	newUID := appendMail(false)
	appendMail(true)
	current, notice, err := inspectInbox(client, "account-a", baseline)
	if err != nil {
		t.Fatal(err)
	}
	if current.Unread != 62 || notice.Count != 1 || notice.Target.UID != uint32(newUID) {
		t.Fatalf("arrival: %+v %+v", current, notice)
	}
	_, duplicate, err := inspectInbox(client, "account-a", current)
	if err != nil || duplicate.Count != 0 {
		t.Fatal("notification duplicated on next poll")
	}
	if _, err = client.Select("INBOX", nil).Wait(); err != nil {
		t.Fatal(err)
	}
	if _, err = client.Store(imap.SeqSetNum(1), &imap.StoreFlags{Op: imap.StoreFlagsAdd, Flags: []imap.Flag{imap.FlagSeen}}, nil).Collect(); err != nil {
		t.Fatal(err)
	}
	read, notice, err := inspectInbox(client, "account-a", current)
	if err != nil || read.Unread != 61 || notice.Count != 0 {
		t.Fatal("read status not reflected or old mail notified")
	}
	if _, err = client.Store(imap.SeqSetNum(1), &imap.StoreFlags{Op: imap.StoreFlagsDel, Flags: []imap.Flag{imap.FlagSeen}}, nil).Collect(); err != nil {
		t.Fatal(err)
	}
	_, notice, err = inspectInbox(client, "account-a", read)
	if err != nil || notice.Count != 0 {
		t.Fatal("marking old mail unread must not notify")
	}
	reset := current
	reset.Validity++
	_, notice, err = inspectInbox(client, "account-a", reset)
	if err != nil || notice.Count != 0 {
		t.Fatal("UIDVALIDITY reset notified historical mail")
	}
}

func TestDesktopPreferencesAndCountersSurviveRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mail.db")
	s, err := openService(path)
	if err != nil {
		t.Fatal(err)
	}
	if !s.DesktopState().Notifications {
		t.Fatal("notifications should default on")
	}
	if _, err = s.SetNotifications(false); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`INSERT INTO metadata VALUES('inbox:account-a','{"accountId":"account-a","validity":1,"uidNext":8,"unread":7}')`); err != nil {
		t.Fatal(err)
	}
	s.db.Close()
	s, err = openService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	state := s.DesktopState()
	if state.Notifications || state.Unread != 7 || state.AccountUnread["account-a"] != 7 {
		t.Fatalf("state: %+v", state)
	}
	state.AccountUnread["account-a"] = 999
	if s.DesktopState().AccountUnread["account-a"] != 7 {
		t.Fatal("caller mutated internal state")
	}
}
func TestNotificationTargetAndTrayImage(t *testing.T) {
	target := MailTarget{AccountID: "opaque-account", UID: 42, Validity: 7}
	decoded, ok := parseNotificationID(notificationID(target))
	if !ok || decoded != target {
		t.Fatal("notification target round trip failed")
	}
	for _, bad := range []string{"", "notification-test", "mail:invalid", notificationID(MailTarget{})} {
		if _, ok := parseNotificationID(bad); ok {
			t.Fatal("invalid notification target accepted")
		}
	}
	for _, count := range []int{0, 1, 99, 99999} {
		decoded, err := png.Decode(bytes.NewReader(trayImage(count)))
		if err != nil || decoded.Bounds().Dx() != 32 {
			t.Fatal("tray icon invalid")
		}
	}
	if unreadLabel(0) != "" || unreadLabel(12) != "12" || unreadLabel(10000) != "9999+" {
		t.Fatal("invalid tray count label")
	}
}

// The menu bar icon is the app's monogram, not the old outlined envelope: two
// uprights and a deep V, with the same 514:474 ink-box proportion as
// design/logo/logo.svg.
func TestTrayImageUsesAppMonogram(t *testing.T) {
	decoded, err := png.Decode(bytes.NewReader(trayImage(0)))
	if err != nil {
		t.Fatal(err)
	}
	alpha := func(x, y int) uint32 {
		_, _, _, a := decoded.At(x, y).RGBA()
		return a
	}
	for _, p := range [][2]int{{6, 16}, {26, 16}, {16, 22}, {6, 8}, {26, 8}} {
		if alpha(p[0], p[1]) < 200*257 {
			t.Fatalf("missing monogram ink at %v", p)
		}
	}
	// The old envelope's flat top edge crossed (16, 8); the M's counter and
	// the canvas margins must stay transparent for the template tint.
	for _, p := range [][2]int{{0, 0}, {31, 31}, {1, 16}, {31, 16}, {16, 8}, {16, 10}, {16, 14}} {
		if alpha(p[0], p[1]) > 20*257 {
			t.Fatalf("unexpected ink at %v", p)
		}
	}
	minX, minY, maxX, maxY := 32, 32, -1, -1
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			if alpha(x, y) > 128*257 {
				minX, minY = min(minX, x), min(minY, y)
				maxX, maxY = max(maxX, x), max(maxY, y)
			}
		}
	}
	w, h := maxX-minX+1, maxY-minY+1
	if h < 20 || w < 20 || float64(w)/float64(h) < 1 || float64(w)/float64(h) > 1.25 {
		t.Fatalf("monogram ink box is %dx%d, expected the logo's ~1.08 ratio", w, h)
	}
}

func TestTrayUnreadBadge(t *testing.T) {
	im := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	drawUnreadBadge(im, 7)
	if im.NRGBAAt(31, 31) != (color.NRGBA{A: 255}) {
		t.Fatal("badge background is not opaque")
	}
	punched := false
	for y := 23; y < 28; y++ {
		for x := 26; x < 31; x++ {
			if im.NRGBAAt(x, y).A == 0 {
				punched = true
			}
		}
	}
	if !punched {
		t.Fatal("badge digits were not punched out")
	}
}
