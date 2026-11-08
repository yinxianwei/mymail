package main

import "testing"

func TestDraftSenderPersistsWithoutReplacingOwner(t *testing.T) {
	s, _ := testService(t)
	a, err := s.LoadDemo()
	if err != nil {
		t.Fatal(err)
	}
	d := Draft{AccountID: a.ID, Key: "reply:original", SenderAccountID: "missing-account", To: "friend@example.invalid", Subject: "subject", Body: "body", Bcc: "hidden@example.invalid"}
	if err = s.SaveDraft(d); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetDraft(a.ID, d.Key)
	if err != nil || got.SenderAccountID != d.SenderAccountID || got.AccountID != a.ID || got.Body != d.Body || got.Bcc != d.Bcc {
		t.Fatalf("draft: %+v %v", got, err)
	}
	// A selected missing sender must fail account lookup, not fall back to the
	// owner's demo credentials (which produce a different error).
	_, want := s.account(d.SenderAccountID)
	_, err = s.Send(got)
	if err == nil || want == nil || err.Error() != want.Error() {
		t.Fatalf("selected sender was not used: %v; want %v", err, want)
	}
	got, err = s.GetDraft(a.ID, d.Key)
	if err != nil || got.Body != d.Body {
		t.Fatalf("failed send lost draft: %+v %v", got, err)
	}
}
