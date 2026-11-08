package main

import "log/slog"

// CacheStats is what the preferences pane shows. Body text and attachment
// bytes are stored in separate tables, so both are counted.
type CacheStats struct {
	Messages        int   `json:"messages"`
	HeaderBytes     int64 `json:"headerBytes"`
	Attachments     int   `json:"attachments"`
	AttachmentBytes int64 `json:"attachmentBytes"`
	Sent            int   `json:"sent"`
	Limit           int   `json:"limit"`
}

func (s *MailService) cacheStats(limit int) (CacheStats, error) {
	stats := CacheStats{Limit: limit}
	err := s.db.QueryRow(`SELECT
	 (SELECT count(*) FROM messages),
	 (SELECT coalesce(sum(length(data)),0) FROM messages),
	 (SELECT count(*) FROM attachments),
	 (SELECT coalesce(sum(length(data)),0) FROM attachments),
	 (SELECT count(*) FROM sent)`).Scan(
		&stats.Messages, &stats.HeaderBytes,
		&stats.Attachments, &stats.AttachmentBytes, &stats.Sent,
	)
	return stats, err
}

func (s *MailService) CacheStats() CacheStats {
	stats, err := s.cacheStats(s.GetSettings().CacheLimit)
	if err != nil {
		slog.Warn("mail.cache.stats.failed")
		return CacheStats{Limit: s.GetSettings().CacheLimit}
	}
	return stats
}

// trimCache keeps the newest `limit` message headers per account and folder,
// along with their cached bodies and attachments. Messages referenced by a
// pending IMAP operation are never evicted: replaying that operation needs
// the row (and its UID/validity) to still be there.
func (s *MailService) trimCache() (int, error) {
	limit := s.GetSettings().CacheLimit
	doomed := []string{}
	if limit > 0 {
		rows, err := s.db.Query(`WITH ranked AS (
			SELECT id, row_number() OVER (PARTITION BY account_id, folder ORDER BY uid DESC) AS position
			FROM messages
		) SELECT id FROM ranked WHERE position > ?
			AND id NOT IN (SELECT message_id FROM pending_ops)`, limit)
		if err != nil {
			return 0, err
		}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return 0, err
			}
			doomed = append(doomed, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return 0, err
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	for _, id := range doomed {
		if _, err = tx.Exec("DELETE FROM attachments WHERE message_id=?", id); err != nil {
			return 0, err
		}
		if _, err = tx.Exec("DELETE FROM messages WHERE id=?", id); err != nil {
			return 0, err
		}
	}
	// Older builds could leave an attachment behind when a message was
	// removed; sweep those too, even when the limit is disabled.
	if _, err = tx.Exec("DELETE FROM attachments WHERE message_id NOT IN (SELECT id FROM messages)"); err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	if len(doomed) > 0 {
		slog.Info("mail.cache.trimmed", "deleted", len(doomed), "limit", limit)
	}
	return len(doomed), nil
}

// TrimCache is exposed to the preferences pane so the user can reclaim space
// immediately after lowering the limit.
func (s *MailService) TrimCache() (CacheStats, error) {
	if _, err := s.trimCache(); err != nil {
		return CacheStats{}, err
	}
	return s.cacheStats(s.GetSettings().CacheLimit)
}

// trimCacheIfNeeded avoids running the ranking query on every background
// check; a small overshoot is fine and keeps the cache from thrashing.
func (s *MailService) trimCacheIfNeeded() {
	stats := s.CacheStats()
	if stats.Limit > 0 && stats.Messages > stats.Limit+50 {
		if _, err := s.trimCache(); err != nil {
			slog.Warn("mail.cache.trim.failed")
		}
	}
}
