import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  MailService as api,
  events,
  type Account,
  type Draft,
} from "../src/mygo";
import { setLanguagePreference } from "../src/lib/i18n";

test("language switches live, preserves mail/drafts and keeps the old preference on save failure", async () => {
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
  Object.assign(window.HTMLElement.prototype, {
    attachEvent() {},
    detachEvent() {},
  });
  setLanguagePreference("system", "zh-CN");
  const account: Account = {
    id: "a",
    email: "a@example.invalid",
    demo: false,
    imapHost: "localhost",
    imapPort: 993,
    imapTLS: "tls",
    smtpHost: "localhost",
    smtpPort: 465,
    smtpTLS: "tls",
  };
  const draft: Draft = {
    accountId: "a",
    key: "new",
    to: "friend@example.invalid",
    cc: "",
    bcc: "hidden@example.invalid",
    subject: "不要翻译这个主题",
    body: "正文也保持中文",
    attachments: [],
  };
  const original = { ...api },
    offState = events.mailChanged.on,
    offTarget = events.openMail.on;
  let preference = "system",
    fail = false;
  const desktop = {
    unread: 0,
    accountUnread: { a: 0 },
    notifications: true,
    notificationStatus: "",
    checking: false,
    lastError: "",
    revision: 0,
  };
  Object.assign(api, {
    state: async () => ({ accounts: [account], database: "test.db" }),
    desktopState: async () => desktop,
    takeMailTarget: async () => ({ accountId: "", uid: 0, validity: 0 }),
    getLanguage: async () => ({
      preference,
      locale: preference === "en" ? "en" : "zh-CN",
    }),
    setLanguage: async (value: string) => {
      if (fail) throw new Error("save failed");
      preference = value;
      return { preference, locale: value === "en" ? "en" : "zh-CN" };
    },
    folders: async () => [
      { name: "INBOX", role: "inbox", delimiter: "/", selectable: true },
      { name: "我的项目", role: "", delimiter: "/", selectable: true },
    ],
    messages: async () => [],
    allInboxMessages: async () => [],
    getSettings: async () => ({
      syncIntervalSec: 60,
      autoMarkRead: false,
      remoteDefault: "trusted",
      appendSent: false,
      cacheLimit: 2000,
    }),
    cacheStats: async () => ({
      messages: 0,
      headerBytes: 0,
      attachments: 0,
      attachmentBytes: 0,
      sent: 0,
      limit: 2000,
    }),
    pendingCount: async () => 0,
    logPath: async () => "/tmp/log",
    listDrafts: async () => [draft],
    getDraft: async () => draft,
    saveDraft: async () => {},
  });
  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = async (label: string) =>
    act(async () => {
      const b = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
      );
      if (!b) throw new Error("Missing button " + label);
      b.click();
    });
  Object.assign(window.HTMLElement.prototype, { scrollIntoView() {} });
  const language = async (value: string) => {
    await act(async () => {
      document.querySelector("#pref-language")!.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
        }),
      );
    });
    await act(async () => {
      const label = value === "en" ? "English" : "简体中文";
      const option = [
        ...document.querySelectorAll<HTMLElement>('[role="option"]'),
      ].find((n) => n.textContent?.includes(label))!;
      option.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
  };
  try {
    const { App } = await import("../src/App");
    await act(async () => root.render(<App />));
    await click("账号设置");
    await language("en");
    expect(document.documentElement.lang).toBe("en");
    expect(
      document.querySelector("#pref-language")?.getAttribute("disabled"),
    ).toBeNull();
    expect(document.body.textContent).toContain("Check for new mail");
    expect(document.body.textContent).toContain("Inbox");
    expect(document.body.textContent).toContain("我的项目");
    expect(document.querySelector(".settings-modal .modal-f")).toBeNull();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(".settings-modal .modal-h button")!
        .click(),
    );
    await click("Local drafts");
    expect(document.querySelector(".draft-list-item")?.textContent).toContain(
      draft.subject,
    );
    await click("Continue editing");
    const subject = () =>
      document.querySelector<HTMLInputElement>("#compose-subject")!.value;
    const body = () =>
      document.querySelector<HTMLTextAreaElement>("#compose-body")!.value;
    expect(subject()).toBe(draft.subject);
    expect(body()).toBe(draft.body);
    await act(async () => setLanguagePreference("zh-CN"));
    expect(document.body.textContent).toContain("保存并关闭");
    expect(subject()).toBe(draft.subject);
    expect(body()).toBe(draft.body);
    expect(
      document.querySelector("#compose-bcc")?.parentElement?.textContent,
    ).toContain(draft.bcc!);
    await act(async () => setLanguagePreference("en"));
    await click("Save and close");
    await click("Account settings");
    fail = true;
    await language("zh-CN");
    expect(document.documentElement.lang).toBe("en");
    expect(document.querySelector("#pref-language")!.textContent).toBe(
      "English",
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save the language setting",
    );
    expect(localStorage.getItem("mail:language")).toBe("en");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = offState;
    events.openMail.on = offTarget;
    setLanguagePreference("system");
  }
});
