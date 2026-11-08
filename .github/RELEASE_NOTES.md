## My Mail 0.0.2 — Preview / 预览版

A lightweight, local-first desktop email client built with **MyGo + React** and the system WebView. This preview targets **macOS Apple Silicon (arm64)**.

### What's new

- Preview images, paginated PDFs and text attachments locally. Click a filename to download; cached attachments also work offline.
- Switch the sending account while composing, keeping recipients, body, quoted content and attachments intact.
- Choose English, Simplified Chinese or the system language in **Account settings → General → Language**.
- Find all local drafts in one place and filter cached mail by unread, starred or attachment status.
- Navigate settings through sidebar categories. Gr8r controls are now consistent across the interface, with fixed nested scrolling and aligned toolbars.

### 本次更新

- 附件支持图片、PDF 翻页和文本预览；点击文件名即可下载，缓存附件可离线使用。
- 写信时可切换发件账号，保留收件人、正文、引用与附件，选择随本机草稿保存。
- 新增中英文界面与跟随系统语言，菜单栏和通知同步切换。
- 新增本地草稿管理，以及未读、星标、附件筛选，范围为已缓存邮件。
- 设置拆分为侧边分类，统一 Gr8r 控件样式，修复双层滚动与两行控件对齐。

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
