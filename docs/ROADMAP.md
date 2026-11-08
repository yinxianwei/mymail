# Roadmap / 路线图

This is a direction, not a delivery schedule. Existing behavior is described in
the [README](../README.md); implementation history is in the
[changelog](../CHANGELOG.md). Provider compatibility claims require real tests.

## Next: make the preview dependable

Current feature inventory and next acceptance criteria:
[产品功能盘点](PRODUCT_GAPS.zh-CN.md).

- [x] Local draft manager: list, resume with the owning account, and confirmed deletion.
- [x] Cached-mail filters for unread, starred and known attachments, combined with keyword search.
- [ ] Account editing, credential renewal and explicit local account removal/pause.
- [ ] Multi-select mail actions and inspectable pending synchronization operations.

- [ ] Publish the first public preview with installation instructions and hashes.
- [ ] Complete a real provider compatibility matrix: authentication, receive,
  send, Cc/Bcc, attachments, folders, flags and IDLE → notification → open mail.
- [ ] Test sleep/wake, reconnects, long-running sessions, large folders and
  concurrent changes from other mail clients.
- [ ] Developer ID signing and Apple notarization for public macOS downloads.
- [ ] Accessibility and keyboard navigation review across the three-pane UI.

## Then: broaden where it works

- [ ] OAuth2 for providers that require it; document the scopes and token storage.
- [ ] Intel Mac, Windows and Linux validation and packaging.
- [x] English/Chinese interface with saved system/manual language preferences,
  localized native menus, notifications and attachment dialogs.
- [ ] Startup time and full-process memory measurements with a reproducible setup.

## Later: expand the workflow

- [ ] Full-text search beyond the currently cached list.
- [ ] Server-synchronized drafts and a local sent-record view.
- [x] Local image, PDF and text attachment previews, with size bounds and no attachment script execution.
- [ ] Signed automatic updates.

## Good first contributions

- Reproduce an issue using fictional messages and add a regression test.
- Improve keyboard labels/focus behavior or a missing empty/error state.
- Verify installation instructions on a clean Mac.
- Submit a provider report with exact versions and pass/fail results, without
  credentials or message contents.
- Improve English/Chinese documentation consistency.

中文：近期先补真实服务商验证、稳定性与分发签名，再推进 OAuth、其他平台和英文界面；已补图片、PDF 与文本附件预览；全文搜索、服务器草稿和自动更新后续再做。欢迎从小问题复现、无障碍和文档贡献开始。
