package main

import (
	"strings"
	"testing"
)

func TestParseMailtoFullLink(t *testing.T) {
	raw := "mailto:alice%40example.com,user%2Bnews@example.com?cc=carol@example.com&bcc=dave@example.com&subject=Hello%20%E4%B8%96%E7%95%8C&body=Line%201%0ALine%202"
	d, err := parseMailto(raw)
	if err != nil {
		t.Fatal(err)
	}
	if d.To != "alice@example.com,user+news@example.com" {
		t.Fatalf("to: %q", d.To)
	}
	if d.Cc != "carol@example.com" || d.Bcc != "dave@example.com" {
		t.Fatalf("cc/bcc: %q %q", d.Cc, d.Bcc)
	}
	if d.Subject != "Hello 世界" || d.Body != "Line 1\nLine 2" {
		t.Fatalf("subject/body: %q %q", d.Subject, d.Body)
	}
	if d.Key != "new" || d.AccountID != "" {
		t.Fatalf("draft identity: %+v", d)
	}
}

func TestParseMailtoRejectsInjectionAndJunk(t *testing.T) {
	d, err := parseMailto("mailto:a@example.com?subject=Hi%0D%0ABcc%3Aevil@example.com&body=%00hi")
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(d.Subject, "\r\n") || strings.Contains(d.Subject, "Bcc:evil@example.com\n") {
		t.Fatalf("header injection survived: %q", d.Subject)
	}
	if strings.ContainsRune(d.Body, 0) {
		t.Fatal("NUL survived in body")
	}
	for _, raw := range []string{"", "https://example.com", "mailto:", "mailto:?", "mailto:" + strings.Repeat("a", 1<<20+1)} {
		if _, err = parseMailto(raw); err == nil {
			t.Fatalf("accepted %q", raw[:min(len(raw), 24)])
		}
	}
}

func TestParseMailtoCapsFields(t *testing.T) {
	d, err := parseMailto("mailto:a@example.com?body=" + strings.Repeat("x", maxMailtoBody+500))
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Body) != maxMailtoBody {
		t.Fatalf("body length %d", len(d.Body))
	}
}

func TestOpenMailtoEmitsDraft(t *testing.T) {
	s, _ := testService(t)
	if err := s.OpenMailto("mailto:a@example.com"); err == nil {
		t.Fatal("expected an error before the desktop layer is wired")
	}
	var got Draft
	s.desktopMu.Lock()
	s.composeMailto = func(d Draft) { got = d }
	s.desktopMu.Unlock()
	if err := s.OpenMailto("mailto:a@example.com?subject=Hi"); err != nil {
		t.Fatal(err)
	}
	if got.To != "a@example.com" || got.Subject != "Hi" {
		t.Fatalf("emitted draft: %+v", got)
	}
	if err := s.OpenMailto("not-a-link"); err == nil {
		t.Fatal("invalid link was accepted")
	}
}
