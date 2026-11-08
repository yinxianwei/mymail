import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { splitAddresses } from "../src/components/ui/chip-input";
import {
  MailService as api,
  events,
  type Account,
  type Draft,
  type Message,
} from "../src/mygo";

test("address chips split exactly like the stored draft", () => {
  expect(splitAddresses("a@b.com, c@d.com")).toEqual(["a@b.com", "c@d.com"]);
  expect(splitAddresses("a@b.com;c@d.com，e@f.com")).toEqual([
    "a@b.com",
    "c@d.com",
    "e@f.com",
  ]);
  expect(splitAddresses("  ")).toEqual([]);
  expect(splitAddresses("a@b.com,,,")).toEqual(["a@b.com"]);
});

/**
 * Reply-all splits the thread the way other clients do: the sender on To, the
 * rest on Cc. The composer shows both as chips, sends them, and the sender
 * address lives in the footer next to the buttons.
 */
test("reply-all puts the other recipients on Cc chips", async () => {
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
    // The reader is on the thread too, and must not be copied on the reply.
    to: "first@example.invalid, other@example.invalid",
    date: "2026-11-07T03:00:00Z",
    seen: true,
    text: "正文",
    html: "",
    cached: true,
    attachments: [],
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
  const sent: Draft[] = [];
  const drafts: Draft[] = [];
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
    getDraft: async (id: string) => ({
      accountId: id,
      to: "",
      cc: "",
      subject: "",
      body: "",
    }),
    saveDraft: async (d: Draft) => {
      drafts.push(d);
    },
    send: async (d: Draft) => {
      sent.push(d);
      return "已发送";
    },
  });
  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  // Focusing a text input makes React's legacy input polyfill call
  // `attachEvent`, which jsdom does not implement; a stub keeps the run quiet
  // without changing what the test observes.
  (
    window.HTMLElement.prototype as unknown as { attachEvent?: () => void }
  ).attachEvent ??= () => {};
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
  const row = (label: string) =>
    Array.from(document.querySelectorAll(".recipient-row")).find(
      (item) => item.querySelector("label")?.textContent === label,
    );
  const chips = (label: string) =>
    Array.from(row(label)?.querySelectorAll(".recipient-chip") ?? []).map(
      (chip) => chip.textContent?.trim(),
    );
  const openReplyAll = async () => {
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".message-row")!.click();
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="回复全部"]')!.click(),
    );
  };
  try {
    const { App } = await import("../src/App");
    await act(async () => root.render(<App />));
    await openReplyAll();
    expect(chips("收件人")).toEqual(["sender@example.invalid"]);
    expect(chips("抄送")).toEqual(["other@example.invalid"]);
    // The sender moved to the footer; the form no longer repeats it.
    expect(document.querySelector(".modal-f .compose-from")?.textContent).toBe(
      "发件人：first@example.invalid",
    );
    expect(document.querySelector(".compose-form .compose-from")).toBeNull();

    await act(async () => button("发送邮件").click());
    expect(sent.length).toBe(1);
    expect(sent[0]!.to).toBe("sender@example.invalid");
    expect(sent[0]!.cc).toBe("other@example.invalid");

    // Removing a chip is enough to change the draft: no typing involved.
    await openReplyAll();
    await act(async () =>
      row("抄送")!
        .querySelector<HTMLButtonElement>("button[aria-label^='移除']")!
        .click(),
    );
    expect(chips("抄送")).toEqual([]);
    expect(drafts.at(-1)?.cc).toBe("");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = originalStateOn;
    events.openMail.on = originalTargetOn;
  }
});
