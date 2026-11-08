#!/usr/bin/env python3
"""Create a NEW temporary, fictional mail database for screenshots/manual checks."""
import datetime as dt
import html
import json
import os
from pathlib import Path
import sqlite3
import tempfile


def main():
    folder = Path(tempfile.mkdtemp(prefix="mymail-demo-"))
    db = sqlite3.connect(folder / "mail.db")
    db.executescript("""
        CREATE TABLE accounts(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE messages(id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
          folder TEXT NOT NULL, uid INTEGER NOT NULL, validity INTEGER NOT NULL,
          data TEXT NOT NULL);
    """)
    accounts = [
        ("demo-personal", "个人邮箱 · 示例"),
        ("demo-work", "工作邮箱 · 示例"),
    ]
    for account_id, label in accounts:
        db.execute("INSERT INTO accounts VALUES(?,?)", (
            account_id, json.dumps({"id": account_id, "email": label, "demo": True}),
        ))
    samples = [
        ("My Mail", "欢迎来到 My Mail", "多个邮箱，一处处理。", [
            "这里是你的邮件工作区。",
            "在左侧切换邮箱，在中间浏览邮件，在右侧专心阅读。向下滚动列表，还可以继续加载更早的邮件。",
            "离线时，已经缓存的正文依然可以阅读；未完成的邮件会保存在本机草稿中。",
            "这是一封用于展示界面的虚构邮件，不连接真实邮箱，也不会发送任何内容。",
        ]),
        ("林晓 · 示例", "周末去看一场展览吧", "周六下午，一起留点时间给生活。", ["我找到一个很有意思的设计展，周六下午有空的话一起去吧。"]),
        ("设计小组 · 示例", "本周设计回顾", "让界面少一些干扰，多一些专注。", ["这周我们整理了导航、主题与键盘交互，欢迎看看新的方案。"]),
        ("开源周刊 · 示例", "这一周，值得关注的小项目", "一些小而实用的开源工具。", ["从一个清楚的问题出发，把解决方案做得简单一点。"]),
        ("陈雨 · 示例", "Re: 下周的项目安排", "收到，我们周一一起过一下。", ["我已经补充了几个需要讨论的问题，周一见。"]),
        ("阅读清单 · 示例", "留给周末的三篇文章", "关于写作、设计和慢一点的生活。", ["收藏一些长文章，找一个安静的下午慢慢读。"]),
        ("产品小组 · 示例", "新版本体验反馈", "几个细节，让日常使用更顺手。", ["邮件列表和阅读区域的交互已经更新，期待你的体验反馈。"]),
        ("林晓 · 示例", "照片整理好了", "上次旅行的那些好天气。", ["挑了几张最喜欢的照片，下次见面一起看。"]),
    ]
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    for index, (sender, subject, intro, paragraphs) in enumerate(samples):
        account_id = accounts[index % 2][0]
        uid = len(samples) - index
        text = "\n\n".join([intro] + paragraphs)
        rich = "<h2>" + html.escape(intro) + "</h2>" + "".join(
            "<p>" + html.escape(p) + "</p>" for p in paragraphs
        )
        message_id = f"{account_id}:INBOX:1:{uid}"
        message = {
            "id": message_id, "accountId": account_id, "folder": "INBOX",
            "uid": uid, "validity": 1, "subject": subject,
            "from": f"{sender} <demo{index}@example.invalid>",
            "to": "you@example.invalid", "date": (now - dt.timedelta(hours=index * 3)).isoformat(),
            "seen": index in (0, 2, 4, 5), "flagged": index in (0, 3),
            "cached": True, "text": text, "html": rich, "attachments": [],
        }
        db.execute("INSERT INTO messages VALUES(?,?,?,?,?,?)", (
            message_id, account_id, "INBOX", uid, 1, json.dumps(message),
        ))
    db.commit()
    db.close()
    os.chmod(folder / "mail.db", 0o600)
    print(folder)


if __name__ == "__main__":
    main()
