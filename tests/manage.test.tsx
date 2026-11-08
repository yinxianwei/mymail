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
  const savedDraft: Draft = {
    accountId: account.id,
    key: "reply:saved",
    to: "friend@example.invalid",
    cc: "",
    bcc: "copy@example.invalid",
    subject: "保存的回复",
    body: "下次继续编辑",
    attachments: [],
  };
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
    listDrafts: async () => [savedDraft],
    getDraft: async (id: string, key: string): Promise<Draft> =>
      key === savedDraft.key
        ? savedDraft
        : {
            accountId: id,
            key,
            to: "",
            cc: "",
            bcc: "",
            subject: "",
            body: "",
            attachments: [],
          },
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

    const readerDoc = document.querySelector<HTMLIFrameElement>(
      'iframe[title="隔离的邮件正文"]',
    )?.srcdoc;
    // Preferences: all four knobs are present and persist through IPC.
    await act(async () => button("账号设置").click());
    expect(
      document.querySelector<HTMLIFrameElement>(
        'iframe[title="隔离的邮件正文"]',
      )?.srcdoc,
    ).toBe(readerDoc);
    const tab = async (label: string) =>
      act(async () => {
        const trigger = [
          ...document.querySelectorAll<HTMLElement>('[role="tab"]'),
        ].find((n) => n.textContent?.trim() === label)!;
        trigger.dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
    const panel = () =>
      document.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')!;
    expect(panel().textContent).toContain("语言");
    expect(panel().querySelector("#pref-interval")).toBeNull();
    await act(async () => {
      const current = document.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
      )!;
      current.focus();
      current.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toContain("邮箱账号");
    expect(
      panel().querySelector<HTMLFormElement>("#add-mail-account")!.hidden,
    ).toBe(true);
    await act(async () => button("添加邮箱").click());
    const email = document.querySelector<HTMLInputElement>("#email")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(email, "unsaved@example.invalid");
      email.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await tab("邮件");
    expect(panel().querySelector("#pref-interval")).not.toBeNull();
    await tab("邮箱账号");
    expect(document.querySelector<HTMLInputElement>("#email")!.value).toBe(
      "unsaved@example.invalid",
    );
    expect(
      panel().querySelector<HTMLFormElement>("#add-mail-account")!.hidden,
    ).toBe(false);
    await tab("邮件");
    expect(document.querySelector("#pref-interval")).not.toBeNull();
    expect(document.querySelector("#pref-remote")).not.toBeNull();
    Object.assign(window.HTMLElement.prototype, { scrollIntoView() {} });
    await act(async () => {
      document.querySelector("#pref-interval")!.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
        }),
      );
    });
    await act(async () => {
      const option = [
        ...document.querySelectorAll<HTMLElement>('[role="option"]'),
      ].find((n) => n.textContent?.includes("15 秒"))!;
      option.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(calls).toContain("setSettings:15");
    const checkbox = (label: string) =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[data-slot="checkbox"]',
        ),
      ].find((n) => n.closest("label")?.textContent?.includes(label))!;
    await act(async () => checkbox("打开邮件后自动标记为已读").click());
    expect(prefs.autoMarkRead).toBe(true);
    expect(
      checkbox("打开邮件后自动标记为已读").getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () => checkbox("发送后把副本").click());
    expect(prefs.appendSent).toBe(true);
    await act(async () => checkbox("打开邮件后自动标记为已读").click());
    expect(prefs.autoMarkRead).toBe(false);

    // Compose gained Bcc and a native attachment picker.
    await act(async () => {
      expect(document.querySelector(".settings-modal .modal-f")).toBeNull();
      document
        .querySelector<HTMLButtonElement>(".settings-modal .modal-h button")!
        .click();
    });
    await act(async () => button("写邮件").click());
    expect(document.querySelector("#compose-bcc")).not.toBeNull();
    expect(button("添加附件")).not.toBeNull();
    await act(async () => button("保存并关闭").click());
    // Local drafts have an explicit entry, with the original slot and Bcc restored.
    await act(async () => button("本地草稿").click());
    expect(document.querySelector(".draft-list-item")?.textContent).toContain(
      savedDraft.subject,
    );
    await act(async () => button("继续编辑").click());
    expect(
      document.querySelector<HTMLInputElement>("#compose-subject")!.value,
    ).toBe(savedDraft.subject);
    expect(
      document.querySelector<HTMLTextAreaElement>("#compose-body")!.value,
    ).toBe(savedDraft.body);
    expect(
      document.querySelector("#compose-bcc")?.parentElement?.textContent,
    ).toContain("copy@example.invalid");
    await act(async () => button("保存并关闭").click());
    await act(async () => button("未读").click());
    expect(document.querySelectorAll(".message-row")).toHaveLength(0);
    expect(button("未读").getAttribute("aria-checked")).toBe("true");
    await act(async () => button("星标").click());
    expect(document.querySelectorAll(".message-row")).toHaveLength(1);
    await act(async () => button("全部").click());
    expect(document.querySelectorAll(".message-row")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = originalStateOn;
    events.openMail.on = originalTargetOn;
  }
});
