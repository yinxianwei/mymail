## My Mail — early preview / 早期预览

A local-first desktop email client built with Go + React and the system WebView.
This preview targets **macOS Apple Silicon (arm64)**. The app supports English and Simplified Chinese (Settings → Language).

- Multiple accounts and a unified inbox; cached mail can be read offline.
- Reply/forward, per-message local drafts, attachments, Cc/Bcc and keyboard send.
- Menu bar unread count and notifications, with IMAP IDLE/polling.

### Install / 安装

Download the DMG and `SHA256SUMS` from this release. Run
`shasum -a 256 -c SHA256SUMS` in the download directory, open the DMG, then drag
My Mail into Applications. The **打开本地示例** option lets you try fictional
local mail without credentials.

**This automated preview is ad-hoc signed and not Apple notarized.** macOS may
block opening it. See the [installation guide](https://github.com/yinxianwei/mymail/blob/main/docs/INSTALL.md); do not disable
system-wide security protections. No Intel Mac / Windows / Linux compatibility
is promised. OAuth2 is not implemented. SQLite is not encrypted by the app;
read the [security policy](https://github.com/yinxianwei/mymail/blob/main/.github/SECURITY.md) before using a real mailbox.

中文：此预览包仅面向 Apple 芯片 Mac，未经过 Apple 公证；先校验下载文件，再按安装文档操作。欢迎使用示例数据体验，真实邮箱凭证只在应用内输入。反馈前请删除日志和截图里的私人信息。

If it helps you, a Star or a useful bug report helps the project grow.
