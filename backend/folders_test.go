package main

import (
	"github.com/emersion/go-imap/v2"
	"testing"
)

func TestFolderMetadata(t *testing.T) {
	sent := folderInfo(&imap.ListData{Mailbox: "[Gmail]/Sent Mail", Delim: '/', Attrs: []imap.MailboxAttr{imap.MailboxAttrSent}})
	if sent.Role != "sent" || sent.Delimiter != "/" || !sent.Selectable {
		t.Fatalf("metadata: %+v", sent)
	}
	group := folderInfo(&imap.ListData{Mailbox: "Projects", Delim: '.', Attrs: []imap.MailboxAttr{imap.MailboxAttrNoSelect}})
	if group.Selectable || group.Delimiter != "." {
		t.Fatalf("container: %+v", group)
	}
	if folderInfo(&imap.ListData{Mailbox: "inbox"}).Role != "inbox" {
		t.Fatal("case insensitive INBOX not recognized")
	}
	if folderInfo(&imap.ListData{Mailbox: "literal/name"}).Delimiter != "" {
		t.Fatal("NIL delimiter must remain empty")
	}
}
