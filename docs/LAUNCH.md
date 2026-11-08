# Launch kit / 开源发布素材

These are suggested repository settings and copy, not claims about traction.
They are ready to use after the repository and first preview actually exist.

## GitHub About

**Description**

> A local-first desktop email client built with Go + React. Unified inbox, offline reading, IMAP/SMTP, native WebView. 本地优先桌面邮箱。

**Website**

Use `https://github.com/yinxianwei/mymail#readme` until there is a maintained
project website. Do not point users to a Vite build that cannot send/receive mail.

**Topics**

`email-client`, `imap`, `smtp`, `desktop-app`, `macos`, `golang`, `react`,
`typescript`, `sqlite`, `local-first`, `mygo`, `open-source`

Use an actual demo screenshot as the social preview. README screenshots contain
fictional mail; a reproducible seed command is in [DEVELOPMENT.md](DEVELOPMENT.md).
Do not use screenshots of real accounts, messages or credential prompts.

## First release / 第一条介绍

> 我开源了 My Mail：一个用 Go + React 做的本地优先桌面邮箱，界面运行在系统 WebView 中，不捆绑 Chromium，也不用注册项目账号。
>
> 现在可以连接 IMAP / SMTP，汇总多个收件箱，离线阅读已缓存邮件，回复转发、保存草稿、收发附件，并在菜单栏查看未读数。当前是中文界面的早期预览版，已验证环境为 Apple 芯片 Mac，OAuth2 和其他平台还在路线图中。
>
> 仓库：https://github.com/yinxianwei/mymail
>
> 欢迎试用、反馈服务商兼容性或参与改进。如果它对你有用，也欢迎点个 Star。

## English introduction

> I'm building My Mail, a local-first desktop email client with Go, React and the
> system WebView. It connects directly to IMAP/SMTP providers, with a unified
> inbox, cached offline reading, local drafts, attachments and menu bar unread counts.
>
> It's an early preview for Apple Silicon Macs with a Chinese UI. OAuth2,
> localization and other desktop platforms are still on the roadmap. I'd love
> reproducible bug reports and provider compatibility feedback.
>
> Source: https://github.com/yinxianwei/mymail

## Keep discovery useful

- Publish one clear screenshot and a short actual-use recording with the first
  release; link directly to installation instructions.
- Keep the first-screen promise consistent with what the release can do. Avoid
  unmeasured memory/performance numbers and blanket privacy/provider claims.
- Create a few genuinely small, scoped `good first issue` tasks after verifying
  them; apply `help wanted` to work where outside help is useful.
- Respond to reproducible reports and keep a compact release history. Record
  platform/provider test results instead of advertising universal support.
- Share where relevant developers and email users already discuss these tools,
  following each community's rules. Post deliberately; do not automate spam,
  unsolicited messages, fake stars or engagement exchanges.

The repository is the useful artifact. These changes make it easier to understand
and try; they cannot guarantee stars or a place on a trending page.
