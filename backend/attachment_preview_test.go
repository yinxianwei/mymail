package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/png"
	"strings"
	"testing"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

func TestPreviewClassifiesBytesAndKeepsActiveMarkupAsText(t *testing.T) {
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name       string
		data       []byte
		kind, mime string
	}{
		{"fake.png", []byte("<script>alert(1)</script>"), "unsupported", ""},
		{"picture.png", imageBytes.Bytes(), "image", "image/png"},
		{"a.pdf", []byte("%PDF-1.7\n"), "pdf", "application/pdf"},
		{"a.html", []byte("<script>alert(1)</script>"), "text", "text/plain"},
		{"a.svg", []byte("<svg onload='alert(1)'></svg>"), "text", "text/plain"},
		{"a.csv", []byte("姓名,金额\n示例,10"), "text", "text/plain"},
		{"app.exe", []byte("MZ executable"), "unsupported", ""},
		{"fake.txt", []byte{0, 1, 2}, "unsupported", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := prepareAttachmentPreview(bodyPart{Name: tc.name, Data: tc.data})
			if p.Kind != tc.kind || p.MIME != tc.mime {
				t.Fatalf("kind=%q MIME=%q", p.Kind, p.MIME)
			}
			if tc.kind == "text" && p.Text != string(tc.data) {
				t.Fatal("text changed")
			}
			if tc.kind == "image" || tc.kind == "pdf" {
				raw, err := base64.StdEncoding.DecodeString(p.Data)
				if err != nil || !bytes.Equal(raw, tc.data) {
					t.Fatal("binary content changed")
				}
			}
			if tc.kind == "unsupported" && (p.Data != "" || p.Text != "") {
				t.Fatal("unsupported file returned bytes")
			}
		})
	}
}

func TestPreviewBoundsAndTextEncoding(t *testing.T) {
	var oversizedImage bytes.Buffer
	if err := png.Encode(&oversizedImage, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	header := oversizedImage.Bytes()
	binary.BigEndian.PutUint32(header[16:20], 100000)
	binary.BigEndian.PutUint32(header[20:24], 100000)
	binary.BigEndian.PutUint32(header[29:33], crc32.ChecksumIEEE(header[12:29]))
	imagePreview := prepareAttachmentPreview(bodyPart{Name: "huge.png", Data: header})
	if imagePreview.Reason != "image-too-large" || imagePreview.Data != "" {
		t.Fatal("oversized image dimensions accepted")
	}

	p := prepareAttachmentPreview(bodyPart{Name: "a.pdf", Data: bytes.Repeat([]byte("a"), maxPreviewBytes+1)})
	if p.Reason != "too-large" || p.Data != "" {
		t.Fatal("oversized preview accepted")
	}
	p = prepareAttachmentPreview(bodyPart{Name: "a.txt", Data: []byte(strings.Repeat("中文", maxPreviewText))})
	if !p.Truncated || len(p.Text) > maxPreviewText || !utf8.ValidString(p.Text) {
		t.Fatal("invalid text truncation")
	}
	gbk, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte("中文附件"))
	if err != nil {
		t.Fatal(err)
	}
	p = prepareAttachmentPreview(bodyPart{Name: "a.txt", Data: gbk})
	if p.Text != "中文附件" {
		t.Fatalf("GBK: %q", p.Text)
	}
	p = prepareAttachmentPreview(bodyPart{Name: "a.txt", Data: []byte{0xff, 0xfe, 'h', 0, 'i', 0}})
	if p.Text != "hi" {
		t.Fatalf("UTF16: %q", p.Text)
	}
}

func TestPreviewReadsCachedPartAndValidatesIdentity(t *testing.T) {
	s, _ := testService(t)
	m := Message{ID: "acc:INBOX:1:1", AccountID: "acc", Cached: true, Attachments: []Attachment{{Name: "a.txt", Index: 0, Size: 5}}}
	if err := s.putMessage(m); err != nil {
		t.Fatal(err)
	}
	if err := s.putAttachments(m.ID, []bodyPart{{Name: "../a.txt", Data: []byte("hello")}}); err != nil {
		t.Fatal(err)
	}
	p, err := s.PreviewAttachment(m.ID, 0)
	if err != nil || p.Text != "hello" || strings.ContainsAny(p.Name, "/\\") {
		t.Fatalf("preview: %+v %v", p, err)
	}
	for _, idx := range []int{-1, 1} {
		if _, err = s.PreviewAttachment(m.ID, idx); err == nil {
			t.Fatal("invalid part accepted")
		}
	}
	if _, err = s.PreviewAttachment("missing", 0); err == nil {
		t.Fatal("missing message accepted")
	}
}
