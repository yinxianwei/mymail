package main

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
)

const maxPreviewBytes = 10 << 20
const maxPreviewText = 256 << 10

type AttachmentPreview struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Kind      string `json:"kind"`
	MIME      string `json:"mime"`
	Data      string `json:"data"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
	Reason    string `json:"reason"`
}

// PreviewAttachment only reads a message's cached/fetched MIME part. It never
// accepts filesystem paths, executes an attachment, or returns an arbitrary URL.
func (s *MailService) PreviewAttachment(id string, index int) (result AttachmentPreview, err error) {
	defer operationLog("mail.attachment.preview")(&err)
	m, err := s.cached(id)
	if err != nil {
		return AttachmentPreview{}, err
	}
	part, err := s.attachmentPart(m, index)
	if err != nil {
		return AttachmentPreview{}, err
	}
	return prepareAttachmentPreview(part), nil
}

func prepareAttachmentPreview(part bodyPart) AttachmentPreview {
	result := AttachmentPreview{Name: safeFilename(part.Name), Size: int64(len(part.Data)), Kind: "unsupported", Reason: "unsupported"}
	if len(part.Data) > maxPreviewBytes {
		result.Reason = "too-large"
		return result
	}
	mime := http.DetectContentType(part.Data)
	if bytes.HasPrefix(part.Data, []byte("%PDF-")) {
		result.Kind = "pdf"
		result.MIME = "application/pdf"
	} else {
		switch mime {
		case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp":
			result.Kind = "image"
			result.MIME = mime
		}
	}
	if result.Kind == "image" {
		config, _, err := image.DecodeConfig(bytes.NewReader(part.Data))
		if err != nil {
			result.Kind = "unsupported"
			result.MIME = ""
			return result
		}
		if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 40_000_000 {
			result.Kind = "unsupported"
			result.MIME = ""
			result.Reason = "image-too-large"
			return result
		}
	}
	if result.Kind != "unsupported" {
		result.Data = base64.StdEncoding.EncodeToString(part.Data)
		result.Reason = ""
		return result
	}
	switch strings.ToLower(filepath.Ext(part.Name)) {
	case ".txt", ".csv", ".log", ".md", ".json", ".xml", ".ics", ".eml", ".html", ".htm", ".svg", ".yaml", ".yml":
	default:
		return result
	}
	data, err := previewText(part.Data)
	if err != nil {
		return result
	}
	result.Kind = "text"
	result.MIME = "text/plain"
	result.Reason = ""
	if len(data) > maxPreviewText {
		data = data[:maxPreviewText]
		for !utf8.Valid(data) {
			data = data[:len(data)-1]
		}
		result.Truncated = true
	}
	result.Text = string(data)
	return result
}

func previewText(data []byte) ([]byte, error) {
	if bytes.HasPrefix(data, []byte{0xff, 0xfe}) || bytes.HasPrefix(data, []byte{0xfe, 0xff}) {
		return unicode.UTF16(unicode.LittleEndian, unicode.ExpectBOM).NewDecoder().Bytes(data)
	}
	if bytes.Contains(data, []byte{0}) {
		return nil, errors.New("binary attachment")
	}
	if utf8.Valid(data) {
		return bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}), nil
	}
	return simplifiedchinese.GB18030.NewDecoder().Bytes(data)
}
