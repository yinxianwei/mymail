package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"golang.org/x/net/html"
)

const maxTranslationBytes = 80000

var translationRequestID = regexp.MustCompile(`^[a-zA-Z0-9-]{1,80}$`)

type TranslationResult struct {
	Subject string `json:"subject"`
	Text    string `json:"text"`
	HTML    string `json:"html,omitempty"`
}
type nativeTranslationRequest struct {
	Texts      []string `json:"texts"`
	EnglishUI  bool     `json:"englishUI"`
	StatusOnly bool     `json:"statusOnly"`
}
type nativeTranslationResponse struct {
	Status string   `json:"status"`
	Texts  []string `json:"texts"`
}

// TranslateMessage derives text exclusively from the cached mail. No body is
// supplied by JavaScript, written to temporary files, sent to a cloud service,
// or included in process arguments/logs. The result stays in the reader.
func (s *MailService) TranslateMessage(ctx context.Context, id, requestID string) (result TranslationResult, err error) {
	defer operationLog("mail.translate")(&err)
	if !translationRequestID.MatchString(requestID) {
		return result, errors.New("翻译请求无效")
	}
	message, err := s.cached(id)
	if err != nil {
		return result, err
	}
	if !message.Cached {
		return result, errors.New("请先加载邮件正文再翻译")
	}
	text := strings.TrimSpace(message.Text)
	var layout *translationLayout
	if message.HTML != "" {
		layout, err = prepareTranslationLayout(message.HTML)
		if err != nil {
			return result, err
		}
		text = translationHTMLText(message.HTML)
	}
	if text == "" && message.HTML != "" {
		text = translationHTMLText(message.HTML)
	}
	if text == "" {
		return result, errors.New("邮件没有可翻译的正文")
	}
	if len(text)+len(message.Subject) > maxTranslationBytes {
		return result, errors.New("邮件过长，暂不支持整封翻译")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	s.translationMu.Lock()
	if s.translationCancels == nil {
		s.translationCancels = make(map[string]context.CancelFunc)
	}
	if _, exists := s.translationCancels[requestID]; exists {
		s.translationMu.Unlock()
		return result, errors.New("翻译已取消")
	}
	for _, active := range s.translationCancels {
		if active != nil {
			s.translationMu.Unlock()
			return result, errors.New("已有翻译正在进行，请稍候重试。")
		}
	}
	s.translationCancels[requestID] = cancel
	s.translationMu.Unlock()
	defer func() { s.translationMu.Lock(); delete(s.translationCancels, requestID); s.translationMu.Unlock() }()
	parts := []string{}
	subject := strings.TrimSpace(message.Subject)
	if subject != "" {
		parts = append(parts, subject)
	}
	if layout != nil {
		parts = append(parts, layout.parts...)
	} else {
		parts = append(parts, translationChunks(text)...)
	}
	if len(parts) > 1000 {
		return result, errors.New("邮件过长，暂不支持整封翻译")
	}
	translate := s.translateText
	if translate == nil {
		translate = runNativeTranslation
	}
	response := nativeTranslationResponse{Status: "translated"}
	if len(parts) > 0 {
		response, err = translate(ctx, nativeTranslationRequest{Texts: parts, EnglishUI: s.GetLanguage().Locale == "en"})
	}
	if ctx.Err() != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return result, errors.New("翻译超时，请检查语言包后重试。")
		}
		return result, errors.New("翻译已取消")
	}
	if err != nil {
		return result, err
	}
	switch response.Status {
	case "cancelled":
		return result, errors.New("翻译已取消")
	case "unsupported":
		return result, errors.New("系统不支持英中翻译")
	case "translated":
	default:
		return result, errors.New("系统翻译失败，请检查语言包后重试。")
	}
	if len(response.Texts) != len(parts) {
		return result, errors.New("系统翻译返回不完整，请重试。")
	}
	for _, part := range response.Texts {
		if strings.TrimSpace(part) == "" {
			return result, errors.New("系统翻译返回不完整，请重试。")
		}
	}
	translated := response.Texts
	if subject != "" {
		result.Subject = translated[0]
		translated = translated[1:]
	}
	result.Text = strings.Join(translated, "\n\n")
	if layout != nil {
		result.HTML, err = layout.render(translated)
		if err != nil {
			return result, err
		}
		result.Text = translationHTMLText(result.HTML)
	}
	return result, nil
}

type translatedNode struct {
	node          *html.Node
	start, count  int
	before, after string
}
type translationLayout struct {
	doc   *html.Node
	parts []string
	nodes []translatedNode
}

var englishTranslationText = regexp.MustCompile(`[A-Za-z]`)

// Only text nodes are replaced. Attributes, styles and URLs are never sent to
// the translator. The returned HTML still requires the normal frontend sanitizer.
func prepareTranslationLayout(raw string) (*translationLayout, error) {
	doc, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return nil, err
	}
	layout := &translationLayout{doc: doc}
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "head", "script", "style", "noscript", "iframe", "object", "template":
				return
			}
			for _, a := range n.Attr {
				value := strings.ToLower(strings.Join(strings.Fields(a.Val), ""))
				if a.Key == "hidden" || (a.Key == "aria-hidden" && value == "true") || (a.Key == "style" && (strings.Contains(value, "display:none") || strings.Contains(value, "visibility:hidden"))) {
					return
				}
			}
		}
		if n.Type == html.TextNode && englishTranslationText.MatchString(n.Data) {
			trimmed := strings.TrimSpace(n.Data)
			chunks := translationChunks(trimmed)
			start := strings.Index(n.Data, trimmed)
			if len(chunks) > 0 {
				layout.nodes = append(layout.nodes, translatedNode{n, len(layout.parts), len(chunks), n.Data[:start], n.Data[start+len(trimmed):]})
				layout.parts = append(layout.parts, chunks...)
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(doc)
	total := 0
	for _, p := range layout.parts {
		total += len(p)
	}
	if total > maxTranslationBytes || len(layout.parts) > 999 {
		return nil, errors.New("邮件过长，暂不支持整封翻译")
	}
	return layout, nil
}
func (l *translationLayout) render(texts []string) (string, error) {
	for _, n := range l.nodes {
		n.node.Data = n.before + strings.Join(texts[n.start:n.start+n.count], " ") + n.after
	}
	var out strings.Builder
	if err := html.Render(&out, l.doc); err != nil {
		return "", err
	}
	return out.String(), nil
}

func (s *MailService) CancelTranslation(requestID string) {
	if !translationRequestID.MatchString(requestID) {
		return
	}
	s.translationMu.Lock()
	defer s.translationMu.Unlock()
	if s.translationCancels == nil {
		s.translationCancels = make(map[string]context.CancelFunc)
	}
	if cancel := s.translationCancels[requestID]; cancel != nil {
		cancel()
		return
	}
	// Handle cancellation arriving before the translation call is dispatched.
	if len(s.translationCancels) >= 32 {
		for key, cancel := range s.translationCancels {
			if cancel == nil {
				delete(s.translationCancels, key)
				break
			}
		}
	}
	s.translationCancels[requestID] = nil
}

func translationChunks(text string) []string {
	chars := []rune(text)
	var chunks []string
	for len(chars) > 0 {
		end := len(chars)
		if end > 1500 {
			end = 1500
			for i := end - 1; i > 750; i-- {
				if chars[i] == '\n' || chars[i] == '.' || chars[i] == '!' || chars[i] == '?' {
					end = i + 1
					break
				}
			}
		}
		chunk := strings.TrimSpace(string(chars[:end]))
		if chunk != "" {
			chunks = append(chunks, chunk)
		}
		chars = chars[end:]
	}
	return chunks
}

func translationHTMLText(raw string) string {
	doc, err := html.Parse(strings.NewReader(raw))
	if err != nil {
		return ""
	}
	var out strings.Builder
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch node.Data {
			case "script", "style", "head", "noscript", "iframe", "object", "template":
				return
			}
		}
		if node.Type == html.TextNode {
			out.WriteString(node.Data)
		}
		if node.Type == html.ElementNode {
			switch node.Data {
			case "p", "div", "br", "li", "tr", "h1", "h2", "h3", "blockquote":
				out.WriteString("\n")
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
		if node.Type == html.ElementNode {
			switch node.Data {
			case "p", "div", "li", "tr", "h1", "h2", "h3", "blockquote":
				out.WriteString("\n")
			case "td", "th":
				out.WriteString(" ")
			}
		}
	}
	visit(doc)
	return strings.TrimSpace(out.String())
}

func runNativeTranslation(ctx context.Context, request nativeTranslationRequest) (nativeTranslationResponse, error) {
	var result nativeTranslationResponse
	if runtime.GOOS != "darwin" {
		return result, errors.New("系统翻译需要 macOS 15 或更高版本")
	}
	version, err := exec.CommandContext(ctx, "/usr/bin/sw_vers", "-productVersion").Output()
	if err != nil {
		return result, errors.New("无法检查系统翻译支持")
	}
	major, _ := strconv.Atoi(strings.Split(strings.TrimSpace(string(version)), ".")[0])
	if major < 15 {
		return result, errors.New("系统翻译需要 macOS 15 或更高版本")
	}
	resources, err := mygo.App.Path(mygo.PathResources)
	if err != nil {
		return result, errors.New("系统翻译组件不可用，请重新安装应用。")
	}
	helper := filepath.Join(resources, "MyMailTranslation.app", "Contents", "MacOS", "MyMailTranslation")
	if _, err = os.Stat(helper); err != nil {
		return result, errors.New("系统翻译组件不可用，请重新安装应用。")
	}
	input, err := json.Marshal(request)
	if err != nil {
		return result, errors.New("翻译请求无效")
	}
	command := exec.CommandContext(ctx, helper)
	command.Stdin = bytes.NewReader(input)
	// Ignore system diagnostics: they may include language-service internals.
	command.Stderr = io.Discard
	output, err := command.Output()
	if err != nil {
		return result, errors.New("系统翻译失败，请检查语言包后重试。")
	}
	if len(output) > 1<<20 || json.Unmarshal(output, &result) != nil {
		return result, errors.New("系统翻译返回不完整，请重试。")
	}
	return result, nil
}

func (s *MailService) stopTranslations() {
	s.translationMu.Lock()
	defer s.translationMu.Unlock()
	for _, cancel := range s.translationCancels {
		if cancel != nil {
			cancel()
		}
	}
}
