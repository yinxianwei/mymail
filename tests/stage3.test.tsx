import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  MailService as api,
  events,
  type Account,
  type CacheStats,
  type Draft,
  type Message,
  type Settings,
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
  flagged: false,
  text: "正文",
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
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
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

test("缓存上限与 mailto 深链接入设置页和写信窗口", async () => {
  const window = bootstrap();
  const original = { ...api },
    originalStateOn = events.mailChanged.on,
    originalTargetOn = events.openMail.on,
    originalComposeOn = events.composeMail.on;
  const calls: string[] = [];
  let listener: ((draft: Draft) => void) | null = null;
  let prefs: Settings = {
    syncIntervalSec: 60,
    autoMarkRead: true,
    remoteDefault: "trusted",
    appendSent: false,
    cacheLimit: 2000,
  };
  const stats: CacheStats = {
    messages: 42,
    headerBytes: 1024,
    attachments: 3,
    attachmentBytes: 2048,
    sent: 1,
    limit: 2000,
  };
  // A stored draft is deliberately non-empty: a mailto link must not be
  // replaced by resumeDraft, but it should still be offered for later editing.
  const stored: Draft = {
    accountId: account.id,
    key: "new",
    to: "old@example.com",
    cc: "",
    bcc: "",
    subject: "旧草稿",
    body: "旧正文",
    attachments: [],
  };
  const desktop = {
    unread: 0,
    accountUnread: {},
    notifications: false,
    notificationStatus: "",
    checking: false,
    lastError: "",
    revision: 1,
  };
  Object.assign(api, {
    state: async () => ({ accounts: [account], database: "test.db" }),
    desktopState: async () => desktop,
    takeMailTarget: async () => ({ accountId: "", uid: 0, validity: 0 }),
    folders: async () => [
      { name: "INBOX", delimiter: "/", role: "inbox", selectable: true },
    ],
    messages: async () => [message],
    allInboxMessages: async () => [message],
    checkMail: async () => desktop,
    readMessage: async () => message,
    getSettings: async () => prefs,
    setSettings: async (v: Settings) => {
      calls.push("setSettings:" + v.cacheLimit);
      prefs = v;
      return v;
    },
    getDraft: async () => stored,
    saveDraft: async () => {},
    pendingCount: async () => 0,
    cacheStats: async () => {
      calls.push("cacheStats");
      return stats;
    },
    trimCache: async () => {
      calls.push("trimCache");
      return stats;
    },
    openMailto: async () => {
      calls.push("openMailto");
    },
  });
  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  events.composeMail.on = (fn) => {
    listener = fn;
    return () => {};
  };
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
  try {
    const { App } = await import("../src/App");
    await act(async () => root.render(<App />));
    expect(listener).not.toBeNull();

    // Preferences: cap, live stats, manual trim and the mailto test entry.
    await act(async () => button("账号设置").click());
    expect(document.querySelector("#pref-cache")).not.toBeNull();
    await act(async () => {});
    expect(document.body.textContent).toContain("已缓存 42 封");
    await act(async () => button("立即清理").click());
    expect(calls).toContain("trimCache");
    await act(async () => button("测试写信窗口").click());
    expect(calls).toContain("openMailto");
    const select = document.querySelector<HTMLSelectElement>("#pref-cache")!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(select, "500");
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(calls).toContain("setSettings:500");
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".modal-h button")!.click();
    });

    // A mailto: link arrives as a clean draft; the stored draft is only
    // offered, never loaded over it.
    await act(async () =>
      listener!({
        accountId: "",
        key: "new",
        to: "alice@example.com",
        cc: "carol@example.com",
        bcc: "dave@example.com",
        subject: "来自链接的主题",
        body: "正文内容第二行",
        attachments: [],
      }),
    );
    expect(
      document.querySelector<HTMLInputElement>("#compose-subject")?.value,
    ).toBe("来自链接的主题");
    expect(
      document.querySelector<HTMLTextAreaElement>("#compose-body")?.value,
    ).toContain("正文内容第二行");
    expect(document.body.textContent).toContain("alice@example.com");
    expect(document.body.textContent).toContain("carol@example.com");
    expect(document.body.textContent).toContain("dave@example.com");
    expect(document.querySelector(".draft-restore")?.textContent).toContain(
      "旧草稿",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = originalStateOn;
    events.openMail.on = originalTargetOn;
    events.composeMail.on = originalComposeOn;
  }
});
