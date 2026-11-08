package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log/slog"
	"math"
	"runtime"
	"strconv"
	"sync/atomic"

	"github.com/egoist/mygo"
)

// trayImage draws the app monogram — the same "M" stroke as
// design/logo/logo.svg, whose deep V doubles as an envelope flap — as a 16 pt
// template image. macOS tints template icons from their alpha only, so the ink
// is solid black on transparency and the rounded blue tile is deliberately
// left out: filled, it would be an opaque black square in the menu bar.
func trayImage(count int) []byte {
	const size = 32
	im := image.NewNRGBA(image.Rect(0, 0, size, size))

	// logo.svg (1024 canvas): M302,702 V322 L512,632 L722,322 V702, stroked
	// 94 with round caps/joins. Its ink box is 255..769 x 275..749. Centre
	// that box in the 32 px bitmap, keeping the glyph's aspect ratio and
	// stroke weight. Platforms without a menu-bar title put the unread badge
	// in the lower right, so the mark shifts up and left a little there.
	const inkW, inkH = 514.0, 474.0
	scale := 24.0 / inkW
	offX := (size - inkW*scale) / 2
	offY := (size - inkH*scale) / 2
	badge := count > 0 && runtime.GOOS != "darwin"
	if badge {
		scale = 20.0 / inkW
		offX, offY = 2, 2
	}
	path := [...][2]float64{{302, 702}, {302, 322}, {512, 632}, {722, 322}, {722, 702}}
	points := make([][2]float64, len(path))
	for i, p := range path {
		points[i] = [2]float64{offX + (p[0]-255)*scale, offY + (p[1]-275)*scale}
	}
	radius := 94 * scale / 2
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			px, py := float64(x)+0.5, float64(y)+0.5
			nearest := math.MaxFloat64
			for i := 1; i < len(points); i++ {
				if d := strokeDistance(px, py, points[i-1], points[i]); d < nearest {
					nearest = d
				}
			}
			// One pixel of feathering keeps the small glyph smooth; the
			// template tint reads only this alpha channel.
			cover := math.Min(1, math.Max(0, radius+0.5-nearest))
			if cover > 0 {
				im.SetNRGBA(x, y, color.NRGBA{A: uint8(cover*255 + 0.5)})
			}
		}
	}

	if badge {
		drawUnreadBadge(im, count)
	}
	var out bytes.Buffer
	_ = png.Encode(&out, im)
	return out.Bytes()
}

// drawUnreadBadge is used where the tray cannot show a title next to the icon
// (macOS shows `tray.SetTitle` instead). The digits are punched out of the
// solid badge so the template tint renders them in the menu bar's background.
func drawUnreadBadge(im *image.NRGBA, count int) {
	const size = 32
	digits := []string{"111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"}
	label := strconv.Itoa(min(count, 99))
	left := size - (len(label)*4 + 4)
	for y := 19; y < size; y++ {
		for x := left; x < size; x++ {
			im.SetNRGBA(x, y, color.NRGBA{A: 255})
		}
	}
	for index, ch := range label {
		pattern := digits[ch-'0']
		for y := 0; y < 5; y++ {
			for x := 0; x < 3; x++ {
				if pattern[y*3+x] == '1' {
					im.SetNRGBA(left+2+index*4+x, 23+y, color.NRGBA{})
				}
			}
		}
	}
}

// strokeDistance is the distance from a pixel centre to one segment of the
// polyline. Taking the minimum over all segments reproduces SVG's round caps
// and round joins without pulling in a rasteriser.
func strokeDistance(px, py float64, a, b [2]float64) float64 {
	vx, vy := b[0]-a[0], b[1]-a[1]
	wx, wy := px-a[0], py-a[1]
	length2 := vx*vx + vy*vy
	t := 0.0
	if length2 > 0 {
		t = math.Min(1, math.Max(0, (wx*vx+wy*vy)/length2))
	}
	return math.Hypot(wx-t*vx, wy-t*vy)
}
func unreadLabel(count int) string {
	if count <= 0 {
		return ""
	}
	if count > 9999 {
		return "9999+"
	}
	return strconv.Itoa(count)
}

func startDesktop(ctx context.Context, s *MailService, window *mygo.Window, focus func()) bool {
	var tray *mygo.Tray
	var lastCount atomic.Int64
	lastCount.Store(-1)
	makeMenu := func(state DesktopState) *mygo.Menu {
		return mygo.NewMenu([]*mygo.MenuItem{
			{Label: fmt.Sprintf(s.nativeText("收件箱未读：%d 封", "Unread inbox messages: %d"), state.Unread), Disabled: true},
			{Label: s.nativeText("打开邮箱", "Open mailbox"), Click: func(*mygo.MenuItem, *mygo.Window) { focus() }},
			{Label: s.nativeText("立即检查新邮件", "Check for new mail"), Disabled: state.Checking, Click: func(*mygo.MenuItem, *mygo.Window) { s.requestMailCheck() }},
			{Label: s.nativeText("新邮件通知", "New mail notifications"), Type: mygo.MenuItemCheckbox, Checked: state.Notifications, Click: func(item *mygo.MenuItem, _ *mygo.Window) {
				enabled := item.Checked
				go func() {
					if _, err := s.SetNotifications(enabled); err != nil {
						slog.Error("desktop.preferences.save.failed")
					}
				}()
			}},
			mygo.Separator(), {Label: s.nativeText("退出 My Mail", "Quit My Mail"), Click: func(*mygo.MenuItem, *mygo.Window) { mygo.App.Quit() }},
		})
	}
	var err error
	tray, err = mygo.NewTray(mygo.TrayOptions{ID: "mail", Icon: trayImage(0), IconIsTemplate: true, ToolTip: "My Mail", Menu: makeMenu(s.DesktopState())})
	if err != nil {
		slog.Error("desktop.tray.create.failed")
	} else {
		slog.Info("desktop.tray.ready", "platform", runtime.GOOS)
	}
	s.desktopMu.Lock()
	var lastRevision uint64
	s.desktopChanged = func(state DesktopState) {
		if ctx.Err() != nil {
			return
		}
		mygo.RunOnMain(func() {
			if ctx.Err() != nil || state.Revision < lastRevision {
				return
			}
			lastRevision = state.Revision
			if tray != nil {
				if lastCount.Swap(int64(state.Unread)) != int64(state.Unread) {
					tray.SetTitle(unreadLabel(state.Unread))
					if runtime.GOOS != "darwin" {
						_ = tray.SetIcon(trayImage(state.Unread), true)
					}
				}
				tip := fmt.Sprintf(s.nativeText("My Mail · 收件箱未读 %d 封", "My Mail · %d unread messages"), state.Unread)
				if state.LastError != "" {
					tip += s.nativeText("（部分账号待更新）", " (some accounts need updating)")
				}
				tray.SetToolTip(tip)
				tray.SetMenu(makeMenu(state))
			}
			mygo.App.Dock.SetBadge(unreadLabel(state.Unread))
			_ = MailChanged.Emit(window, state)
		})
	}
	s.openMail = func() { _ = OpenMail.Emit(window, true) }
	s.composeMailto = func(d Draft) {
		mygo.RunOnMain(func() {
			if err := ComposeMail.Emit(window, d); err != nil {
				slog.Warn("mail.mailto.emit.failed")
				return
			}
			slog.Info("mail.mailto.emitted")
		})
	}
	s.desktopMu.Unlock()
	notificationGate := make(chan struct{}, 1)
	showNotification := func(requestContext context.Context, notice newMailNotice, test bool) error {
		if !mygo.NotificationsSupported() {
			s.setNotificationStatus("unsupported")
			return errors.New("当前桌面环境不支持系统通知")
		}
		opts := mygo.NotificationOptions{Title: "My Mail", Body: fmt.Sprintf(s.nativeText("收件箱收到 %d 封新邮件", "%d new inbox messages"), notice.Count), ID: notificationID(notice.Target), Group: notice.Target.AccountID}
		if notice.Count == 1 && s.GetLanguage().Locale == "en" {
			opts.Body = "1 new inbox message"
		}
		if test {
			opts.ID = "notification-test"
			opts.Body = s.nativeText("这是一条测试通知。点击可打开邮箱。", "This is a test notification. Click to open your mailbox.")
		}
		if test {
			select {
			case notificationGate <- struct{}{}:
			default:
				return errors.New("通知正在等待系统响应，请先处理系统授权提示")
			}
		} else {
			select {
			case notificationGate <- struct{}{}:
			case <-requestContext.Done():
				return requestContext.Err()
			}
		}
		s.setNotificationStatus("pending")
		result := make(chan error, 1)
		go func() {
			defer func() { <-notificationGate }()
			note := mygo.NewNotification(opts)
			err := note.Show()
			if errors.Is(err, mygo.ErrNotificationsDenied) {
				s.setNotificationStatus("denied")
				result <- errors.New("系统通知未授权，请在系统设置中允许 My Mail 通知")
				return
			}
			if err != nil {
				s.setNotificationStatus("failed")
				slog.Warn("desktop.notification.failed")
				result <- errors.New("系统通知发送失败，请检查系统通知设置")
				return
			}
			s.setNotificationStatus("allowed")
			slog.Info("desktop.notification.shown", "test", test, "message_count", notice.Count)
			result <- nil
		}()
		select {
		case <-requestContext.Done():
			return errors.New("系统通知仍在等待授权，请处理系统提示后重试")
		case err := <-result:
			return err
		}

	}
	notices := make(chan newMailNotice, 16)
	s.desktopMu.Lock()
	s.newMail = func(n newMailNotice) {
		select {
		case notices <- n:
		default:
			slog.Warn("desktop.notification.queue.full")
		}
	}
	s.testNotification = func(requestContext context.Context) error {
		return showNotification(requestContext, newMailNotice{}, true)
	}
	s.desktopMu.Unlock()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case n := <-notices:
				state := s.DesktopState()
				if !state.Notifications {
					continue
				}
				done := make(chan struct{})
				go func() { _ = showNotification(ctx, n, false); close(done) }()
				select {
				case <-ctx.Done():
					return
				case <-done:
				}
			}
		}
	}()
	s.publishDesktop()
	go s.runMonitor(ctx)
	return tray != nil
}
