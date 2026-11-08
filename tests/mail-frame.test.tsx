import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MailFrame } from "../src/components/mail-frame";

function setup() {
  const { window } = new JSDOM("<!doctype html><body></body>", {
    url: "https://mail.test",
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    DOMParser: window.DOMParser,
    IS_REACT_ACT_ENVIRONMENT: true,
    HTMLElement: window.HTMLElement,
    HTMLFormElement: window.HTMLFormElement,
    DocumentFragment: window.DocumentFragment,
    HTMLSelectElement: window.HTMLSelectElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MessageEvent: window.MessageEvent,
  });
  return window;
}

async function renderFrame(window: JSDOM["window"]) {
  const opened: string[] = [];
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MailFrame
        doc="<p>hi</p>"
        title="隔离的邮件正文"
        onOpenLink={(href) => opened.push(href)}
      />,
    ),
  );
  const frame = host.querySelector("iframe")!;
  // What the frame's own link bridge posts after a click.
  const post = async (data: unknown, source: unknown = frame.contentWindow) => {
    await act(async () =>
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data,
          source: source as MessageEventSource,
        }),
      ),
    );
  };
  return { opened, frame, post };
}

test("a click reported by the frame opens the link outside", async () => {
  const window = setup();
  const { opened, frame, post } = await renderFrame(window);
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  await post({ "mail:link": "https://console.example.com/user" });
  expect(opened).toEqual(["https://console.example.com/user"]);
});

test("only messages from this very frame are believed", async () => {
  const window = setup();
  const { opened, post } = await renderFrame(window);
  await post({ "mail:link": "https://evil.test/a" }, window);
  await post({ "mail:link": "https://evil.test/a" }, null);
  expect(opened).toEqual([]);
});

test("addresses that are not plain http(s) are dropped", async () => {
  const window = setup();
  const { opened, post } = await renderFrame(window);
  await post({ "mail:link": "javascript:alert(1)" });
  await post({ "mail:link": "file:///etc/passwd" });
  await post({ other: "https://console.example.com/user" });
  expect(opened).toEqual([]);
});

test("the frame takes the height its document reports", async () => {
  const window = setup();
  const { opened, frame, post } = await renderFrame(window);
  await post({ "mail:height": 1234 });
  expect(frame.style.height).toBe("1234px");
  await post({ "mail:height": 48000 });
  expect(frame.style.height).toBe("48000px");
  expect(frame.getAttribute("scrolling")).toBe("no");
  // A runaway layout must not stretch the reader forever.
  await post({ "mail:height": 9999999 });
  expect(frame.style.height).toBe("1000000px");
  await post({ "mail:height": "nonsense" });
  expect(frame.style.height).toBe("1000000px");
  // A height report is not a link click.
  expect(opened).toEqual([]);
});
