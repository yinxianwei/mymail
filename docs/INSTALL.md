# Install a preview / 安装预览版

The currently validated desktop target is **macOS Apple Silicon (arm64)**.
There is no validated Intel Mac, Windows or Linux desktop release yet. The
interface supports English and Simplified Chinese. Choose a language in
Account settings → Language, or follow the system language. Use a recent macOS/WebKit; older WebViews have not been
qualified for the Tailwind 4 interface.

## Download and verify

1. Download a DMG and `SHA256SUMS` from the **same published release** on
   [GitHub Releases](https://github.com/yinxianwei/mymail/releases).
2. In that download directory, run:

   ```sh
   shasum -a 256 -c SHA256SUMS
   ```

   Keep the filenames unchanged. A matching hash detects corruption, but does
   not independently establish who built an ad-hoc signed application.
3. Open the DMG and drag **My Mail** into Applications, then launch it.

The automated preview workflow uses **ad-hoc signing and no Apple notarization**.
macOS can block it. If you trust the source of this specific download, follow
[Apple's per-app opening instructions](https://support.apple.com/en-us/102445)
in System Settings → Privacy & Security. Do not turn off Gatekeeper globally.
Building from source is also available in the [README](../README.md).

## First launch

- **打开本地示例** creates fictional local mail; it does not authenticate to a
  provider or send mail.
- To add a real mailbox, enable IMAP/SMTP with the provider and use an app
  password or authorization code when required. Only encrypted connections are
  supported. OAuth2 is not implemented; accounts that require OAuth cannot sign in.
- The credential store may request permission. A new ad-hoc build can have a
  different signing identity and cause another credential access prompt.
- Preferences apply immediately; **完成** closes the settings dialog.
- ⌘/Ctrl + Enter sends a composed message; Enter in the body inserts a newline.
- Closing the window can leave background mail checks running. Use the menu
  bar's **退出 My Mail** to quit the application.

## Data and removal

On macOS the normal data directory is
`~/Library/Application Support/My Mail/`; development normally uses `My Mail Dev`.
It contains `mail.db` and diagnostic logs. Credentials live separately in the
system credential store. Deleting the app does **not** automatically erase
either location. Back up anything you need before removing local data; this
can include drafts that have never been sent or synchronized.

See [security limits](../.github/SECURITY.md) and the
[Chinese user guide](user-guide.zh-CN.md) for details.

中文：当前仅验证 Apple 芯片 Mac。下载 DMG 和同一发行中的 SHA256SUMS 后校验，再安装。自动预览包未公证，被拦截时请按 Apple 文档对该应用单独处理，不要关闭系统整体防护。卸载应用不会自动删除邮件缓存、草稿和系统凭证。
