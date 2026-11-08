import DOMPurify from "dompurify";
import { safeHttpLink } from "./lib/links";

export interface MailRenderOptions {
  dark: boolean;
  /** Keep `<img>` and let the frame fetch http(s) resources at all. */
  remote?: boolean;
  /**
   * Keep the sender's own presentation: `<style>` blocks, `style` attributes,
   * classes and the legacy layout attributes of HTML mail. Only for senders
   * the app already trusts — untrusted mail keeps the uniform, brand-free
   * rendering that makes a spoofed layout obvious.
   */
  rich?: boolean;
  /** Tighter typography for the quoted original shown in the composer. */
  compact?: boolean;
  /**
   * Let the frame report clicks on links, so the page can open them in the
   * desktop browser. Off for quotes, which stay read-only.
   */
  linkable?: boolean;
}

/**
 * The message frame is sandboxed without `allow-same-origin`: it runs in an
 * opaque origin and cannot read the app's DOM, storage or cookies. Only this
 * script runs in it (the document's CSP allows just this nonce), and all it
 * does is hand a clicked address back to the page. WebKit does not deliver
 * clicks in a sandboxed frame to listeners the page adds, so the frame has to
 * report them itself.
 */
const linkBridge = (nonce: string) => `<script nonce="${nonce}">
(function () {
  function report(element) {
    var anchor = element && element.closest ? element.closest("[data-mail-href]") : null;
    if (!anchor) return false;
    parent.postMessage({ "mail:link": anchor.getAttribute("data-mail-href") }, "*");
    return true;
  }
  document.addEventListener("click", function (event) {
    if (report(event.target)) event.preventDefault();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && report(event.target)) event.preventDefault();
  });
  // The frame cannot grow to its content on its own: the page sizes it, so the
  // whole reader scrolls as one instead of nesting a scrollbar in here.
  var last = 0;
  function measure() {
    var root = document.documentElement;
    var height = Math.ceil(
      Math.max(root.scrollHeight, document.body.getBoundingClientRect().height)
    );
    if (!height || Math.abs(height - last) < 2) return;
    last = height;
    parent.postMessage({ "mail:height": height }, "*");
  }
  // Mail layouts are often a fixed 800px wide. Rather than let the frame grow a
  // horizontal scrollbar, shrink the body just enough to fit.
  function fit() {
    var root = document.documentElement;
    document.body.style.zoom = "";
    var want = Math.max(root.scrollWidth, document.body.scrollWidth);
    var have = root.clientWidth;
    if (have > 0 && want > have + 1) {
      var scale = have / want;
      if (scale > 0.5) document.body.style.zoom = String(Math.round(scale * 1000) / 1000);
    }
    measure();
  }
  window.addEventListener("load", fit);
  window.addEventListener("resize", fit);
  if (window.ResizeObserver) new ResizeObserver(measure).observe(document.body);
  fit();
})();
</script>`;

const nonceOf = () =>
  globalThis.crypto?.randomUUID?.().replaceAll("-", "") ??
  Math.random().toString(36).slice(2);

const baseTags = [
  "p",
  "br",
  "div",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "hr",
  "a",
];

// Extra elements real newsletters and provider templates use.
const richTags = [
  "section",
  "article",
  "header",
  "footer",
  "figure",
  "figcaption",
  "caption",
  "tfoot",
  "colgroup",
  "col",
  "dl",
  "dt",
  "dd",
  "small",
  "sub",
  "sup",
  "mark",
  "abbr",
  "address",
  "center",
  "font",
  "tt",
  "big",
];

// Legacy presentational attributes are what make table layouts from mail
// providers look right; `class` and `id` are what their <style> selectors use.
const richAttrs = [
  "class",
  "id",
  "style",
  "align",
  "valign",
  "width",
  "height",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "color",
  "face",
  "size",
  "dir",
  "lang",
  "title",
];

// Inline CSS allowed for trusted senders. Layout escapes (`position`,
// `z-index`) and generated content are dropped: they can only fake chrome
// inside the frame, never help the mail read better.
const cssProperties = new Set([
  "background",
  "background-color",
  "background-image",
  "background-position",
  "background-repeat",
  "background-size",
  "border",
  "border-bottom",
  "border-bottom-color",
  "border-bottom-style",
  "border-bottom-width",
  "border-collapse",
  "border-color",
  "border-left",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-radius",
  "border-right",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-spacing",
  "border-style",
  "border-top",
  "border-top-color",
  "border-top-style",
  "border-top-width",
  "border-width",
  "clear",
  "color",
  "direction",
  "display",
  "float",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "height",
  "letter-spacing",
  "line-height",
  "list-style",
  "list-style-position",
  "list-style-type",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "overflow",
  "overflow-wrap",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "table-layout",
  "text-align",
  "text-decoration",
  "text-indent",
  "text-transform",
  "vertical-align",
  "white-space",
  "width",
  "word-break",
  "word-spacing",
  "word-wrap",
]);

/** Drops the constructs that make CSS a script or a remote fetch channel. */
function sanitizeCss(css: string) {
  return css
    .replace(/<\/style/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/behavior\s*:[^;]+;?/gi, "")
    .replace(/-moz-binding\s*:[^;]+;?/gi, "")
    .replace(/javascript\s*:/gi, "")
    .trim();
}

/** CSS the message carries in `<style>` blocks, ready to inject. */
function messageCss(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return sanitizeCss(
    Array.from(doc.querySelectorAll("style"))
      .map((el) => el.textContent || "")
      .join("\n"),
  );
}

/**
 * Splits an inline `style` attribute on the semicolons that separate
 * declarations — not on the ones inside `url(data:…;base64,…)`.
 */
function splitDeclarations(value: string) {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

/**
 * Keeps the allowed declarations of an inline `style` attribute. Parsed as
 * text rather than through `element.style`, whose support differs between
 * engines and would silently drop properties a browser would honour.
 */
function filterInlineStyle(value: string) {
  const kept: string[] = [];
  for (const declaration of splitDeclarations(value || "")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const content = declaration.slice(separator + 1).trim();
    if (!property || !content) continue;
    const name = property.replace(/^-[a-z]+-/, "");
    if (!cssProperties.has(name)) continue;
    if (/expression\s*\(|javascript\s*:/i.test(content)) continue;
    kept.push(`${property}:${content}`);
  }
  return kept.join(";");
}

/**
 * A frame that can navigate is a frame that can lose the message, so the real
 * address never survives into it. An anchor keeps a placeholder `href` — mail
 * stylesheets commonly key off `a`, `a[href]` or `a:link`, and dropping the
 * attribute silently restores the browser's default blue underline — while the
 * address it opens lives in `data-mail-href`, which the page turns into a
 * system-browser call. The placeholder only ever jumps to the frame itself.
 * Addresses that are not plain http(s) lose their link altogether.
 */
function detachLinks(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = safeHttpLink(anchor.getAttribute("href") || "");
    if (!href) {
      anchor.removeAttribute("href");
      continue;
    }
    anchor.setAttribute("href", "#");
    anchor.setAttribute("data-mail-href", href);
    anchor.setAttribute("role", "link");
    anchor.setAttribute("tabindex", "0");
  }
  return doc.body.innerHTML;
}

/**
 * The body of a message as a standalone document for a scriptless sandboxed
 * frame. Scripts, forms and navigation never survive. Remote images need a
 * trusted sender; the sender's own CSS needs one too (`rich`), and even then
 * only presentational rules and inline declarations are kept.
 */
export function mailDocument(html: string, options: MailRenderOptions) {
  const {
    dark,
    remote = false,
    rich = false,
    compact = false,
    linkable = true,
  } = options;
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      ...baseTags,
      ...(rich ? richTags : []),
      ...(remote ? ["img"] : []),
    ],
    ALLOWED_ATTR: [
      "colspan",
      "rowspan",
      "href",
      ...(rich ? richAttrs : []),
      ...(remote ? ["src", "alt", "width", "height"] : []),
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  let body = clean;
  let css = "";
  if (rich) {
    if (/style=/i.test(clean)) {
      const doc = new DOMParser().parseFromString(clean, "text/html");
      for (const el of Array.from(doc.querySelectorAll("[style]"))) {
        const kept = filterInlineStyle(el.getAttribute("style") || "");
        if (kept) el.setAttribute("style", kept);
        else el.removeAttribute("style");
      }
      body = doc.body.innerHTML;
    }
    css = messageCss(html);
  }
  body = detachLinks(body);
  const imagePolicy = remote ? " img-src https: http: data:;" : "";
  const nonce = linkable ? nonceOf() : "";
  const scriptPolicy = nonce ? ` script-src 'nonce-${nonce}';` : "";
  // Padding rather than margin: the frame is sized to the body box, and a body
  // margin would sit outside it and force a second scrollbar inside the frame.
  const frame = compact
    ? "margin:0;padding:14px 16px;font:13.5px/1.7 system-ui,sans-serif;"
    : "margin:0;padding:28px;font:15px/1.75 system-ui,sans-serif;";
  const quote = compact ? "padding-left:12px" : "padding-left:16px";
  // What every message needs, styled or not. The frame is sized by the page,
  // so nothing may make it scroll on its own: no body margin, and no content
  // wider than the frame (mail table layouts are often a fixed 800px).
  const shared = `html{color-scheme:${dark ? "dark" : "light"};max-width:100%;overflow-x:hidden}body{${frame}overflow-wrap:anywhere;max-width:100%;overflow-x:hidden}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}[data-mail-href]{cursor:pointer}`;
  // Fallbacks that only apply when the sender's own CSS is thrown away: cell
  // borders, padded tables, indented quotes and underlined links are what make
  // an unstyled message readable, and exactly what fights a designed one.
  const plain = `h1,h2,h3{line-height:1.4;${compact ? "font-size:15px;" : ""}}table{max-width:100%;border-collapse:collapse}td,th{border:1px solid GrayText;padding:${compact ? "5px 7px" : "8px"}}blockquote{border-left:2px solid GrayText;margin-left:0;${quote}}a{text-decoration:underline}`;
  const base = shared + (rich ? "" : plain);
  const script = nonce ? linkBridge(nonce) : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';${imagePolicy}${scriptPolicy} style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';"><meta name="referrer" content="no-referrer"><style>${base}</style>${css ? `<style>${css}</style>` : ""}</head><body>${body}${script}</body></html>`;
}
