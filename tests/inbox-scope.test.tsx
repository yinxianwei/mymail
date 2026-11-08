import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  MailService as api,
  events,
  type Account,
  type Message,
} from "../src/mygo";

test("unified inbox switches accounts, shows sources, and reads with the message identity", async () => {
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
  const accounts: Account[] = ["first", "second"].map((id) => ({
    id,
    email: id + "@example.invalid",
    imapHost: "localhost",
    imapPort: 993,
    imapTLS: "tls",
    smtpHost: "localhost",
    smtpPort: 465,
    smtpTLS: "tls",
    demo: false,
  }));
  const messages: Message[] = accounts.map((a, i) => ({
    id: a.id + ":INBOX:1:1",
    accountId: a.id,
    folder: "INBOX",
    uid: 1,
    validity: 1,
    subject: "邮件" + (i + 1),
    from: "sender@example.invalid",
    to: a.email,
    date: "2026-11-07T03:00:00Z",
    seen: false,
    text: "正文",
    html: "",
    cached: true,
    attachments: [],
  }));
  const original = { ...api },
    originalStateOn = events.mailChanged.on,
    originalTargetOn = events.openMail.on;
  const readIDs: string[] = [];
  let checkCount = 0;
  const state = {
    unread: 2,
    accountUnread: { first: 1, second: 1 },
    notifications: true,
    notificationStatus: "",
    checking: false,
    lastError: "",
    revision: 1,
  };
  Object.assign(api, {
    getDraft: async (id: string) => ({
      accountId: id,
      to: "",
      cc: "",
      subject: "",
      body: "",
    }),
    state: async () => ({ accounts, database: "test.db" }),
    desktopState: async () => state,
    takeMailTarget: async () => ({ accountId: "", uid: 0, validity: 0 }),
    folders: async () => [
      { name: "INBOX", delimiter: "/", role: "inbox", selectable: true },
    ],
    messages: async (id: string) => messages.filter((m) => m.accountId === id),
    allInboxMessages: async () => messages,
    checkMail: async () => {
      checkCount++;
      return state;
    },
    readMessage: async (id: string) => {
      readIDs.push(id);
      return messages.find((m) => m.id === id)!;
    },
    markRead: async () => {},
    saveDraft: async () => {},
  });
  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    const { App } = await import("../src/App");
    await act(async () => root.render(<App />));
    const allButton = () =>
      Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          ".unified-inboxes .folder-select",
        ),
      ).find((b) => b.textContent?.includes("所有收件箱"))!;
    await act(async () => allButton().click());
    expect(host.querySelectorAll(".message-row").length).toBe(2);
    expect(host.querySelectorAll(".message-account").length).toBe(2);
    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>(".message-row")[1]!.click(),
    );
    expect(readIDs).toEqual(["second:INBOX:1:1"]);
    expect(host.querySelector(".plain-body")?.textContent).toContain("正文");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="回复"]')!.click(),
    );
    expect(
      Array.from(document.querySelectorAll(".recipient-chip")).map((chip) =>
        chip.textContent?.trim(),
      ),
    ).toEqual(["sender@example.invalid"]);
    expect(
      document.querySelector<HTMLInputElement>("#compose-subject")?.value,
    ).toBe("Re: 邮件2");
    expect(
      document.querySelector(".quote-card .quote-text")?.textContent,
    ).toContain("正文");
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent?.trim() === "保存并关闭")!
        .click(),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="转发"]')!.click(),
    );
    expect(document.querySelectorAll(".recipient-chip").length).toBe(0);
    expect(
      document.querySelector<HTMLInputElement>("#compose-subject")?.value,
    ).toBe("Fwd: 邮件2");
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent?.trim() === "保存并关闭")!
        .click(),
    );
    await act(async () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent?.trim() === "写邮件")!
        .click(),
    );
    expect(document.querySelector(".compose-from")?.textContent).toContain(
      "second@example.invalid",
    );
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent?.trim() === "保存并关闭")!
        .click(),
    );

    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="刷新邮件"]')!.click(),
    );
    expect(checkCount).toBe(1);
    await act(async () =>
      Array.from(
        host.querySelectorAll<HTMLButtonElement>(
          ".unified-inboxes .folder-select",
        ),
      )
        .find((b) => b.title === "second@example.invalid")!
        .click(),
    );
    expect(host.querySelectorAll(".message-row").length).toBe(1);
    expect(host.querySelector(".message-row")?.textContent).toContain("邮件2");
    expect(
      host.querySelector('.unified-inboxes [aria-current="page"]')?.textContent,
    ).toContain("second@example.invalid");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = originalStateOn;
    events.openMail.on = originalTargetOn;
  }
});
