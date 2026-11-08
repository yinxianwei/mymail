package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

// A real mixed message: one text part and one base64 attachment, the shape
// every mail client sends when someone attaches a file.
const mixedMessage = "From: Alice <alice@example.com>\r\n" +
	"To: me@example.com\r\n" +
	"Subject: with attachment\r\n" +
	"MIME-Version: 1.0\r\n" +
	"Content-Type: multipart/mixed; boundary=\"BOUND\"\r\n" +
	"\r\n" +
	"--BOUND\r\n" +
	"Content-Type: text/plain; charset=utf-8\r\n" +
	"\r\n" +
	"正文\r\n" +
	"--BOUND\r\n" +
	"Content-Type: application/pdf; name=\"report.pdf\"\r\n" +
	"Content-Disposition: attachment; filename=\"report.pdf\"\r\n" +
	"Content-Transfer-Encoding: base64\r\n" +
	"\r\n" +
	"JVBERi0xLjQK\r\n" +
	"--BOUND--\r\n"

func TestParseBodyKeepsAttachmentBytes(t *testing.T) {
	plain, _, parts, err := parseBody([]byte(mixedMessage))
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(plain) != "正文" {
		t.Fatalf("plain: %q", plain)
	}
	if len(parts) != 1 {
		t.Fatalf("parts: %d", len(parts))
	}
	if parts[0].Name != "report.pdf" {
		t.Fatalf("name: %q", parts[0].Name)
	}
	if string(parts[0].Data) != "%PDF-1.4\n" {
		t.Fatalf("data: %q", parts[0].Data)
	}
	list := attachmentList(parts)
	if len(list) != 1 || list[0].Index != 0 || list[0].Size != int64(len(parts[0].Data)) {
		t.Fatalf("list: %+v", list)
	}
}

func TestInlineImagesAreNotAttachments(t *testing.T) {
	raw := "From: a@example.com\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"R\"\r\n\r\n" +
		"--R\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>hi</p>\r\n" +
		"--R\r\nContent-Type: image/png\r\nContent-Disposition: inline; filename=\"logo.png\"\r\n" +
		"Content-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n--R--\r\n"
	_, rich, parts, err := parseBody([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rich, "hi") {
		t.Fatalf("rich: %q", rich)
	}
	if len(parts) != 0 {
		t.Fatalf("inline part listed as attachment: %+v", parts)
	}
}

func TestSafeFilenameCannotEscapeTheChosenFolder(t *testing.T) {
	cases := map[string]string{
		"report.pdf":          "report.pdf",
		"../../etc/passwd":    "etcpasswd",
		"a/b\\c.txt":          "abc.txt",
		"  spaced.txt  ":      "spaced.txt",
		".hidden":             "hidden",
		"..":                  "附件",
		"":                    "附件",
		"bad\x00name\x07.txt": "badname.txt",
		"报告 2026.pdf":         "报告 2026.pdf",
	}
	for raw, want := range cases {
		if got := safeFilename(raw); got != want {
			t.Errorf("safeFilename(%q) = %q, want %q", raw, got, want)
		}
	}
	long := strings.Repeat("字", 200) + ".txt"
	if got := []rune(safeFilename(long)); len(got) != 120 {
		t.Errorf("long name kept %d runes", len(got))
	}
}

// Cached messages written before attachments were kept list bare filenames.
func TestLegacyAttachmentJSONStillLoads(t *testing.T) {
	var m Message
	if err := json.Unmarshal([]byte(`{"id":"x","attachments":["附件.txt",{"name":"b.pdf","size":3,"index":1}]}`), &m); err != nil {
		t.Fatal(err)
	}
	if len(m.Attachments) != 2 {
		t.Fatalf("attachments: %+v", m.Attachments)
	}
	if m.Attachments[0].Name != "附件.txt" || m.Attachments[0].Size != 0 {
		t.Fatalf("legacy entry: %+v", m.Attachments[0])
	}
	if m.Attachments[1].Name != "b.pdf" || m.Attachments[1].Index != 1 {
		t.Fatalf("new entry: %+v", m.Attachments[1])
	}
	// Two filename-only entries must not both claim index 0, or the reader
	// would open the same part twice.
	var legacy Message
	if err := json.Unmarshal([]byte(`{"id":"x","attachments":["A.pdf","B.pdf"]}`), &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.Attachments[0].Index != 0 || legacy.Attachments[1].Index != 1 {
		t.Fatalf("legacy indices: %+v", legacy.Attachments)
	}
}

func TestAttachmentBytesSurviveWithoutNetwork(t *testing.T) {
	s, err := openService(filepath.Join(t.TempDir(), "mail.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	m := Message{ID: "acc:INBOX:7:1", AccountID: "acc", Folder: "INBOX", UID: 7, Validity: 1, Cached: true, Attachments: []Attachment{{Name: "a.txt", Size: 5, Index: 0}}}
	if err = s.putMessage(m); err != nil {
		t.Fatal(err)
	}
	if err = s.putAttachments(m.ID, []bodyPart{{Name: "a.txt", Data: []byte("hello")}}); err != nil {
		t.Fatal(err)
	}
	part, err := s.attachmentPart(m, 0)
	if err != nil || string(part.Data) != "hello" {
		t.Fatalf("stored part: %q %v", part.Data, err)
	}
	if _, err = s.attachmentPart(m, 1); err == nil {
		t.Fatal("out of range index accepted")
	}
	// Re-reading a message without attachments must clear the old rows, not
	// leave a stale part downloadable.
	if err = s.putAttachments(m.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.storedAttachment(m.ID, 0); err == nil {
		t.Fatal("stale attachment survived")
	}
}
