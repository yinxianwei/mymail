package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/egoist/mygo"
)

func main() {
	// Binding generation must not open or migrate the user's live mail database.
	if os.Getenv("MYGO_GENERATE") != "" {
		mygo.Bind(&MailService{})
		if err := mygo.App.Run(); err != nil {
			log.Fatal(err)
		}
		return
	}
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	var window *mygo.Window
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	quitting := false
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { quitting = true; cancel() })
	// A mailto: link can launch the app (cold start) or arrive in a second
	// process that the single-instance lock forwards here. Both are queued
	// until the window exists, so no link is lost during startup.
	mailtoLinks := make(chan string, 8)
	queueMailto := func(raw string) {
		raw = strings.TrimSpace(raw)
		if !strings.HasPrefix(strings.ToLower(raw), "mailto:") {
			return
		}
		select {
		case mailtoLinks <- raw:
		default:
			slog.Warn("mail.mailto.queue.full")
		}
	}
	mygo.App.OnOpenURL(queueMailto)
	if runtime.GOOS != "darwin" {
		if err := mygo.App.RegisterURLScheme("mailto"); err != nil {
			slog.Warn("mail.mailto.register.failed")
		}
	}
	focus := func() {
		if window != nil {
			window.Show()
			window.Focus()
			mygo.App.Focus()
		}
	}
	mygo.App.OnActivate(func(visible bool) {
		if !visible {
			focus()
		}
	})
	mygo.App.OnSecondInstance(func(args []string, _ string) {
		if window != nil {
			window.Show()
			window.Focus()
		}
		for _, arg := range args {
			queueMailto(arg)
		}
	})
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		log.Fatal(err)
	}
	if override := os.Getenv("MYMAIL_DATA_DIR"); override != "" {
		dir = override
	}
	logger, err := configureLogging(dir)
	if err != nil {
		log.Fatal("无法创建本地诊断日志")
	}
	defer logger.Close()
	service, err := openService(filepath.Join(dir, "mail.db"))
	if err != nil {
		slog.Error("database.open.failed")
		log.Fatal("无法打开本地数据库")
	}
	defer service.db.Close()
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { service.stopTranslations() })
	mygo.App.SetLanguages("en", "zh-Hans")
	service.systemLanguages = mygo.App.PreferredLanguages
	service.changeLocale = func(preference string) {
		tag := preference
		if tag == "system" {
			tag = ""
		}
		if tag == "zh-CN" {
			tag = "zh-Hans"
		}
		mygo.App.SetLocale(tag)
	}
	service.changeLocale(service.languagePreference())
	mygo.App.OnLocaleChanged(func(string) { service.publishDesktop() })
	slog.Info("database.open.finished")
	mygo.Bind(service)
	mygo.App.OnNotificationClick(func(id string) {
		if target, ok := parseNotificationID(id); ok {
			service.queueMailTarget(target)
		}
		focus()
	})
	mygo.App.WhenReady(func() {
		// The page draws its own top strip: hiding the native title bar drops
		// the app name and icon from the window chrome and lets the mail
		// workspace fill the window. Only the traffic lights stay, inset so
		// the page can keep clear of them with --mygo-titlebar-height.
		window = mygo.NewWindow(mygo.WindowOptions{Title: "My Mail", TitleBarStyle: mygo.TitleBarHidden, TrafficLightPosition: &mygo.Point{X: 18, Y: 16}, Width: 1280, Height: 820, MinWidth: 760, MinHeight: 560, StateKey: "main", URL: "/"})
		if startDesktop(ctx, service, window, focus) {
			window.OnClose(func(event *mygo.CloseEvent) {
				if !quitting {
					event.PreventDefault()
					window.Hide()
				}
			})
		}
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case raw := <-mailtoLinks:
					if err := service.OpenMailto(raw); err != nil {
						slog.Warn("mail.mailto.open.failed")
					}
				}
			}
		}()
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
