import { afterAll, beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  MailService as api,
  events,
  type Account,
  type HistoryPage,
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

const viewport = 500;
let window: JSDOM["window"];

beforeAll(() => {
  ({ window } = new JSDOM("<!doctype html><body></body>", {
    url: "https://mail.test",
    pretendToBeVisual: true,
  }));
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
  // jsdom has no layout. Report a viewport-sized scroller whose height is the
  // virtual spacer (one fixed-height row per cached message) plus the footer,
  // just like the real DOM would.
  Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this.classList?.contains("message-scroll") ? viewport : 0;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      if (!this.classList?.contains("message-scroll")) return 0;
      const spacer = this.querySelector<HTMLElement>(".message-virtual");
      return (spacer ? parseFloat(spacer.style.height) || 0 : 0) + 60;
    },
  });
});

afterAll(() => {
  delete (window.HTMLElement.prototype as Record<string, unknown>).clientHeight;
  delete (window.HTMLElement.prototype as Record<string, unknown>).scrollHeight;
});

function rows(from: number, to: number): Message[] {
  const result: Message[] = [];
  for (let uid = to; uid >= from; uid--) {
    result.push({
      id: `first:INBOX:1:${uid}`,
      accountId: account.id,
      folder: "INBOX",
      uid,
      validity: 1,
      subject: "邮件" + uid,
      from: "sender@example.invalid",
      to: account.email,
      date: new Date(2026, 0, 1, 0, uid).toISOString(),
      seen: true,
      text: "",
      html: "",
      cached: false,
      attachments: [],
    });
  }
  return result;
}

const spacerHeight = (host: HTMLElement) =>
  parseFloat(host.querySelector<HTMLElement>(".message-virtual")!.style.height);
const mountedRows = (host: HTMLElement) =>
  host.querySelectorAll(".message-row").length;

async function mount(first: Message[]) {
  const original = { ...api },
    originalStateOn = events.mailChanged.on,
    originalTargetOn = events.openMail.on;
  const requests: Array<[number, number]> = [];
  const state = {
    unread: 0,
    accountUnread: {},
    notifications: false,
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
    state: async () => ({ accounts: [account], database: "test.db" }),
    desktopState: async () => state,
    takeMailTarget: async () => ({ accountId: "", uid: 0, validity: 0 }),
    folders: async () => [
      { name: "INBOX", delimiter: "/", role: "inbox", selectable: true },
    ],
    messages: async () => first,
    allInboxMessages: async () => first,
    loadOlder: async (
      _id: string,
      _folder: string,
      beforeUID: number,
      validity: number,
    ): Promise<HistoryPage> => {
      requests.push([beforeUID, validity]);
      const older = rows(Math.max(1, beforeUID - 50), beforeUID - 1);
      return {
        messages: older,
        hasMore: beforeUID - 50 > 1,
        nextUID: older[older.length - 1]?.uid ?? 0,
        validity,
      };
    },
  });
  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const { App } = await import("../src/App");
  await act(async () => root.render(<App />));
  return {
    host,
    requests,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
      Object.assign(api, original);
      events.mailChanged.on = originalStateOn;
      events.openMail.on = originalTargetOn;
    },
  };
}

test("reaching the end loads older pages until history is exhausted", async () => {
  const { host, requests, cleanup } = await mount(rows(101, 150));
  try {
    // Only the rows around the viewport are mounted; the spacer carries the
    // full height so the scroller and infinite loading still behave normally.
    expect(spacerHeight(host)).toBe(50 * 72);
    expect(mountedRows(host)).toBeLessThan(40);
    const scroll = host.querySelector<HTMLDivElement>(".message-scroll")!;

    scroll.scrollTop = scroll.scrollHeight - viewport;
    await act(async () => {
      scroll.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    });
    expect(requests).toEqual([[101, 1]]);
    expect(spacerHeight(host)).toBe(100 * 72);
    expect(mountedRows(host)).toBeLessThan(40);

    scroll.scrollTop = scroll.scrollHeight - viewport;
    await act(async () => {
      scroll.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    });
    expect(requests).toEqual([
      [101, 1],
      [51, 1],
    ]);
    expect(spacerHeight(host)).toBe(150 * 72);
    expect(mountedRows(host)).toBeLessThan(40);
    expect(host.querySelector(".message-virtual")).not.toBeNull();
    expect(host.querySelector(".history-footer")?.textContent).toContain(
      "已加载全部邮件",
    );
  } finally {
    await cleanup();
  }
});

test("a short list fills itself without requiring a scroll", async () => {
  const { host, requests, cleanup } = await mount(rows(149, 150));
  try {
    await act(async () => {});
    expect(requests).toEqual([
      [149, 1],
      [99, 1],
    ]);
    expect(spacerHeight(host)).toBe(100 * 72);
    expect(mountedRows(host)).toBeLessThan(40);
  } finally {
    await cleanup();
  }
});

test("the mounted window follows the scroll position", async () => {
  const { host, cleanup } = await mount(rows(101, 150));
  try {
    const scroll = host.querySelector<HTMLDivElement>(".message-scroll")!;
    const subjects = () =>
      Array.from(host.querySelectorAll(".message-subject"), (n) =>
        String(n.textContent),
      );
    expect(subjects()).toContain("邮件150");
    scroll.scrollTop = 1000;
    await act(async () => {
      scroll.dispatchEvent(new window.Event("scroll", { bubbles: true }));
    });
    expect(subjects()).not.toContain("邮件150");
    expect(subjects()).toContain("邮件140");
    expect(mountedRows(host)).toBeLessThan(40);
  } finally {
    await cleanup();
  }
});
