# 开发约束

- Go 桌面入口、服务与 Go 测试统一放在 `backend/`；前端放在 `src/`，前端测试放在 `tests/`。`mygo.config.ts` 的 `main` 指向 `./backend`；新增 Go 服务文件不要放回根目录。

- 结构探索使用已安装的 codebase-memory skill。索引后检查所依赖文件的覆盖情况。
- 前端沿用 grweb 的 Gr8r 设计规范；所需控件、字体与样式已包含在本仓库，不依赖另一个本地目录。颜色、字号、尺寸优先使用 `src/styles/tokens.css` 和 `theme.css`。默认控件高 30px；md 断点 900px，lg 1100px。
- 通用控件复用 `src/components/ui/`；不要在业务页面另造按钮、输入框和弹层。
- 邮件、草稿与账号配置由 Go / SQLite 持有；凭证仅使用系统凭证库；禁止输出密码、授权码或完整邮件到日志。
- 不可信 HTML 只能通过 `src/mail-html.ts` 清洗后进入不透明源 sandbox iframe（`allow-scripts`，不得加 `allow-same-origin`）。框架内除页面注入的、带 CSP nonce 的链接回传脚本外不得有任何脚本；WebKit 不会把沙箱框架内的事件交给页面注册的监听器，链接点击必须由该脚本 `postMessage` 回传，页面校验 `event.source` 后才可打开。srcdoc 框架会继承 `index.html` 的 CSP，因此页面 `script-src` 必须保留 `'unsafe-inline'`，否则桥接脚本被拦（邮件仍受框架自身的 nonce 策略限制）。不得直接使用 innerHTML，不得直接解析未经清洗的邮件来提取链接。
- `src/mygo.ts` 由 `bun run generate` 自动生成，禁止手工修改。
- SMTP 发送结果不明确时禁止自动重发；本地示例必须明确标识且不可发送。
- 当前原型范围与未完成项以 README 为准，不得将本地协议测试表述为真实服务商验收。
- 变更后运行对应检查：`bun run test`、`bun run build:web`。涉及桌面绑定时再运行 `bun run build` 并检查实际应用。
