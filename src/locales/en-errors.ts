/** Known service diagnostics; raw server responses and user mail are not translated. */
export const errors: Record<string, string> = {
  "测试编号：{0}": "Test ID: {0}",
  "已在本地示例中更新（示例不会写入服务器）":
    "Updated in the local demo (no server changes)",
  "IMAP STARTTLS 失败，未发送凭证":
    "IMAP STARTTLS failed; no credentials were sent",
  "SMTP STARTTLS 失败，未发送凭证":
    "SMTP STARTTLS failed; no credentials were sent",
  "IMAP TLS 证书或握手失败": "IMAP TLS certificate or handshake failed",
  "SMTP TLS 证书或握手失败": "SMTP TLS certificate or handshake failed",
  "IMAP 无法连接，请检查服务器、端口和网络":
    "Could not connect to IMAP. Check the server, port and network",
  "SMTP 无法连接，请检查服务器、端口和网络":
    "Could not connect to SMTP. Check the server, port and network",
  "IMAP 服务器欢迎响应失败，请检查端口与加密方式":
    "IMAP server greeting failed. Check the port and encryption mode",
  "IMAP 认证失败，请检查授权码并确认已开启 IMAP":
    "IMAP authentication failed. Check the app password and enable IMAP",
  "SMTP 认证失败，请检查授权码或服务商认证要求":
    "SMTP authentication failed. Check the app password and provider requirements",
  "{0} 连接测试超过 15 秒，请检查服务器、端口及 TLS/STARTTLS 设置（测试编号 {1}）":
    "The {0} connection test exceeded 15 seconds. Check server, port and TLS/STARTTLS settings (test ID {1})",
  "mailto 参数编码无效": "Invalid mailto parameter encoding",
  "mailto 收件人编码无效": "Invalid mailto recipient encoding",
  "mailto 链接没有收件人或内容": "The mailto link has no recipient or content",
  "mailto 链接过长": "The mailto link is too long",
  "不是 mailto 链接": "Not a mailto link",
  不支持的连接测试: "Unsupported connection test",
  主题不能包含换行: "The subject cannot contain line breaks",
  "仅支持 TLS 或 STARTTLS 加密连接":
    "Only encrypted TLS or STARTTLS connections are supported",
  保存账号失败: "Could not save the account",
  "写信窗口尚未就绪，请稍后重试":
    "The compose window is not ready. Try again shortly",
  "单个附件不能超过 10 MB": "Each attachment must be 10 MB or smaller",
  "单个附件不能超过 10 MB，且只能是普通文件":
    "Attachments must be regular files, up to 10 MB each",
  "历史邮件加载超时，请重试": "Loading older messages timed out. Try again",
  "历史邮件获取失败，本地缓存已保留":
    "Could not fetch older messages. The local cache was kept",
  "发送未确认：请先检查网页邮箱中的已发送，再决定是否重试；草稿已保留":
    "Delivery is unconfirmed. Check Sent in your webmail before retrying; the draft has been kept",
  "只允许打开 HTTP 或 HTTPS 链接": "Only HTTP or HTTPS links can be opened",
  "已有邮件正在发送，请稍候": "A message is already being sent. Please wait",
  当前桌面环境不支持系统通知:
    "System notifications are not supported by this desktop",
  找不到已发送文件夹: "Could not find the Sent folder",
  找不到已删除文件夹: "Could not find the Trash folder",
  操作无法在服务器上完成: "The operation could not be completed on the server",
  "收件箱状态变化，请稍后重试": "Inbox state changed. Try again shortly",
  无效测试编号: "Invalid test ID",
  无效的邮件通知: "Invalid mail notification",
  无法保存待同步操作: "Could not save the pending change",
  "无法保存草稿，已取消发送": "Could not save the draft. Sending was canceled",
  无法打开保存对话框: "Could not open the save dialog",
  无法打开文件夹: "Could not open the folder",
  无法打开附件选择面板: "Could not open the attachment picker",
  无法获取收件箱未读状态: "Could not read the inbox unread count",
  无法解析邮件编码或格式:
    "Could not decode the message format or character set",
  "无法读取授权码，请检查系统钥匙串":
    "Could not read the app password. Check the system credential store",
  服务器上找不到这封邮件: "The message was not found on the server",
  "服务器不支持 IMAP IDLE": "The server does not support IMAP IDLE",
  "服务器不支持按 UID 永久删除":
    "The server does not support permanent deletion by UID",
  "服务器反复结束 IDLE": "The server repeatedly ended IDLE",
  "IDLE 未能在超时前停止": "IDLE did not stop before the timeout",
  服务器未返回完整邮件头: "The server returned incomplete message headers",
  "服务器邮件标识已变化，请刷新文件夹":
    "Server message identifiers changed. Refresh the folder",
  "服务器邮件标识已变化，请刷新文件夹后重试":
    "Server message identifiers changed. Refresh the folder and try again",
  未知操作: "Unknown operation",
  本地示例不连接邮件服务器: "The local demo does not connect to a mail server",
  "查找历史邮件失败，请重试": "Could not find older messages. Try again",
  桌面通知尚未就绪: "Desktop notifications are not ready",
  检查新邮件失败: "Could not check for new mail",
  "正文超过 8 MB，请使用网页邮箱阅读":
    "The body exceeds 8 MB. Read it in your webmail",
  正文过长: "The message body is too long",
  示例邮件没有附件内容: "The demo message has no attachment data",
  "系统凭证库不可用，账号未保存；请先解锁系统钥匙串":
    "The system credential store is unavailable. Unlock it and try again; the account was not saved",
  系统浏览器未能打开该链接: "The system browser could not open this link",
  "系统通知仍在等待授权，请处理系统提示后重试":
    "Notifications are waiting for permission. Respond to the system prompt and try again",
  "系统通知发送失败，请检查系统通知设置":
    "Could not send the notification. Check system notification settings",
  "系统通知未授权，请在系统设置中允许 My Mail 通知":
    "Notifications are not authorized. Allow My Mail notifications in system settings",
  获取文件夹失败: "Could not load folders",
  "获取正文失败，邮件可能已被移动或删除":
    "Could not load the body. The message may have been moved or deleted",
  设置保存失败: "Could not save preferences",
  请先开启新邮件通知: "Enable new mail notifications first",
  请检查服务器地址和端口: "Check the server address and port",
  请输入授权码: "Enter an app password or authorization code",
  "请输入有效的密送地址，多个地址用英文逗号分隔":
    "Enter valid Bcc addresses, separated by commas",
  "请输入有效的抄送地址，多个地址用英文逗号分隔":
    "Enter valid Cc addresses, separated by commas",
  "请输入有效的收件人地址，多个地址用英文逗号分隔":
    "Enter valid recipient addresses, separated by commas",
  请输入有效的邮箱地址: "Enter a valid email address",
  请选择有效的目标文件夹: "Select a valid destination folder",
  账号不存在: "Account not found",
  这封通知对应的邮件已失效或被移动:
    "The message for this notification is no longer available or was moved",
  "这封邮件已在已删除文件夹，请确认永久删除":
    "This message is already in Trash. Confirm permanent deletion",
  这封邮件已被移动或删除: "This message has been moved or deleted",
  连接测试已取消: "Connection test canceled",
  "通知正在等待系统响应，请先处理系统授权提示":
    "Notifications are waiting for the system. Respond to the permission prompt first",
  通知设置保存失败: "Could not save notification preferences",
  邮件不在本地缓存中: "This message is not in the local cache",
  "邮件头同步失败，本地缓存已保留":
    "Could not sync message headers. The local cache was kept",
  邮件已经在这个文件夹里: "This message is already in this folder",
  邮件标识变化: "Message identifiers changed",
  邮件正文不完整或编码不支持:
    "The message body is incomplete or its encoding is unsupported",
  "邮件超过 8 MB，请使用网页邮箱阅读":
    "This message exceeds 8 MB. Read it in your webmail",
  附件不存在: "Attachment not found",
  "附件写入失败，请换一个保存位置":
    "Could not write the attachment. Choose another save location",
  "附件总大小不能超过 25 MB": "Total attachments must be 25 MB or smaller",
  "附件文件已不存在，请重新添加":
    "The attachment file no longer exists. Add it again",
  "附件读取失败，请重新添加": "Could not read the attachment. Add it again",
  "附件超过 8 MB，请使用网页邮箱下载":
    "The attachment exceeds 8 MB. Download it from your webmail",
  "邮件已通过 SMTP 发送，本地发送记录已保存":
    "Sent via SMTP; a local sent record was saved",
  "服务器「已发送」副本写入失败，可在设置中关闭该选项":
    "Could not save the server Sent copy; you can disable this option in preferences",
  "已追加到服务器「已发送」文件夹":
    "A copy was added to the server Sent folder",
  "邮件已发送，但本地发送记录写入失败":
    "The message was sent, but the local sent record could not be saved",
  "邮件已发送，但本地草稿清理失败":
    "The message was sent, but the local draft could not be cleared",
  请勿重复发送: "Do not send it again",
  "已在本机生效，正在同步到服务器": "Saved locally; syncing with the server",
  已在本机生效: "Saved locally",
};
