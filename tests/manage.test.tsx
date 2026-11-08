import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  MailService as api,
  events,
  type Account,
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
  seen: false,
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
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });
  return window;
}

test("P0 管理操作、设置与写信新字段都可用", async () => {
  bootstrap();
  const original = { ...api },
    originalStateOn = events.mailChanged.on,
    originalTargetOn = events.openMail.on;
  const state = {
    unread: 1,
    accountUnread: { first: 1 },
    notifications: true,
    notificationStatus: "",
    checking: false,
    lastError: "",
    revision: 1,
  };
  let prefs: Settings = {
    syncIntervalSec: 60,
    autoMarkRead: false,
    remoteDefault: "trusted",
    appendSent: false,
    cacheLimit: 2000,
  };
  const calls: string[] = [];
  let readCount = 0;
  // The backend flips the cached flag before returning; mirror that so the
  // reader's toolbar is tested against a real state change.
  let rows: Message[] = [{ ...message }];
  Object.assign(api, {
    state: async () => ({ accounts: [account], database: "test.db" }),
    desktopState: async () => state,
    takeMailTarget: async () => ({ accountId: "", uid: 0, validity: 0 }),
    folders: async () => [
      { name: "INBOX", delimiter: "/", role: "inbox", selectable: true },
      { name: "Archive", delimiter: "/", role: "archive", selectable: true },
    ],
    foldersForMove: async () => [
      { name: "Archive", delimiter: "/", role: "archive", selectable: true },
    ],
    messages: async () => rows,
    allInboxMessages: async () => rows,
    checkMail: async () => state,
    readMessage: async () => {
      readCount++;
      return rows[0];
    },
    markRead: async () => {
      calls.push("markRead");
    },
    getSettings: async () => prefs,
    setSettings: async (v: Settings) => {
      calls.push("setSettings:" + v.syncIntervalSec);
      prefs = v;
      return v;
    },
    pendingCount: async () => 0,
    setSeen: async (id: string, seen: boolean) => {
      calls.push(`setSeen:${id}:${seen}`);
      rows = rows.map((r) => (r.id === id ? { ...r, seen } : r));
      return "已在本机生效";
    },
    setFlagged: async (id: string, flagged: boolean) => {
      calls.push(`setFlagged:${id}:${flagged}`);
      rows = rows.map((r) => (r.id === id ? { ...r, flagged } : r));
      return "已在本机生效";
    },
    deleteMessage: async (id: string, permanent: boolean) => {
      calls.push(`delete:${id}:${permanent}`);
      return "已在本机生效";
    },
    moveMessage: async (id: string, folder: string) => {
      calls.push(`move:${id}:${folder}`);
      return "已在本机生效";
    },
    pickAttachments: async () => [],
    cacheStats: async () => ({
      messages: 1,
      headerBytes: 128,
      attachments: 0,
      attachmentBytes: 0,
      sent: 0,
      limit: 2000,
    }),
    trimCache: async () => ({
      messages: 1,
      headerBytes: 128,
      attachments: 0,
      attachmentBytes: 0,
      sent: 0,
      limit: 2000,
    }),
    openMailto: async () => {},
    getDraft: async (id: string, key: string): Promise<Draft> => ({
      accountId: id,
      key,
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "",
      attachments: [],
    }),
    saveDraft: async () => {},
    send: async () => "邮件已发送",
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
  const labelled = (label: string) =>
    document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  try {
    const { App } = await import("../src/App");
    await act(async () => root.render(<App />));
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".message-row")!.click();
    });
    expect(readCount).toBe(1);
    expect(
      host.querySelector(".message-row")?.getAttribute("aria-current"),
    ).toBe("true");
    // autoMarkRead=false must leave the server flag alone.
    expect(calls).not.toContain("markRead");
    expect(labelled("加星标")).not.toBeNull();
    expect(labelled("标记为已读")).not.toBeNull();
    expect(labelled("移动到文件夹")).not.toBeNull();
    expect(labelled("删除邮件")).not.toBeNull();

    await act(async () => labelled("加星标").click());
    expect(calls).toContain(`setFlagged:${message.id}:true`);
    // The reader holds its own copy of the message: the star in the detail
    // toolbar and the list row must both flip immediately.
    expect(labelled("取消星标")).not.toBeNull();
    expect(
      document
        .querySelector('[aria-label="取消星标"] svg')
        ?.getAttribute("fill"),
    ).toBe("currentColor");
    expect(document.querySelector(".reader-action.flagged")).not.toBeNull();
    expect(host.querySelector(".row-star")).not.toBeNull();
    expect(labelled("取消星标").getAttribute("aria-pressed")).toBe("true");

    await act(async () => labelled("标记为已读").click());
    expect(calls).toContain(`setSeen:${message.id}:true`);

    // Move and delete go through their own confirmation / picker UI.
    await act(async () => labelled("移动到文件夹").click());
    expect(document.querySelector(".folder-picker")).not.toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>(".folder-picker-item")!.click();
    });
    expect(calls).not.toContain(`move:${message.id}:Archive`);
    expect(
      document.querySelector('[role="radio"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () => button("移动").click());
    expect(calls).toContain(`move:${message.id}:Archive`);
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".message-row")!.click();
    });
    await act(async () => labelled("删除邮件").click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    // Destructive actions use the danger variant, not the blue primary one.
    expect(
      document.querySelector(
        '[role="alertdialog"] button[data-variant="danger"]',
      ),
    ).not.toBeNull();
    await act(async () => button("删除").click());
    expect(calls).toContain(`delete:${message.id}:false`);

    // Preferences: all four knobs are present and persist through IPC.
    await act(async () => button("账号设置").click());
    expect(document.querySelector("#pref-interval")).not.toBeNull();
    expect(document.querySelector("#pref-remote")).not.toBeNull();
    const interval =
      document.querySelector<HTMLSelectElement>("#pref-interval")!;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(interval, "15");
      interval.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(calls).toContain("setSettings:15");

    // Compose gained Bcc and a native attachment picker.
    await act(async () => {
      button("完成").click();
    });
    await act(async () => button("写邮件").click());
    expect(document.querySelector("#compose-bcc")).not.toBeNull();
    expect(button("添加附件")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = originalStateOn;
    events.openMail.on = originalTargetOn;
  }
});
