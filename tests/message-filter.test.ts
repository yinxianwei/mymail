import { expect, test } from "bun:test";
import type { Draft, Message } from "../src/mygo";
import { filterCachedMessages } from "../src/lib/message-filter";
import { draftHasContent } from "../src/lib/reply";

const base: Message = {
  id: "a:INBOX:1:1",
  accountId: "a",
  folder: "INBOX",
  uid: 1,
  validity: 1,
  subject: "季度复盘",
  from: "Sender <sender@example.invalid>",
  to: "you@example.invalid",
  date: "2026-11-08T00:00:00Z",
  seen: false,
  flagged: false,
  text: "正文不参与邮件头搜索",
  html: "",
  cached: false,
  attachments: [],
};

test("local filters compose with header/attachment-name search and preserve order", () => {
  const rows = [
    base,
    {
      ...base,
      id: "b",
      seen: true,
      flagged: true,
      attachments: [{ index: 0, name: "Report.PDF", size: 100 }],
    },
    { ...base, id: "c", flagged: true },
  ];
  expect(filterCachedMessages(rows, "", "unread").map((m) => m.id)).toEqual([
    base.id,
    "c",
  ]);
  expect(
    filterCachedMessages(rows, "  SENDER  ", "starred").map((m) => m.id),
  ).toEqual(["b", "c"]);
  expect(
    filterCachedMessages(rows, "report.pdf", "attachments").map((m) => m.id),
  ).toEqual(["b"]);
  expect(filterCachedMessages(rows, "you@example.invalid", "all")).toHaveLength(
    3,
  );
  expect(filterCachedMessages(rows, "正文", "all")).toHaveLength(0);
  expect(rows[0].seen).toBe(false);
});

test("BCC-only and attachment-only drafts must not disappear from recovery", () => {
  const empty: Draft = {
    accountId: "a",
    key: "new",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachments: [],
  };
  expect(draftHasContent(empty)).toBe(false);
  expect(draftHasContent({ ...empty, bcc: "hidden@example.invalid" })).toBe(
    true,
  );
  expect(
    draftHasContent({
      ...empty,
      attachments: [{ name: "notes.txt", size: 1, path: "/tmp/notes.txt" }],
    }),
  ).toBe(true);
});
