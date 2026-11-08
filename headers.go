package main

import (
	"encoding/json"
	"log/slog"
	"mime"

	"github.com/emersion/go-message/charset"
)

func headerDecoder() *mime.WordDecoder {
	return &mime.WordDecoder{CharsetReader: charset.Reader}
}

func decodeHeaderText(raw string) string {
	decoded, err := headerDecoder().DecodeHeader(raw)
	if err != nil {
		return raw
	} // Preserve unknown or malformed encodings instead of losing text.
	return decoded
}

// Repair only display headers left by older versions. Bodies, identifiers and
// cached state are preserved; no message content is included in diagnostics.
func (s *MailService) repairCachedHeaders() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)"); err != nil {
		return err
	}
	var version string
	if tx.QueryRow("SELECT value FROM metadata WHERE key='decoded_mail_headers'").Scan(&version) == nil && version == "1" {
		return tx.Commit()
	}
	rows, err := tx.Query("SELECT id,data FROM messages")
	if err != nil {
		return err
	}
	type update struct{ id, data string }
	updates := []update{}
	for rows.Next() {
		var id, raw string
		if err = rows.Scan(&id, &raw); err != nil {
			rows.Close()
			return err
		}
		var m Message
		if err = json.Unmarshal([]byte(raw), &m); err != nil {
			rows.Close()
			return err
		}
		subject, from, to := decodeHeaderText(m.Subject), decodeHeaderText(m.From), decodeHeaderText(m.To)
		if subject == m.Subject && from == m.From && to == m.To {
			continue
		}
		m.Subject, m.From, m.To = subject, from, to
		encoded, e := json.Marshal(m)
		if e != nil {
			rows.Close()
			return e
		}
		updates = append(updates, update{id, string(encoded)})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, u := range updates {
		if _, err = tx.Exec("UPDATE messages SET data=? WHERE id=?", u.data, u.id); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("INSERT INTO metadata VALUES('decoded_mail_headers','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value"); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	slog.Info("database.headers.repaired", "message_count", len(updates))
	return nil
}
