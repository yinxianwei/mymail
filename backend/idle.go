package main

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net"
	"strconv"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

/**
 * Polling alone decides how late a notification can be: the inbox is checked
 * once a minute, so a mail that lands right after a check waits ~60s before
 * macOS is told about it. Mail.app is instant because it keeps an IMAP IDLE
 * connection open — the server pushes "EXISTS" the moment a message arrives.
 *
 * So each account gets one long-lived connection parked in IDLE. The push only
 * asks for a normal `CheckMail` (same code path, same "only unseen counts as
 * new" rule), and the one-minute poll stays as the fallback for servers that
 * do not advertise IDLE and for connections that silently die (laptops asleep,
 * VPN flaps). IDLE is re-issued every 24 minutes because RFC 2177 asks clients
 * to refresh before the server's 30-minute timeout.
 */

const (
	idleRefresh    = 24 * time.Minute
	idleMinBackoff = 5 * time.Second
	idleMaxBackoff = 5 * time.Minute
)

var errIdleUnsupported = errors.New("服务器不支持 IMAP IDLE")

// idleBackoff doubles the wait after every failed reconnect and caps it, so a
// server that is down (or a captive portal) is not hammered.
func idleBackoff(previous time.Duration) time.Duration {
	if previous <= 0 {
		return idleMinBackoff
	}
	next := previous * 2
	if next > idleMaxBackoff {
		return idleMaxBackoff
	}
	return next
}

// syncIdleWatchers starts a watcher per real account and stops the ones whose
// account disappeared, so adding or removing an account takes effect without a
// restart.
func (s *MailService) syncIdleWatchers(ctx context.Context, accounts []Account) {
	s.idleMu.Lock()
	defer s.idleMu.Unlock()
	live := make(map[string]bool, len(accounts))
	for _, a := range accounts {
		if a.Demo {
			continue
		}
		live[a.ID] = true
		if _, ok := s.idleStops[a.ID]; ok {
			continue
		}
		watcherCtx, cancel := context.WithCancel(ctx)
		s.idleStops[a.ID] = cancel
		go s.watchInbox(watcherCtx, a)
	}
	for id, cancel := range s.idleStops {
		if !live[id] {
			cancel()
			delete(s.idleStops, id)
		}
	}
}

func (s *MailService) watchInbox(ctx context.Context, a Account) {
	var wait time.Duration
	for ctx.Err() == nil {
		started := time.Now()
		err := s.idleInbox(ctx, a)
		if ctx.Err() != nil {
			return
		}
		// No IDLE on this server: the one-minute poll is all there is, retrying
		// would only burn connections.
		if errors.Is(err, errIdleUnsupported) {
			slog.Info("mail.idle.unsupported")
			return
		}
		// A session that lasted a while was healthy: reconnect right away
		// instead of backing off, otherwise a laptop that just woke up would
		// wait minutes for the first push again.
		if err == nil || time.Since(started) > 10*time.Minute {
			wait = 0
		}
		wait = idleBackoff(wait)
		slog.Info("mail.idle.reconnect", "delay_ms", wait.Milliseconds(), "session_ms", time.Since(started).Milliseconds())
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

func (s *MailService) idleInbox(ctx context.Context, a Account) error {
	_, password, err := s.credentials(a.ID)
	if err != nil {
		return err
	}
	c, err := s.imapDialIdle(ctx, a, password)
	if err != nil {
		return err
	}
	defer c.Close()
	caps, err := c.Capability().Wait()
	if err != nil {
		return err
	}
	if !caps.Has(imap.CapIdle) {
		return errIdleUnsupported
	}
	if _, err = c.Select("INBOX", &imap.SelectOptions{ReadOnly: true}).Wait(); err != nil {
		return err
	}
	slog.Info("mail.idle.ready")
	ended := 0
	for ctx.Err() == nil {
		cmd, err := c.Idle()
		if err != nil {
			return err
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		refresh := time.NewTimer(idleRefresh)
		select {
		case <-ctx.Done():
			refresh.Stop()
			_ = cmd.Close()
			return ctx.Err()
		case err = <-done:
			refresh.Stop()
			if err == nil && ctx.Err() == nil {
				// Some servers end IDLE politely at their own timeout and keep
				// the connection. Re-issue on the same socket, but give up if
				// it keeps happening, otherwise a misbehaving server turns
				// this into a busy loop.
				if ended++; ended > 3 {
					return errors.New("服务器反复结束 IDLE")
				}
				continue
			}
			// The connection is gone (sleep, network change, server restart).
			return err
		case <-refresh.C:
			ended = 0
			if err = cmd.Close(); err != nil {
				return err
			}
			select {
			case <-done:
			case <-time.After(10 * time.Second):
				return errors.New("IDLE 未能在超时前停止")
			}
		}
	}
	return ctx.Err()
}

// imapDialIdle opens the connection the watcher keeps for hours: the login
// deadline used by the request/response connections is cleared afterwards, and
// unilateral data (the server's EXISTS push) asks for a check instead of being
// dropped. The handler runs on imapclient's own goroutine and must not block,
// which `requestMailCheck` guarantees.
func (s *MailService) imapDialIdle(ctx context.Context, a Account, password string) (*imapclient.Client, error) {
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(a.IMAPHost, strconv.Itoa(a.IMAPPort)))
	if err != nil {
		return nil, errors.New("IMAP 无法连接，请检查服务器、端口和网络")
	}
	context.AfterFunc(ctx, func() { conn.Close() })
	_ = conn.SetDeadline(time.Now().Add(operationTimeout))
	options := &imapclient.Options{
		WordDecoder: headerDecoder(),
		UnilateralDataHandler: &imapclient.UnilateralDataHandler{
			Mailbox: func(data *imapclient.UnilateralDataMailbox) {
				if data.NumMessages != nil {
					slog.Info("mail.idle.exists", "messages", *data.NumMessages)
					s.requestMailCheck()
				}
			},
		},
	}
	var c *imapclient.Client
	cfg := &tls.Config{ServerName: a.IMAPHost, MinVersion: tls.VersionTLS12}
	if a.IMAPTLS == "tls" {
		secure := tls.Client(conn, cfg)
		if err = secure.HandshakeContext(ctx); err != nil {
			conn.Close()
			return nil, errors.New("IMAP TLS 证书或握手失败")
		}
		c = imapclient.New(secure, options)
	} else {
		c, err = imapclient.NewStartTLS(conn, options)
		if err != nil {
			conn.Close()
			return nil, errors.New("IMAP STARTTLS 失败，未发送凭证")
		}
	}
	if err = c.WaitGreeting(); err != nil {
		c.Close()
		return nil, errors.New("IMAP 服务器欢迎响应失败，请检查端口与加密方式")
	}
	if err = c.Login(a.Email, password).Wait(); err != nil {
		c.Close()
		return nil, errors.New("IMAP 认证失败，请检查授权码并确认已开启 IMAP")
	}
	// Long-lived from here on: the request/response deadline would kill IDLE,
	// and the watcher's own context closes the socket when it goes away.
	_ = conn.SetDeadline(time.Time{})
	return c, nil
}
