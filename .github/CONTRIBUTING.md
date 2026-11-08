# Contributing / 参与贡献

Thanks for helping improve My Mail. Issues and pull requests in English or
Chinese are welcome. The app is an early preview; a precise bug report is as
useful as a code contribution.

## Start here

- Bugs: use the [bug report](https://github.com/yinxianwei/mymail/issues/new?template=bug_report.yml).
- Feature ideas: explain the problem and your current workaround in a
  [feature request](https://github.com/yinxianwei/mymail/issues/new?template=feature_request.yml).
- Provider tests: include the provider, auth method, app version, OS and which
  operations passed. Never attach an authorization code, mailbox database or
  unredacted email. A connection test alone does not prove send/receive support.
- Security vulnerabilities: follow [SECURITY.md](SECURITY.md), not a public issue.
- Check the [roadmap](../docs/ROADMAP.md) before proposing a large change. Platform
  support, OAuth and synchronization changes benefit from an issue first.

## Development

See [development setup](../docs/DEVELOPMENT.md). Use a separate `MYMAIL_DATA_DIR`
for development and synthetic addresses such as `you@example.invalid` in tests.
Only test real sends when you explicitly intend to deliver that email.

Before a pull request:

```sh
bun install --frozen-lockfile
python3 scripts/check-repository.py
go vet ./...
bun run test
bun run build:web
```

For Go/IPC API changes, also run `bun run generate` and commit the generated
`src/mygo.ts`. Do not hand-edit generated bindings. For desktop behavior, run
`bun run build` and describe the OS and manual checks; unit tests alone do not
validate a native application or a real email provider.

Use `gofmt` for Go and Prettier for changed frontend files. Keep PRs focused,
include the reason for the change, how it was checked, and screenshots for UI
changes. Tests should cover a behavior or regression, not mirror implementation.

## Boundaries that matter

- Mail, account configuration and credentials belong in Go. Credentials go in
  the system credential store, never the frontend or a committed `.env` file.
- Never log credentials, full addresses, message bodies or raw protocol replies.
- Keep HTML sanitization, opaque-origin iframe sandboxing, CSP and bridge-source
  validation intact. Sender-controlled HTML must not reach the application DOM.
- A timeout after SMTP submission can mean an email was delivered. Do not
  automatically retry an uncertain send.
- Reuse the components and tokens already in `src/components/ui` and `src/styles`.
- Preserve third-party license notices. Contributions are provided under this
  repository's MIT license; no separate CLA is required.

## Community

Please follow the [community guidelines](CODE_OF_CONDUCT.md).

Discuss changes respectfully, assume good intent and critique ideas rather
than people. Do not post harassment, personal information, credentials or spam.
Maintainers may remove abusive or sensitive content.

中文补充：欢迎中文 Issue 和 PR。请写清楚复现步骤、期望行为和检查结果；邮箱兼容反馈请区分“认证通过”“收信”“发信”“附件”“通知”，不要把本地模拟测试当成真实服务商验收。日志、截图和邮件示例请先脱敏。
