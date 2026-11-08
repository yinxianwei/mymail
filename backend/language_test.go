package main

import (
	"path/filepath"
	"testing"
)

func TestInterfaceLanguageNegotiation(t *testing.T) {
	for _, tc := range []struct {
		preference string
		preferred  []string
		want       string
	}{
		{"system", []string{"zh-Hans-CN", "en-US"}, "zh-CN"},
		{"system", []string{"en-GB", "zh-CN"}, "en"},
		{"system", []string{"fr-FR", "zh-TW"}, "zh-CN"},
		{"system", []string{"de-DE"}, "en"},
		{"en", []string{"zh-CN"}, "en"},
		{"zh-CN", []string{"en-US"}, "zh-CN"},
	} {
		if got := interfaceLanguage(tc.preference, tc.preferred); got != tc.want {
			t.Errorf("language = %q; want %q", got, tc.want)
		}
	}
}

func TestLanguagePreferencePersistsAndRejectsInvalidValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mail.db")
	s, err := openService(path)
	if err != nil {
		t.Fatal(err)
	}
	s.systemLanguages = func() []string { return []string{"zh-CN"} }
	if got := s.GetLanguage(); got.Preference != "system" || got.Locale != "zh-CN" {
		t.Fatal(got)
	}
	before := s.DesktopState().Revision
	if got, err := s.SetLanguage("en"); err != nil || got.Locale != "en" {
		t.Fatal(got, err)
	}
	if s.DesktopState().Revision <= before {
		t.Fatal("native menu was not notified")
	}
	if _, err := s.SetLanguage("bogus"); err == nil {
		t.Fatal("invalid language accepted")
	}
	if s.GetLanguage().Preference != "en" {
		t.Fatal("invalid input replaced preference")
	}
	s.db.Close()
	s, err = openService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	s.systemLanguages = func() []string { return []string{"zh-CN"} }
	if got := s.GetLanguage(); got.Preference != "en" || got.Locale != "en" {
		t.Fatal(got)
	}
	if s.nativeText("中文", "English") != "English" {
		t.Fatal("native messages did not follow preference")
	}
	if got, err := s.SetLanguage("system"); err != nil || got.Locale != "zh-CN" {
		t.Fatal(got, err)
	}
}
