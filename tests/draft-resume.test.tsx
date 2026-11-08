import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  composeBody,
  forwardQuote,
  replyQuote,
  resumeDraft,
  splitComposeBody,
  type ComposeSeed,
} from "../src/lib/reply";
import {
  MailService as api,
  events,
  type Account,
  type Draft,
  type Message,
} from "../src/mygo";

const account: Account = {
  id: "first",
  email: "first@example.invalid",
  imapHost: "localhost",
  imapPort: 993,
  imapTLS: "tls",
  smtpHost: "localhost",
  smtpPort: 465,
  smtpTLS: "tls",
  demo: false,
};

const message: Message = {
  id: "first:INBOX:1:1",
  accountId: account.id,
  folder: "INBOX",
  uid: 1,
  validity: 1,
  subject: "季度复盘",
  from: "sender@example.invalid",
  to: account.email,
  date: "2026-11-07T03:00:00Z",
  seen: true,
  text: "正文",
  html: "",
  cached: true,
  attachments: [],
};

const replySeed = (m: Message = message): ComposeSeed => ({
  draft: {
    accountId: account.id,
    to: m.from,
    cc: "",
    subject: /^(re|fwd):/i.test(m.subject) ? m.subject : "Re: " + m.subject,
    body: "",
  },
  content: "",
  quote: replyQuote(m),
});

/** What the composer writes on every keystroke while the reply is open. */
const typedReply = (content: string, m: Message = message): Draft => ({
  ...replySeed(m).draft,
  body: composeBody(content, replyQuote(m)),
});

describe("resumeDraft", () => {
  test("a reply that was closed unsent comes back with its text", () => {
    const seed = replySeed();
    const restored = resumeDraft(typedReply("收到，我下午看一下。"), seed);
    expect(restored).not.toBeNull();
    const split = splitComposeBody(restored!.body);
    expect(split.content).toBe("收到，我下午看一下。");
    expect(split.quote?.kind).toBe("reply");
    // Chips and subject come from the stored draft, so an extra Cc survives.
    expect(restored!.to).toBe(message.from);
    expect(restored!.subject).toBe("Re: 季度复盘");
  });

  test("a draft for another message is not mixed into this reply", () => {
    const other: Message = {
      ...message,
      id: "first:INBOX:1:2",
      uid: 2,
      subject: "周报",
      date: "2026-11-06T01:00:00Z",
      text: "另一封",
    };
    expect(resumeDraft(typedReply("收到", other), replySeed())).toBeNull();
  });

  test("same subject but a different original mail is still kept apart", () => {
    // Two mails can share a subject; the quote date tells them apart.
    const twin: Message = { ...message, date: "2026-11-05T01:00:00Z" };
    const seed = replySeed();
    const draft: Draft = { ...seed.draft, body: composeBody("收到", replyQuote(twin)) };
    expect(resumeDraft(draft, seed)).toBeNull();
  });

  test("an empty draft is never resumed", () => {
    expect(
      resumeDraft({ ...replySeed().draft, body: "" }, replySeed()),
    ).toBeNull();
  });

  test("forwards resume from their metadata block", () => {
    const seed: ComposeSeed = {
      draft: {
        accountId: account.id,
        to: "",
        cc: "",
        subject: "Fwd: 季度复盘",
        body: "",
      },
      content: "",
      quote: forwardQuote(message),
    };
    const draft: Draft = {
      ...seed.draft,
      to: "someone@example.invalid",
      body: composeBody("请看这一封", forwardQuote(message)),
    };
    const restored = resumeDraft(draft, seed);
    expect(splitComposeBody(restored!.body).content).toBe("请看这一封");
  });
});

/** Reopening 回复 on the same mail must show the text that was already typed. */
test("回复 restores the unsent text instead of an empty window", async () => {
  const { window } = new JSDOM("<!doctype html><body></body>", {
    url: "https://mail.test",
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    DOMParser: window.DOMParser,
    IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: window.getComputedStyle.bind(window),
    MutationObserver: window.MutationObserver,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });
  const storedReply = typedReply("收到，我下午看一下。");
  const original = { ...api },
    originalStateOn = events.mailChanged.on,
    originalTargetOn = events.openMail.on;
  const state = {
    unread: 0,
    accountUnread: { first: 0 },
    notifications: true,
    notificationStatus: "",
    checking: false,
    lastError: "",
    revision: 1,
  };
  const empty = (id: string): Draft => ({
    accountId: id,
    key: "new",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachments: [],
  });
  const replyKey = "reply:" + message.id;
  let stored: Record<string, Draft> = { [replyKey]: { ...storedReply } };
  Object.assign(api, {
    state: async () => ({ accounts: [account], database: "test.db" }),
    desktopState: async () => state,
    takeMailTarget: async () => ({ accountId: "", uid: 0, validity: 0 }),
    folders: async () => [
      { name: "INBOX", delimiter: "/", role: "inbox", selectable: true },
    ],
    messages: async () => [message],
    allInboxMessages: async () => [message],
    checkMail: async () => state,
    readMessage: async () => message,
    markRead: async () => {},
    getDraft: async (id: string, key: string) => stored[key] ?? empty(id),
    saveDraft: async (d: Draft) => {
      stored[d.key || "new"] = { ...d };
    },
  });
  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const field = <T extends HTMLElement>(id: string) =>
    document.querySelector<T>("#" + id);
  const button = (text: string) => {
    const found = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!found) throw new Error("找不到按钮 " + text);
    return found;
  };
  try {
    const { App } = await import("../src/App");
    await act(async () => root.render(<App />));
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".message-row")!.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="回复"]')!
        .click();
    });

    expect(document.querySelector(".modal-h h2")?.textContent).toBe("回复邮件");
    expect(field<HTMLTextAreaElement>("compose-body")!.value).toBe(
      "收到，我下午看一下。",
    );
    expect(
      Array.from(document.querySelectorAll(".recipient-chip")).map((chip) =>
        chip.textContent?.trim(),
      ),
    ).toEqual(["sender@example.invalid"]);
    expect(document.querySelector(".draft-status")?.textContent).toContain(
      "已恢复上次未写完的内容",
    );
    // The quote card is rebuilt from the live message, so it keeps its HTML.
    expect(document.querySelector(".quote-card")).not.toBeNull();
    // Nothing was written back on open: the stored draft is untouched.
    expect(stored[replyKey]).toEqual(storedReply);

    // Another mail's reply sits in its own slot and is never mixed into this
    // reply. With keyed drafts there is no "orphan" banner to show either.
    await act(async () => button("保存并关闭").click());
    const other: Message = {
      ...message,
      id: "first:INBOX:1:2",
      uid: 2,
      subject: "周报",
      date: "2026-11-06T01:00:00Z",
    };
    stored = { ["reply:" + other.id]: typedReply("上一封的回复", other) };
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="回复"]')!
        .click();
    });
    expect(document.querySelector(".draft-status")?.textContent).toBe("");
    expect(field<HTMLTextAreaElement>("compose-body")!.value).toBe("");
    expect(document.querySelector(".draft-restore")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = originalStateOn;
    events.openMail.on = originalTargetOn;
  }
});
