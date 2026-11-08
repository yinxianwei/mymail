# Development

## Tools and commands

- Go: exact version in [go.mod](../go.mod).
- Bun: exact version in [.bun-version](../.bun-version).
- macOS + Xcode Command Line Tools for the validated native target.
- Python 3 for repository checks and optional screenshot fixtures.

```sh
bun install --frozen-lockfile
bun run dev
bun run generate       # after changing the Go service's exposed API
bun run test           # Go tests and Bun/jsdom tests
bun run build:web      # TypeScript and Vite
bun run licenses       # installed dependency license collection
bun run build          # native app and DMG
python3 scripts/check-repository.py
```

`bun run dev:web` alone cannot perform native mail operations. Do not deploy
the Vite output as a working webmail service; it requires MyGo's native bridge.
No separate checkout of grweb is needed.

## Isolated data

```sh
MYMAIL_DATA_DIR="$(mktemp -d)" bun run dev
```

This isolates SQLite and logs. It does not create a separate OS credential
store or change the native single-instance identity. Use the built-in local
demo unless you deliberately want to test a real account. A real SMTP send is
an external action even when launched from a development build.

For screenshot-ready **fictional** local accounts and messages:

```sh
MYMAIL_DATA_DIR="$(python3 scripts/prepare-demo.py)" bun run dev
```

The fixture script always creates a new temporary directory. It never opens a
live mailbox database, stores credentials or connects to a mail server. The
accounts are marked as demos and cannot send. README screenshots use these
fixtures, with local-only HTML and no remote images. Native window geometry
and WebView theme preferences can still persist independently of SQLite.

## Layout

```text
backend/        Go desktop entry, mail services and Go tests
src/            React interface, generated bindings and styles
tests/          Frontend regression tests
resources/      Application icon and packaged dependency notices
scripts/        Repository checks, license collection and demo fixtures
docs/           User/development guides, roadmap and release notes
.github/        Workflows, issue/PR templates and community policies
```

| Area | Responsibility |
| --- | --- |
| `backend/main.go`, `backend/desktop.go`, `backend/mailto.go` | Lifecycle, menu bar, notifications and deep links |
| `backend/mail.go`, `backend/headers.go` | IMAP/SMTP, MIME, TLS and header decoding |
| `backend/store.go`, `backend/cache.go`, `backend/manage.go` | SQLite, drafts, cache and queued mailbox changes |
| `backend/monitor.go`, `backend/idle.go`, `backend/history.go` | Polling, IDLE and historical pagination |
| `src/App.tsx` | Mail workspace, account setup and composer |
| `src/mygo.ts` | Generated native bindings — do not edit manually |
| `src/mail-html.ts`, `src/components/mail-frame.tsx` | Sanitization, isolated rendering and link bridge |
| `src/components/ui`, `src/styles` | Shared components and Gr8r tokens |
| `backend/*_test.go`, `tests` | Local protocol/storage tests and frontend regressions |

Mail, credentials and persistence remain in Go. The frontend should use the
generated client rather than create another storage/network path.

## Interface languages

Settings offers System default, English and 简体中文. The preference is saved in
SQLite metadata and cached as an interface preference by the frontend. MyGo
receives the same language for native menus, notifications and file dialogs.
Use `t()` from `src/lib/i18n.ts` for interface messages and add the English
entry in `src/locales/`. Translation tests check coverage and interpolation
placeholders. Keep mail content, addresses, attachment filenames and custom
folder IDs/titles out of translation calls. Unknown technical diagnostics keep
their original text.

## Diagnostics

Account setup tests IMAP, SMTP and credential storage in separate stages. Each
network test has a timeout. A failed test includes a request ID that can be
correlated with the log path shown in settings.

Logs use JSON Lines under `logs/app.jsonl` in the selected data directory, with
rotation at about 2 MB and three historical files. They record protocol stage,
result and duration, not credentials or raw server replies. Use
`MYMAIL_LOG_LEVEL=debug bun run dev` when needed. Never attach a whole log or
database to an issue without checking for private hosts and paths.

## Signing and release scope

Local builds can use an available signing identity selected by `mygo.config.ts`.
Set `MYMAIL_SIGN=-` for an explicitly ad-hoc signed build. The GitHub release
workflow always uses that setting; it does not import local certificates.
Developer signing is not Apple notarization. See the
[release guide](RELEASING.md) before distributing a build.

Local IMAP/SMTP test servers and synthetic messages are deliberately used by
automated tests. They verify behavior, not compatibility with QQ, Gmail,
Outlook or another production service. Historical investigation and validation
notes remain in [技术选型与原型验收](技术选型与原型验收.md).

开发端口冲突时，可使用 `MYMAIL_DEV_PORT=5186 bun run dev` 同步调整桌面加载地址与 Vite 端口。
