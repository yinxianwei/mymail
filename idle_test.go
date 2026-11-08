package main

import (
	"testing"
	"time"
)

func TestIdleBackoffDoublesAndCaps(t *testing.T) {
	cases := []struct{ in, want time.Duration }{
		{0, idleMinBackoff},
		{idleMinBackoff, 2 * idleMinBackoff},
		{2 * idleMinBackoff, 4 * idleMinBackoff},
		{idleMaxBackoff, idleMaxBackoff},
		{idleMaxBackoff * 2, idleMaxBackoff},
	}
	for _, c := range cases {
		if got := idleBackoff(c.in); got != c.want {
			t.Fatalf("idleBackoff(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestIdleRefreshFitsServerTimeout(t *testing.T) {
	// RFC 2177 lets a server drop an IDLE connection after 30 minutes.
	if idleRefresh >= 30*time.Minute {
		t.Fatalf("idleRefresh %v must stay below the 30 minute server timeout", idleRefresh)
	}
	if idleRefresh < 10*time.Minute {
		t.Fatalf("idleRefresh %v re-issues IDLE too often", idleRefresh)
	}
}
