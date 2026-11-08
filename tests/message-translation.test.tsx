import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MailService as api, type TranslationResult } from "../src/mygo";
import { setLanguagePreference } from "../src/lib/i18n";

test("translation retries, hides results and ignores cancelled/old-message responses", async () => {
  const { window } = new JSDOM("<!doctype html><body></body>", {
    url: "https://mail.test",
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    DocumentFragment: window.DocumentFragment,
    HTMLInputElement: window.HTMLInputElement,
    Event: window.Event,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    MutationObserver: window.MutationObserver,
    CustomEvent: window.CustomEvent,
    getComputedStyle: window.getComputedStyle,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { MessageTranslation } = await import("../src/components/message-translation");
  setLanguagePreference("zh-CN");
  const original = { ...api };
  const calls: {
    id: string;
    request: string;
    resolve: (r: TranslationResult) => void;
    reject: (e: Error) => void;
  }[] = [];
  const cancelled: string[] = [];
  Object.assign(api, {
    translateMessage: (id: string, request: string) =>
      new Promise<TranslationResult>((resolve, reject) =>
        calls.push({ id, request, resolve, reject }),
      ),
    cancelTranslation: async (request: string) => {
      cancelled.push(request);
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = async (label: string) =>
    act(async () => {
      [...document.querySelectorAll("button, [role=menuitem]")]
        .find(
          (b) =>
            b.textContent?.trim() === label ||
            b.getAttribute("aria-label") === label,
        )!
        .click();
    });
  try {
    await act(async () =>
      root.render(<MessageTranslation key="a" messageId="a" />),
    );
    expect(document.body.textContent).not.toContain("系统翻译 · 本机处理");
    const openTranslation = async () => {
      await act(async () => {
        const trigger = host.querySelector('[aria-label="更多操作"]')!;
        trigger.dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      await click("翻译为中文");
    };
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await openTranslation();
    expect(calls[0].id).toBe("a");
    expect(document.body.textContent).toContain("正在翻译");
    await click("取消");
    expect(cancelled).toContain(calls[0].request);
    await act(async () =>
      calls[0].resolve({ subject: "旧译文", text: "不应显示" }),
    );
    expect(document.body.textContent).not.toContain("不应显示");
    await click("重试");
    await act(async () =>
      calls[1].reject(new Error("系统翻译需要 macOS 15 或更高版本")),
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "macOS 15",
    );
    await click("重试");
    await act(async () =>
      calls[2].resolve({
        subject: "中文主题",
        text: '<script id="translation-script">不会执行</script>\n译文正文',
      }),
    );
    expect(document.querySelector("pre")?.textContent).toContain("<script");
    expect(document.querySelector("#translation-script")).toBeNull();
    await click("原文");
    expect(document.querySelector("pre")?.textContent).toBe("");
    await click("中文译文");
    expect(document.querySelector("pre")).not.toBeNull();
    expect(calls).toHaveLength(3);
    await act(async () =>
      root.render(<MessageTranslation key="b" messageId="b" />),
    );
    await openTranslation();
    expect(calls[3].id).toBe("b");
    await act(async () =>
      root.render(<MessageTranslation key="c" messageId="c" />),
    );
    expect(cancelled).toContain(calls[3].request);
    await act(async () =>
      calls[3].resolve({ subject: "过期", text: "旧邮件内容" }),
    );
    expect(document.body.textContent).not.toContain("旧邮件内容");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    Object.assign(api, original);
    setLanguagePreference("system");
  }
});
