package main

import (
	"errors"
	"log/slog"
	"net/url"
	"strings"

	"github.com/egoist/mygo"
)

// ComposeMail carries a parsed mailto: link into the composer. The Go side
// parses the URL so the renderer never has to interpret an untrusted scheme
// string, and so the same path serves a cold start, a second instance and the
// "test mailto" button in preferences.
var ComposeMail = mygo.NewEvent[Draft]("compose-mail")

const (
	maxMailtoAddress = 4096
	maxMailtoSubject = 1024
	maxMailtoBody    = 64 << 10
)

// cleanMailtoField removes header-injection characters and caps the length.
// Header-ish fields collapse newlines to spaces; a body keeps its line breaks
// but never keeps CR or any other control character.
func cleanMailtoField(value string, limit int, keepNewlines bool) string {
	value = strings.Map(func(r rune) rune {
		switch r {
		case '\r':
			return -1
		case '\n':
			if keepNewlines {
				return '\n'
			}
			return ' '
		case '\t':
			return ' '
		}
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, value)
	if len(value) > limit {
		value = value[:limit]
	}
	return strings.TrimSpace(value)
}

// parseMailto follows RFC 6068 closely enough for real links: recipients live
// in the opaque part, headers in the query. Addresses use PathUnescape so a
// plus tag (user+news@example.com) survives; query values use ParseQuery so
// both %20 and the widely used "+" for a space decode correctly.
func parseMailto(raw string) (Draft, error) {
	if len(raw) > 1<<20 {
		return Draft{}, errors.New("mailto 链接过长")
	}
	if !strings.HasPrefix(strings.ToLower(raw), "mailto:") {
		return Draft{}, errors.New("不是 mailto 链接")
	}
	rest := raw[len("mailto:"):]
	head, query := rest, ""
	if i := strings.IndexByte(rest, '?'); i >= 0 {
		head, query = rest[:i], rest[i+1:]
	}
	to, err := url.PathUnescape(head)
	if err != nil {
		return Draft{}, errors.New("mailto 收件人编码无效")
	}
	params, err := url.ParseQuery(query)
	if err != nil {
		return Draft{}, errors.New("mailto 参数编码无效")
	}
	draft := Draft{
		Key:         "new",
		To:          cleanMailtoField(to, maxMailtoAddress, false),
		Cc:          "",
		Bcc:         "",
		Subject:     "",
		Body:        "",
		Attachments: []DraftAttachment{},
	}
	for key, values := range params {
		value := strings.Join(values, ",")
		switch strings.ToLower(key) {
		case "to":
			if draft.To == "" {
				draft.To = cleanMailtoField(value, maxMailtoAddress, false)
			}
		case "cc":
			draft.Cc = cleanMailtoField(value, maxMailtoAddress, false)
		case "bcc":
			draft.Bcc = cleanMailtoField(value, maxMailtoAddress, false)
		case "subject":
			draft.Subject = cleanMailtoField(value, maxMailtoSubject, false)
		case "body":
			draft.Body = cleanMailtoField(value, maxMailtoBody, true)
		}
	}
	if draft.To == "" && draft.Cc == "" && draft.Bcc == "" &&
		draft.Subject == "" && draft.Body == "" {
		return Draft{}, errors.New("mailto 链接没有收件人或内容")
	}
	return draft, nil
}

// OpenMailto is both the IPC entry for the preferences test button and the
// delivery point for URLs coming from the OS. Emitting is deferred to the
// desktop layer, which owns the window the event is sent to.
func (s *MailService) OpenMailto(raw string) error {
	draft, err := parseMailto(raw)
	if err != nil {
		return err
	}
	s.desktopMu.RLock()
	emit := s.composeMailto
	s.desktopMu.RUnlock()
	if emit == nil {
		return errors.New("写信窗口尚未就绪，请稍后重试")
	}
	slog.Info("mail.mailto.open", "has_to", draft.To != "", "has_subject", draft.Subject != "")
	emit(draft)
	return nil
}
