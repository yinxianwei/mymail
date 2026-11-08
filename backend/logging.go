package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const logLimit = 2 << 20

type rotatingLog struct {
	mu    sync.Mutex
	path  string
	file  *os.File
	size  int64
	limit int64
}

func newRotatingLog(path string, limit int64) (*rotatingLog, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	w := &rotatingLog{path: path, limit: limit}
	err := w.open()
	return w, err
}
func (w *rotatingLog) open() error {
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if err = f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	w.file = f
	w.size = stat.Size()
	return nil
}
func (w *rotatingLog) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		if err := w.open(); err != nil {
			return 0, err
		}
	}
	if w.size > 0 && w.size+int64(len(p)) > w.limit {
		w.file.Close()
		w.file = nil
		_ = os.Remove(w.path + ".3")
		for i := 2; i >= 1; i-- {
			_ = os.Rename(fmt.Sprintf("%s.%d", w.path, i), fmt.Sprintf("%s.%d", w.path, i+1))
		}
		if err := os.Rename(w.path, w.path+".1"); err != nil && !errors.Is(err, os.ErrNotExist) {
			return 0, err
		}
		if err := w.open(); err != nil {
			return 0, err
		}
	}
	n, err := w.file.Write(p)
	w.size += int64(n)
	return n, err
}
func (w *rotatingLog) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}
func configureLogging(dir string) (io.Closer, error) {
	w, err := newRotatingLog(filepath.Join(dir, "logs", "app.jsonl"), logLimit)
	if err != nil {
		return nil, err
	}
	level := slog.LevelInfo
	if os.Getenv("MYMAIL_LOG_LEVEL") == "debug" {
		level = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level})))
	slog.Info("app.started", "log_level", level.String())
	return w, nil
}

type connectionTraceKey struct{}

func connectionStep(ctx context.Context, protocol, stage string) func(error) {
	id, _ := ctx.Value(connectionTraceKey{}).(string)
	start := time.Now()
	slog.Info("connection.step.started", "request_id", id, "protocol", protocol, "stage", stage)
	return func(err error) {
		result, category := "ok", ""
		if err != nil {
			result = "failed"
			category = "protocol"
			var network net.Error
			if ctx.Err() != nil {
				category = "timeout_or_cancelled"
			} else if errors.As(err, &network) {
				if network.Timeout() {
					category = "timeout"
				} else {
					category = "network"
				}
			}
		}
		slog.Info("connection.step.finished", "request_id", id, "protocol", protocol, "stage", stage, "result", result, "error_category", category, "duration_ms", time.Since(start).Milliseconds())
	}
}

// This method exposes only the log location, never log contents or credentials.
func (s *MailService) LogPath() string {
	return filepath.Join(filepath.Dir(s.path), "logs", "app.jsonl")
}

func operationLog(name string) func(*error) {
	id := randomID()
	started := time.Now()
	slog.Info(name+".started", "operation_id", id)
	return func(err *error) {
		result := "ok"
		if *err != nil {
			result = "failed"
		}
		slog.Info(name+".finished", "operation_id", id, "result", result, "duration_ms", time.Since(started).Milliseconds())
	}
}
