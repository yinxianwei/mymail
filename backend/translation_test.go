package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func putTranslationMessage(t *testing.T, s *MailService, m Message) {
	t.Helper()
	if err := s.putMessage(m); err != nil {
		t.Fatal(err)
	}
}

func TestTranslationUsesCachedTextAndNeverChangesOriginal(t *testing.T) {
	s, _ := testService(t)
	original := Message{ID: "example", Cached: true, Subject: "Monthly report", Text: "Please send the report by Friday."}
	putTranslationMessage(t, s, original)
	s.translateText = func(ctx context.Context, request nativeTranslationRequest) (nativeTranslationResponse, error) {
		if request.StatusOnly || len(request.Texts) != 2 || request.Texts[0] != original.Subject || request.Texts[1] != original.Text {
			t.Fatalf("unexpected request metadata")
		}
		return nativeTranslationResponse{Status: "translated", Texts: []string{"月度报告", "请在周五之前发送报告。"}}, nil
	}
	result, err := s.TranslateMessage(context.Background(), original.ID, "request-one")
	if err != nil || result.Subject != "月度报告" || result.Text != "请在周五之前发送报告。" {
		t.Fatalf("translation: %+v %v", result, err)
	}
	cached, err := s.cached(original.ID)
	if err != nil || cached.Text != original.Text || cached.HTML != original.HTML || cached.Subject != original.Subject {
		t.Fatal("translation modified the original")
	}
}

func TestTranslationHTMLFallbackSkipsActiveAndHiddenDocumentContent(t *testing.T) {
	text := translationHTMLText(`<html><head><title>ignore</title><style>body{color:red}</style></head><body><h1>Hello</h1><p>World &amp; friends</p><script>secretScript()</script><iframe>ignoreframe</iframe><template>ignoretemplate</template></body></html>`)
	for _, bad := range []string{"ignore", "secretScript", "color:red"} {
		if strings.Contains(text, bad) {
			t.Fatalf("included non-body content: %s", bad)
		}
	}
	if !strings.Contains(text, "Hello") || !strings.Contains(text, "World & friends") {
		t.Fatal("missing visible text")
	}
	chunks := translationChunks(strings.Repeat("A paragraph.\n", 600))
	if len(chunks) < 2 {
		t.Fatal("long mail was not split")
	}
	for _, chunk := range chunks {
		if len([]rune(chunk)) > 1500 || chunk == "" {
			t.Fatal("invalid chunk")
		}
	}
}

func TestTranslationValidatesInputsAndNativeResult(t *testing.T) {
	s, _ := testService(t)
	calls := 0
	s.translateText = func(context.Context, nativeTranslationRequest) (nativeTranslationResponse, error) {
		calls++
		return nativeTranslationResponse{Status: "translated"}, nil
	}
	for _, m := range []Message{{ID: "not-read", Cached: false, Text: "hello"}, {ID: "empty", Cached: true}, {ID: "long", Cached: true, Text: strings.Repeat("a", maxTranslationBytes+1)}} {
		putTranslationMessage(t, s, m)
		if _, err := s.TranslateMessage(context.Background(), m.ID, "id-"+m.ID); err == nil {
			t.Fatal("invalid message accepted")
		}
	}
	if calls != 0 {
		t.Fatal("invalid input reached native engine")
	}
	putTranslationMessage(t, s, Message{ID: "html", Cached: true, HTML: "<p>Hello from HTML</p>"})
	if _, err := s.TranslateMessage(context.Background(), "html", "incomplete"); err == nil || !strings.Contains(err.Error(), "不完整") {
		t.Fatal("incomplete native response accepted")
	}
	if _, err := s.TranslateMessage(context.Background(), "html", "../invalid"); err == nil {
		t.Fatal("invalid request id accepted")
	}
}

func TestTranslationCancellationBeforeAndDuringNativeCall(t *testing.T) {
	s, _ := testService(t)
	putTranslationMessage(t, s, Message{ID: "m", Cached: true, Text: "hello"})
	entered := make(chan struct{})
	s.translateText = func(ctx context.Context, _ nativeTranslationRequest) (nativeTranslationResponse, error) {
		close(entered)
		<-ctx.Done()
		return nativeTranslationResponse{}, ctx.Err()
	}
	s.CancelTranslation("early")
	if _, err := s.TranslateMessage(context.Background(), "m", "early"); err == nil || err.Error() != "翻译已取消" {
		t.Fatal("early cancellation lost")
	}
	done := make(chan error, 1)
	go func() { _, err := s.TranslateMessage(context.Background(), "m", "active"); done <- err }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("native engine did not start")
	}
	s.CancelTranslation("active")
	select {
	case err := <-done:
		if err == nil || err.Error() != "翻译已取消" {
			t.Fatalf("cancel: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("translation did not stop")
	}
	s.translateText = func(context.Context, nativeTranslationRequest) (nativeTranslationResponse, error) {
		return nativeTranslationResponse{}, errors.New("系统翻译需要 macOS 15 或更高版本")
	}
	if _, err := s.TranslateMessage(context.Background(), "m", "again"); err == nil || !strings.Contains(err.Error(), "macOS 15") {
		t.Fatal("unsupported-system failure hidden")
	}
}

func TestTranslationPreservesHTMLLayoutAndEscapesModelMarkup(t *testing.T) {
	s, _ := testService(t)
	original := Message{ID: "layout", Cached: true, Subject: "Report", Text: "Plain alternative", HTML: `<style>.x{color:red}</style><table class="x"><tr><td> Hello <b>World</b></td></tr></table><img src="https://example.com/a.png"><a href="https://example.com">Read more</a><span hidden>Hidden text</span><script>bad()</script>`}
	putTranslationMessage(t, s, original)
	s.translateText = func(_ context.Context, r nativeTranslationRequest) (nativeTranslationResponse, error) {
		if strings.Join(r.Texts, "|") != "Report|Hello|World|Read more" {
			t.Fatal("unexpected translation segments")
		}
		return nativeTranslationResponse{Status: "translated", Texts: []string{"报告", "你好", "世界", "<script>fake()</script>"}}, nil
	}
	result, err := s.TranslateMessage(context.Background(), "layout", "layout-test")
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{`<table class="x">`, `<b>世界</b>`, `src="https://example.com/a.png"`, `href="https://example.com"`, `.x{color:red}`, `&lt;script&gt;fake()`} {
		if !strings.Contains(result.HTML, part) {
			t.Fatal("layout or escaping lost", part)
		}
	}
	cached, _ := s.cached("layout")
	if cached.HTML != original.HTML {
		t.Fatal("original changed")
	}
}
