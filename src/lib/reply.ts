import type { Draft, Message } from "../mygo";

export const dateTimeText = (raw: string) => {
  const d = new Date(raw);
  if (Number.isNaN(+d)) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const senderName = (from: string) =>
  from.replace(/<.*>/, "").replaceAll('"', "").trim() || from;
export const addressOf = (value: string) => {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim();
};

/**
 * The original mail attached to a reply or forward. The structured fields
 * feed the quote card in the composer, so a reply shows the same header
 * (sender, date, recipients) that other mail clients show; `text` is the
 * plain-text form that is actually saved and sent.
 */
export interface ComposeQuote {
  kind: "reply" | "forward";
  from: string;
  to: string;
  subject: string;
  /** Localised date and time of the original message. */
  date: string;
  text: string;
  /** Original HTML body; sanitized by `mailDocument` when it is shown. */
  html?: string;
}

export interface ComposeSeed {
  draft: Draft;
  content: string;
  quote: ComposeQuote | null;
  /** Draft slot: one per message so replies never overwrite each other. */
  key?: string;
  /** A mailto: link is a new message, never a reason to load a stored draft. */
  noResume?: boolean;
}

export function replyQuote(m: Message): ComposeQuote {
  return {
    kind: "reply",
    from: m.from,
    to: m.to,
    subject: m.subject || "",
    date: dateTimeText(m.date) || m.date,
    text: m.text.trim() || "（原邮件没有纯文本正文）",
    html: m.html?.trim() || undefined,
  };
}

export function forwardQuote(m: Message): ComposeQuote {
  return {
    kind: "forward",
    from: m.from,
    to: m.to,
    subject: m.subject || "",
    date: dateTimeText(m.date) || m.date,
    text: m.text.trim() || "（原邮件没有纯文本正文）",
    html: m.html?.trim() || undefined,
  };
}

/** `在 2026-11-07 20:37，Alice <alice@qq.com> 写道：` */
export function quoteAttribution(quote: ComposeQuote): string {
  return `在 ${quote.date}，${quote.from} 写道：`;
}

export function forwardHeader(quote: ComposeQuote): string[] {
  return [
    "-------- 转发的邮件 --------",
    `发件人：${quote.from}`,
    `时间：${quote.date}`,
    `收件人：${quote.to}`,
    `主题：${quote.subject || "（无主题）"}`,
  ];
}

/** Human-readable quote used by the composer preview and forwards. */
export function quoteDisplay(quote: ComposeQuote): string {
  return quote.kind === "reply"
    ? `${quoteAttribution(quote)}\n\n${quote.text}`
    : `${forwardHeader(quote).join("\n")}\n\n${quote.text}`;
}

/** Plain-text quote actually written to the draft and the outgoing mail. */
export function quoteText(quote: ComposeQuote): string {
  if (quote.kind === "forward") return quoteDisplay(quote);
  const body = quote.text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ""))
    .join("\n");
  return `${quoteAttribution(quote)}\n\n${body}`;
}

export function composeBody(
  content: string,
  quote: ComposeQuote | null,
): string {
  const text = content.trimEnd();
  if (!quote) return text;
  const quoted = quoteText(quote);
  return text ? `${text}\n\n${quoted}` : quoted;
}

const attributionPattern = /^在\s*(.+?)，\s*(.+?)\s*写道：$/;
const forwardPattern = /^-{4,}\s*转发的邮件\s*-{4,}$/;
const forwardFields = ["发件人", "时间", "收件人", "主题"] as const;

function fieldValue(lines: string[], label: string) {
  const line = lines.find((item) => item.trim().startsWith(label + "："));
  return line
    ? line
        .trim()
        .slice(label.length + 1)
        .trim()
    : "";
}

/**
 * Recovers the editable part and the quote from a stored draft. Drafts keep a
 * single plain-text body, so the standard attribution line (replies) or the
 * divider with the metadata block (forwards) is what lets the composer show
 * the quote as a separate card again after reopening. A restored quote has
 * no HTML: the composer falls back to the plain-text body.
 */
export function splitComposeBody(body: string): {
  content: string;
  quote: ComposeQuote | null;
} {
  const lines = body.split("\n");
  const attribution = lines.findIndex((line) =>
    attributionPattern.test(line.trim()),
  );
  if (attribution >= 0) {
    const matched = lines[attribution].trim().match(attributionPattern);
    const quoted = lines.slice(attribution + 1);
    while (quoted.length && !quoted[0].trim()) quoted.shift();
    return {
      content: lines.slice(0, attribution).join("\n").trimEnd(),
      quote: {
        kind: "reply",
        from: matched?.[2] ?? "",
        to: "",
        subject: "",
        date: matched?.[1] ?? "",
        text: quoted
          .map((line) => line.replace(/^> ?/, ""))
          .join("\n")
          .trimEnd(),
      },
    };
  }
  const divider = lines.findIndex((line) => forwardPattern.test(line.trim()));
  if (divider >= 0) {
    const rest = lines.slice(divider),
      blank = rest.findIndex((line, i) => i > 0 && !line.trim()),
      header = blank >= 0 ? rest.slice(0, blank) : rest;
    return {
      content: lines.slice(0, divider).join("\n").trimEnd(),
      quote: {
        kind: "forward",
        from: fieldValue(header, forwardFields[0]),
        date: fieldValue(header, forwardFields[1]),
        to: fieldValue(header, forwardFields[2]),
        subject: fieldValue(header, forwardFields[3]),
        text:
          blank >= 0
            ? rest
                .slice(blank + 1)
                .join("\n")
                .trimEnd()
            : "",
      },
    };
  }
  return { content: body, quote: null };
}

const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/** A draft with nothing typed in it is not worth offering back. */
export function draftHasContent(draft: Draft): boolean {
  return !!(draft.to.trim() || draft.cc.trim() || draft.subject.trim() || draft.body.trim());
}

/**
 * The composer keeps one draft per account, so opening a reply must not blindly
 * load it: most of the time it is a different mail. A reply can be resumed when
 * the stored draft answers *this* message — same subject and the attribution
 * (or forwarded header) inside the body points at the same original mail by
 * date and sender. The returned draft carries the live quote, so the card comes
 * back with its original HTML instead of the plain-text copy.
 */
export function resumeDraft(draft: Draft, seed: ComposeSeed): Draft | null {
  if (!draftHasContent(draft)) return null;
  if (norm(draft.subject) !== norm(seed.draft.subject)) return null;
  const split = splitComposeBody(draft.body);
  if (seed.quote) {
    if (!split.quote) return null;
    if (split.quote.kind !== seed.quote.kind) return null;
    if (norm(split.quote.date) !== norm(seed.quote.date)) return null;
    if (norm(split.quote.from) !== norm(seed.quote.from)) return null;
  }
  return { ...draft, body: composeBody(split.content, seed.quote ?? split.quote) };
}
