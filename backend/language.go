package main

import (
	"errors"
	"strings"
)

type LanguageSettings struct {
	Preference string `json:"preference"`
	Locale     string `json:"locale"`
}

func interfaceLanguage(preference string, preferred []string) string {
	if preference == "en" || preference == "zh-CN" {
		return preference
	}
	for _, tag := range preferred {
		base := strings.ToLower(strings.Split(strings.ReplaceAll(tag, "_", "-"), "-")[0])
		if base == "zh" {
			return "zh-CN"
		}
		if base == "en" {
			return "en"
		}
	}
	return "en"
}

func (s *MailService) languagePreference() string {
	var preference string
	if s.db.QueryRow("SELECT value FROM metadata WHERE key='language'").Scan(&preference) == nil && (preference == "en" || preference == "zh-CN") {
		return preference
	}
	return "system"
}

func (s *MailService) GetLanguage() LanguageSettings {
	preference := s.languagePreference()
	var preferred []string
	if s.systemLanguages != nil {
		preferred = s.systemLanguages()
	}
	return LanguageSettings{Preference: preference, Locale: interfaceLanguage(preference, preferred)}
}

func (s *MailService) SetLanguage(preference string) (LanguageSettings, error) {
	if preference != "system" && preference != "en" && preference != "zh-CN" {
		return s.GetLanguage(), errors.New("不支持的界面语言")
	}
	if _, err := s.db.Exec("INSERT INTO metadata VALUES('language',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", preference); err != nil {
		return s.GetLanguage(), errors.New("语言设置保存失败")
	}
	if s.changeLocale != nil {
		s.changeLocale(preference)
	}
	s.publishDesktop()
	return s.GetLanguage(), nil
}

func (s *MailService) nativeText(zh, en string) string {
	if s.GetLanguage().Locale == "en" {
		return en
	}
	return zh
}
