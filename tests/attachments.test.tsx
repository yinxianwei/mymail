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

/**
 * Attachments are listed with their size and saved through the Go side, which
 * owns the save panel and the bytes. The reader only passes the message id and
 * the part index, and reports what came back: a path, a cancel, or an error.
 */
test("attachments list their size and save through the backend", async () => {
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
    text: "详见附件。",
    html: "",
    cached: true,
    attachments: [
      { name: "季度复盘.pdf", size: 2048, index: 0 },
      { name: "数据.csv", size: 512, index: 1 },
    ],
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
  const calls: string[] = [];
  let outcome: "path" | "cancel" | "error" = "path";
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
    downloadAttachment: async (id: string, index: number) => {
      calls.push(`${id}#${index}`);
      if (outcome === "error")
        throw new Error("附件写入失败，请换一个保存位置");
      if (outcome === "cancel") return "";
      return "/tmp/mymail-test-downloads/季度复盘.pdf";
    },
  });
  events.mailChanged.on = () => () => {};
  events.openMail.on = () => () => {};
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rows = () => Array.from(document.querySelectorAll(".attachment-row"));
  const feedback = () => document.querySelector(".mail-feedback");
  try {
    const { App } = await import("../src/App");
    await act(async () => root.render(<App />));
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".message-row")!.click();
    });

    expect(rows().length).toBe(2);
    expect(rows()[0]!.textContent).toContain("季度复盘.pdf");
    expect(rows()[0]!.textContent).toContain("2 KB");
    expect(rows()[1]!.textContent).toContain("512 B");

    await act(async () =>
      rows()[0]!.querySelector<HTMLButtonElement>(".attachment-save")!.click(),
    );
    expect(calls).toEqual(["first:INBOX:1:1#0"]);
    expect(feedback()?.textContent).toContain(
      "附件已保存到 /tmp/mymail-test-downloads/季度复盘.pdf",
    );

    // Cancelling the save panel is not an error and leaves no banner behind.
    outcome = "cancel";
    await act(async () =>
      rows()[1]!.querySelector<HTMLButtonElement>(".attachment-save")!.click(),
    );
    expect(calls[1]).toBe("first:INBOX:1:1#1");
    expect(feedback()).toBeNull();

    outcome = "error";
    await act(async () =>
      rows()[0]!.querySelector<HTMLButtonElement>(".attachment-save")!.click(),
    );
    expect(feedback()?.className).toContain("error");
    expect(feedback()?.textContent).toContain("附件写入失败");
    expect(
      rows()[0]!.querySelector<HTMLButtonElement>(".attachment-save")
        ?.textContent,
    ).toBe("保存");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    events.mailChanged.on = originalStateOn;
    events.openMail.on = originalTargetOn;
  }
});
