import { beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
let documentForMail: typeof import("../src/mail-html").mailDocument;
let httpLink: typeof import("../src/lib/links").safeHttpLink;
beforeAll(async () => {
  const { window } = new JSDOM();
  Object.assign(globalThis, {
    window,
    document: window.document,
    DOMParser: window.DOMParser,
  });
  const module = await import("../src/mail-html");
  documentForMail = module.mailDocument;
  httpLink = (await import("../src/lib/links")).safeHttpLink;
});
test("email scripts, remote resources and executable attributes are removed", () => {
  const html = documentForMail(
    `<script>alert(1)</script><img src="https://tracker.invalid/pixel"><style>@import 'https://tracker.invalid/style';</style><p onclick="alert(1)" style="background:url(https://tracker.invalid/a)">安全正文</p><iframe src="https://tracker.invalid/frame"></iframe>`,
    { dark: false },
  );
  expect(html).toContain("安全正文");
  expect(html).not.toContain("tracker.invalid");
  expect(html).not.toContain("onclick");
  // The one script in the document is the link bridge the page injects.
  expect(html.match(/<script/gi)?.length).toBe(1);
  expect(html).toContain("mail:link");
  expect(html).not.toContain("alert(1)");
  expect(html).not.toContain("<iframe");
  expect(html).toContain("default-src 'none'");
});
test("trusted senders keep remote images while scripts stay blocked", () => {
  const html = documentForMail(
    `<p>hi</p><img src="https://cdn.example.com/pic.png" onerror="alert(1)"><script>alert(1)</script>`,
    { dark: false, remote: true },
  );
  expect(html).toContain("cdn.example.com/pic.png");
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("alert(1)");
  expect(html).toContain("img-src https: http: data:");
});
test("the link bridge runs under the document's own nonce", () => {
  const html = documentForMail(`<p><a href="https://example.com/a">a</a></p>`, {
    dark: false,
  });
  const nonce = html.match(/script-src 'nonce-([a-z0-9]+)'/)?.[1] || "";
  expect(nonce).not.toBe("");
  expect(html).toContain(`<script nonce="${nonce}">`);
  expect(html).toContain('data-mail-href="https://example.com/a"');
  expect(html).toContain("mail:height");
  // The real address only ever lives in data-mail-href; the placeholder keeps
  // `a`, `a[href]` and `a:link` styles from the message matching.
  expect(html).toContain('<a href="#"');
  expect(html).not.toContain(' href="https://example.com/a"');
});
test("the frame never scrolls on its own", () => {
  const html = documentForMail(
    `<table width="800"><tr><td>wide</td></tr></table>`,
    { dark: false },
  );
  // A body margin would sit outside the measured box, and a fixed 800px mail
  // would otherwise grow a horizontal scrollbar inside the frame.
  expect(html).toContain("body{margin:0;padding:28px");
  expect(html).toContain("overflow-x:hidden");
  expect(html).toContain("document.body.style.zoom");
});
test("addresses that are not plain http(s) never become clickable", () => {
  const html = documentForMail(
    `<a href="javascript:alert(1)">bad</a><a href="https://u:secret@example.com">cred</a><a href="file:///etc/passwd">file</a>`,
    { dark: false },
  );
  // The bridge script names the selector, so match the attribute itself.
  expect(html).not.toContain("data-mail-href=");
});
test("styled mail keeps its own table and link styling", () => {
  const rich = documentForMail(
    `<table><tr><td>a</td></tr></table><p><a href="https://example.com">x</a></p>`,
    { dark: false, rich: true },
  );
  expect(rich).not.toContain("border:1px solid GrayText");
  expect(rich).not.toContain("a{text-decoration:underline}");
  const plain = documentForMail(`<table><tr><td>a</td></tr></table>`, {
    dark: false,
  });
  expect(plain).toContain("border:1px solid GrayText");
});
test("a read-only quote carries no script at all", () => {
  const html = documentForMail(`<p><a href="https://example.com/a">a</a></p>`, {
    dark: false,
    compact: true,
    linkable: false,
  });
  expect(html).not.toContain("<script");
  expect(html).not.toContain("script-src");
});
test("untrusted senders never get their own styles", () => {
  const html = documentForMail(
    `<style>p{color:red}</style><p style="color:red" class="brand">hi</p>`,
    { dark: false },
  );
  expect(html).not.toContain("color:red");
  expect(html).not.toContain("class=");
});
test("trusted senders keep the message's own styles", () => {
  const html = documentForMail(
    `<style>p{color:red}</style><p style="color:red" class="brand">hi</p>`,
    { dark: false, rich: true },
  );
  expect(html).toContain("<style>p{color:red}</style>");
  expect(html).toContain('style="color:red"');
  expect(html).toContain('class="brand"');
});
test("rich styles drop layout escapes and remote stylesheet imports", () => {
  const html = documentForMail(
    `<style>@import url(https://tracker.invalid/a.css); .x{behavior:url(a.htc);expression(alert(1))} p{color:teal}</style><p style="position:fixed;top:0;z-index:9;color:teal">hi</p>`,
    { dark: false, rich: true },
  );
  expect(html).toContain("p{color:teal}");
  expect(html).toContain("color:teal");
  expect(html).not.toContain("@import");
  expect(html).not.toContain("position:fixed");
  expect(html).not.toContain("z-index");
  expect(html).not.toContain("tracker.invalid");
});
test("rich styles still wait for trust before loading images", () => {
  const html = documentForMail(
    `<img src="https://cdn.example.com/pic.png"><p>hi</p>`,
    { dark: false, rich: true },
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("img-src");
});
test("only plain http(s) addresses reach the system browser", () => {
  expect(httpLink("https://example.com/a?b=1")).toBe(
    "https://example.com/a?b=1",
  );
  expect(httpLink("javascript:alert(1)")).toBe("");
  expect(httpLink("file:///etc/passwd")).toBe("");
  expect(httpLink("https://u:secret@example.com")).toBe("");
  expect(httpLink("/relative")).toBe("");
});

test("the trusted bridge expands sender scroll panels and measures body rather than iframe viewport", async () => {
  const html = documentForMail(
    `<style>body{height:300px;overflow:auto!important}.panel{height:80px;max-height:80px;overflow-y:auto}</style><div class="panel"><p>first</p><p>last</p></div>`,
    { dark: true, rich: true },
  );
  const reports: number[] = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.postMessage = (data: { "mail:height"?: number }) => {
        if (data["mail:height"]) reports.push(data["mail:height"]);
      };
      Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
        get() {
          return this.tagName === "BODY" ? 48000 : 1;
        },
      });
    },
  });
  await new Promise((resolve) =>
    dom.window.addEventListener("load", resolve, { once: true }),
  );
  const panel = dom.window.document.querySelector<HTMLElement>(".panel")!;
  expect(panel.style.height).toBe("auto");
  expect(panel.style.maxHeight).toBe("none");
  expect(panel.style.overflowY).toBe("visible");
  expect(reports).toContain(48000);
  expect(dom.window.getComputedStyle(dom.window.document.body).overflow).toBe(
    "hidden",
  );
  expect(dom.window.document.querySelectorAll("script")).toHaveLength(1);
  dom.window.close();
});
