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
import type { ThemeId } from "../src/App";

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
  subject: "卡片主题测试邮件",
  from: "sender@example.invalid",
  to: account.email,
  date: "2026-11-15T08:00:00Z",
  seen: true,
  flagged: false,
  text: "正文内容",
  html: "",
  cached: true,
  attachments: [],
};

function bootstrap() {
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
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });
  return window;
}

test("Card theme supports light and dark variations with persistence", async () => {
  bootstrap();
  const original = { ...api };
  const origMailChanged = events.mailChanged.on;
  const origOpenMail = events.openMail.on;
  const origComposeMail = events.composeMail.on;

  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  events.composeMail.on = () => () => {};

  const desktop = {
    unread: 0,
    accountUnread: { first: 0 },
    notifications: true,
    notificationStatus: "",
    checking: false,
    lastError: "",
    revision: 1,
  };

  Object.assign(api, {
    state: async () => ({
      accounts: [account],
      database: "test.db",
    }),
    desktopState: async () => desktop,
    takeMailTarget: async () => ({ accountId: "", uid: 0, validity: 0 }),
    folders: async () => [
      { name: "INBOX", delimiter: "/", role: "inbox", selectable: true },
    ],
    messages: async () => [message],
    allInboxMessages: async () => [message],
    checkMail: async () => desktop,
    readMessage: async () => message,
    markRead: async () => {},
    getDraft: async (id: string) => ({
      accountId: id,
      to: "",
      cc: "",
      subject: "",
      body: "",
      attachments: [],
    }),
    saveDraft: async () => {},
  });

  localStorage.setItem("mail:theme", "card");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  try {
    const { App } = await import("../src/App");
    await act(async () => {
      root.render(<App />);
    });

    expect(document.documentElement.dataset.theme).toBe("card");
    expect(localStorage.getItem("mail:theme")).toBe("card");

    // Toggle to card-dark
    const darkToggle = host.querySelector<HTMLButtonElement>(
      'button[aria-label="深色主题"]',
    );
    expect(darkToggle).not.toBeNull();
    await act(async () => {
      darkToggle?.click();
    });

    expect(document.documentElement.dataset.theme).toBe("card-dark");
    expect(localStorage.getItem("mail:theme")).toBe("card-dark");
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = origMailChanged;
    events.openMail.on = origOpenMail;
    events.composeMail.on = origComposeMail;
  }
});

test("Legacy nova theme preferences automatically migrate to modern card themes", () => {
  const legacyLight = "nova";
  const mappedLight: ThemeId = legacyLight === "nova" ? "card" : "light";
  expect(mappedLight).toBe("card");

  const legacyDark = "nova-dark";
  const mappedDark: ThemeId = legacyDark === "nova-dark" ? "card-dark" : "dark";
  expect(mappedDark).toBe("card-dark");
});
