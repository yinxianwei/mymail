# Security policy / 安全说明

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/yinxianwei/mymail/security/advisories/new)
for credential exposure, HTML/script escapes, unsafe file writes or other
security vulnerabilities. Include the affected version, steps to reproduce,
expected impact and a minimal synthetic example. Do not include real mailbox
credentials or private mail.

If private reporting is not available yet, open a public issue asking for a
private contact channel **without exploit details or private data**. This is a
small volunteer project; response times are not guaranteed. Security fixes are
made on the current development branch and latest preview; older previews have
no separate support commitment.

## Current security model and limits

- Mail connections require TLS or STARTTLS and certificate verification.
- Credentials live in the system credential store. SQLite contains cached mail,
  drafts, account configuration and attachment bytes; **it is not encrypted by
  the application**. Protect your OS account, disk and backups accordingly.
- Diagnostic logs omit passwords, authorization codes, full addresses, email
  content, IPC parameters and raw protocol responses. Inspect any log before
  sharing it; hostnames and local paths can still reveal information.
- Mail HTML is sanitized with DOMPurify and isolated with CSP and an
  opaque-origin iframe (`allow-scripts`, never `allow-same-origin`). Only the
  application's nonce-authorized height/link bridge runs; sender scripts are
  removed. Report any escape from this boundary privately.
- Remote content preferences affect privacy. The default trusts common mailbox
  provider domains and the account's domain. **This is a UI heuristic, not
  authenticated sender identity:** SPF/DKIM/DMARC are not checked. A remote image
  request can expose IP address, time and tracking identifiers. Choose **never
  load remote images** for stricter behavior.
- HTTP(S) links open in the system browser after an explicit click. Link safety
  is not a phishing or malware verdict.
- Attachment size/name checks do not constitute antivirus scanning. The app
  does not preview or execute attachments.
- Uncertain SMTP outcomes are not automatically retried to avoid duplicate mail.
- Automated release drafts are ad-hoc signed, not Developer ID signed or Apple
  notarized. SHA-256 files detect corruption; they are not an independent proof
  of publisher identity.

## Before sharing diagnostics

Never upload `mail.db`, SQLite sidecars, mail exports, keychain exports, `.env`,
signing keys or a whole application data directory. Replace mailbox addresses,
private hosts and message content in screenshots. Use fictional `.invalid`
addresses in reproducible samples.

中文：漏洞请优先通过上面的 GitHub 私密报告入口提交；入口尚未启用时，只公开请求私下联系方式，不要公开漏洞细节。数据库没有应用层加密，域名信任不代表发件人验证；反馈问题时不要上传数据库、真实邮件或授权码。
