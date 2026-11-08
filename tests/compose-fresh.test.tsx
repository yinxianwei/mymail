import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { composeBody, replyQuote } from "../src/lib/reply";
import {
  MailService as api,
  events,
  type Account,
  type Draft,
  type Message,
} from "../src/mygo";

/**
 * “写邮件” must open a blank message even when the account has a stored draft
 * (typically the reply that was just closed). The stored draft is offered in
 * the window instead of being loaded silently, and closing the blank window
 * must leave it untouched.
 */
test("写邮件 opens a blank message instead of the stored reply draft", async () => {
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
    HTMLFormElement: window.HTMLFormElement,
    DocumentFragment: window.DocumentFragment,
    HTMLSelectElement: window.HTMLSelectElement,
    HTMLInputElement: window.HTMLInputElement,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });
  // React's input-event fallback expects legacy methods absent in jsdom.
  Object.assign(window.HTMLElement.prototype, {
    attachEvent() {},
    detachEvent() {},
  });
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
  // Exactly what the composer saved when that reply was closed unsent.
  const storedReply: Draft = {
    accountId: account.id,
    to: message.from,
    cc: "",
    subject: "Re: 季度复盘",
    body: composeBody("收到，我下午看一下。", replyQuote(message)),
  };
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
  let stored: Draft = { ...storedReply };
  const saves: Draft[] = [];
  const sent: Draft[] = [];
  let rejectSend: ((error: Error) => void) | undefined;
  Object.assign(api, {
    state: async () => ({
      accounts: [
        account,
        { ...account, id: "second", email: "second@example.invalid" },
      ],
      database: "test.db",
    }),
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
    getDraft: async (id: string) =>
      stored.accountId === id
        ? stored
        : { accountId: id, to: "", cc: "", subject: "", body: "" },
    send: (d: Draft) => {
      sent.push(d);
      return new Promise<string>((_, reject) => {
        rejectSend = reject;
      });
    },
    saveDraft: async (d: Draft) => {
      saves.push(d);
      stored = { ...d };
    },
  });
  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) => {
    const found = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!found) throw new Error("找不到按钮 " + text);
    return found;
  };
  const field = <T extends HTMLElement>(id: string) =>
    document.querySelector<T>("#" + id);
  try {
    const { App } = await import("../src/App");
    await act(async () => root.render(<App />));
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".message-row")!.click();
    });

    // A message is open, but “写邮件” is still a new message.
    await act(async () => button("写邮件").click());
    expect(document.querySelector(".modal-h h2")?.textContent).toBe("新邮件");
    expect(document.querySelectorAll(".recipient-chip").length).toBe(0);
    expect(field<HTMLInputElement>("compose-subject")!.value).toBe("");
    expect(field<HTMLTextAreaElement>("compose-body")!.value).toBe("");
    expect(document.querySelector(".quote-card")).toBeNull();
    expect(document.querySelector(".draft-restore")?.textContent).toContain(
      "Re: 季度复盘",
    );

    // Closing without typing leaves the stored draft alone.
    await act(async () => button("保存并关闭").click());
    expect(saves).toEqual([]);
    expect(stored).toEqual(storedReply);

    // The offer brings the draft back, quote included.
    await act(async () => button("写邮件").click());
    await act(async () => button("继续编辑").click());
    expect(
      Array.from(document.querySelectorAll(".recipient-chip")).map((chip) =>
        chip.textContent?.trim(),
      ),
    ).toEqual(["sender@example.invalid"]);
    expect(field<HTMLInputElement>("compose-subject")!.value).toBe(
      "Re: 季度复盘",
    );
    expect(field<HTMLTextAreaElement>("compose-body")!.value).toBe(
      "收到，我下午看一下。",
    );
    expect(
      document.querySelector(".quote-card .quote-text")?.textContent,
    ).toContain("正文");
    expect(document.querySelector(".draft-restore")).toBeNull();
    Object.assign(window.HTMLElement.prototype, { scrollIntoView() {} });
    await act(async () => {
      document
        .querySelector("#compose-sender")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
          }),
        );
    });
    await act(async () => {
      const option = [
        ...document.querySelectorAll<HTMLElement>('[role="option"]'),
      ].find((n) => n.textContent?.includes("second@example.invalid"))!;
      option.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(saves.at(-1)?.senderAccountId).toBe("second");
    expect(saves.at(-1)?.accountId).toBe(account.id);
    expect(field<HTMLInputElement>("compose-subject")!.value).toBe(
      "Re: 季度复盘",
    );
    const body = field<HTMLTextAreaElement>("compose-body")!;
    expect(body.closest("form")).not.toBeNull();
    await act(async () => body.focus());
    const key = (options: KeyboardEventInit) =>
      body.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
    await act(async () => {
      key({});
      key({ metaKey: true, isComposing: true });
    });
    expect(sent).toHaveLength(0);
    await act(async () => {
      key({ metaKey: true });
      key({ metaKey: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].senderAccountId).toBe("second");
    expect(sent[0].body).toContain("收到，我下午看一下。");
    await act(async () => {
      rejectSend!(new Error("模拟发送失败"));
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "模拟发送失败",
    );
    await act(async () => body.focus());
    await act(async () => {
      key({ ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sent).toHaveLength(2);
    await act(async () => {
      rejectSend!(new Error("模拟发送失败"));
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = originalStateOn;
    events.openMail.on = originalTargetOn;
  }
});
