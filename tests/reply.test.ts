import { expect, test } from "bun:test";
import {
  composeBody,
  forwardHeader,
  forwardQuote,
  quoteAttribution,
  quoteDisplay,
  quoteText,
  replyQuote,
  splitComposeBody,
} from "../src/lib/reply";
import type { Message } from "../src/mygo";

const message: Message = {
  id: "a:INBOX:1:1",
  accountId: "a",
  folder: "INBOX",
  uid: 1,
  validity: 1,
  subject: "邮件标题",
  from: "Alice <alice@qq.com>",
  to: "me@example.com",
  date: "2026-11-07T12:37:00Z",
  seen: true,
  text: "滴滴\n\n第二段",
  html: "",
  cached: true,
  attachments: [],
};

test("reply quote uses the standard attribution and > prefixes", () => {
  const quote = replyQuote(message);
  expect(quoteAttribution(quote)).toContain("Alice <alice@qq.com> 写道：");
  expect(quoteText(quote)).toContain("> 滴滴");
  expect(quoteText(quote)).toContain("> 第二段");
  expect(composeBody("收到", quote)).toBe(`收到\n\n${quoteText(quote)}`);
});

test("a reply quote keeps the original header for the composer card", () => {
  const quote = replyQuote(message);
  expect(quote.kind).toBe("reply");
  expect(quote.from).toBe("Alice <alice@qq.com>");
  expect(quote.to).toBe("me@example.com");
  expect(quote.subject).toBe("邮件标题");
  expect(quote.date).toContain("2026-11-07");
});

test("an HTML original carries its markup so the quote renders like the reader", () => {
  expect(replyQuote({ ...message, html: "<p>滴滴</p>" }).html).toBe(
    "<p>滴滴</p>",
  );
  expect(replyQuote(message).html).toBeUndefined();
});

test("a saved reply draft splits back into editable content and quote", () => {
  const body = composeBody("收到", replyQuote(message));
  const split = splitComposeBody(body);
  expect(split.content).toBe("收到");
  expect(split.quote?.kind).toBe("reply");
  expect(split.quote?.from).toContain("alice@qq.com");
  expect(split.quote?.date).toContain("2026-11-07");
  expect(split.quote?.text).toBe("滴滴\n\n第二段");
});

test("forward quote keeps the metadata header when sent and restored", () => {
  const quote = forwardQuote(message);
  const body = composeBody("", quote);
  expect(forwardHeader(quote)[0]).toContain("转发的邮件");
  expect(body).toContain("-------- 转发的邮件 --------");
  expect(body).toContain("主题：邮件标题");
  const split = splitComposeBody(body);
  expect(split.content).toBe("");
  expect(split.quote?.kind).toBe("forward");
  expect(split.quote?.from).toBe("Alice <alice@qq.com>");
  expect(split.quote?.to).toBe("me@example.com");
  expect(split.quote?.subject).toBe("邮件标题");
  expect(split.quote?.date).toContain("2026-11-07");
  expect(split.quote?.text).toBe("滴滴\n\n第二段");
});

test("a plain draft stays content without a quote", () => {
  const split = splitComposeBody("普通草稿");
  expect(split).toEqual({ content: "普通草稿", quote: null });
});
