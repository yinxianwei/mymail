import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MailService as api, type Account, type Draft } from "../src/mygo";
import { DraftManager } from "../src/components/draft-manager";

test("draft management keeps account slots separate, retries reads/deletes and confirms deletion", async () => {
  const { window } = new JSDOM("<!doctype html><body></body>", {
    url: "https://mail.test",
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
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
  const a: Account = {
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
  const accounts = [a, { ...a, id: "b", email: "b@example.invalid" }];
  const draft: Draft = {
    accountId: "a",
    key: "new",
    to: "",
    cc: "",
    bcc: "hidden@example.invalid",
    subject: "第一份",
    body: "未完成的内容",
    attachments: [{ name: "notes.txt", path: "/tmp/notes.txt", size: 1 }],
  };
  const second = { ...draft, accountId: "b", subject: "第二份" };
  const original = { ...api };
  let readFails = true,
    deleteFails = true;
  const deleted: string[] = [];
  const resumed: { draft: Draft; account: Account }[] = [];
  Object.assign(api, {
    listDrafts: async (id: string) => {
      if (id === "b" && readFails) throw new Error("read failed");
      return id === "b"
        ? [second]
        : [
            draft,
            {
              ...draft,
              key: "empty",
              to: "",
              bcc: "",
              subject: "",
              body: "",
              attachments: [],
            },
          ];
    },
    clearDraft: async (id: string, key: string) => {
      deleted.push(`${id}:${key}`);
      if (deleteFails) throw new Error("delete failed");
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const clickText = async (label: string) =>
    act(async () => {
      const b = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
      );
      if (!b) throw new Error("Missing button " + label);
      b.click();
    });
  const deleteFirst = async () =>
    act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="删除草稿：第一份"]')!
        .click(),
    );
  try {
    await act(async () =>
      root.render(
        <DraftManager
          accounts={accounts}
          onClose={() => {}}
          onResume={(draft, account) => resumed.push({ draft, account })}
        />,
      ),
    );
    expect(document.querySelectorAll(".draft-list-item")).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      accounts[1].email,
    );
    readFails = false;
    await clickText("重试读取");
    expect(document.querySelectorAll(".draft-list-item")).toHaveLength(2);
    await clickText("继续编辑");
    expect(resumed[0]).toEqual({ draft, account: a });
    await deleteFirst();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(deleted).toEqual([]);
    await clickText("取消");
    expect(deleted).toEqual([]);
    await deleteFirst();
    await clickText("删除草稿");
    expect(
      document.querySelector('[role="alertdialog"] [role="alert"]')
        ?.textContent,
    ).toContain("草稿已保留");
    expect(document.querySelectorAll(".draft-list-item")).toHaveLength(2);
    deleteFails = false;
    await clickText("删除草稿");
    expect(deleted).toEqual(["a:new", "a:new"]);
    expect(document.querySelectorAll(".draft-list-item")).toHaveLength(1);
    expect(document.querySelector(".draft-list-item")?.textContent).toContain(
      "第二份",
    );
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
  }
});
