import { useEffect, useRef } from "react";
import { safeHttpLink } from "@/lib/links";

/** Bound pathological layouts while allowing long newsletters well over 20k px. */
const maxFrameHeight = 1000000;

/**
 * The reading frame of a message. The document comes from `mailDocument` and
 * is sandboxed without `allow-same-origin`: it lives in an opaque origin, so
 * nothing in it — mail markup, mail CSS, or the one script the document's CSP
 * allows — can read the app's DOM, storage or cookies. Anchors carry
 * `data-mail-href` instead of `href`, so the frame cannot navigate either.
 *
 * WebKit does not deliver clicks inside a sandboxed frame to listeners the
 * page adds, so that allowed script posts them back here instead; only a
 * message whose `source` is this very frame is trusted. The same script
 * reports the body height, which lets the frame take its full height and keeps
 * the reader as one scrolling column instead of a scrollbar inside a card.
 */
export function MailFrame({
  doc,
  onOpenLink,
  title,
}: {
  doc: string;
  onOpenLink: (href: string) => void;
  title: string;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const open = useRef(onOpenLink);
  open.current = onOpenLink;

  useEffect(() => {
    if (frame.current) frame.current.style.height = "1px";
  }, [doc]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!frame.current || event.source !== frame.current.contentWindow)
        return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;
      if ("mail:height" in data) {
        const height = Math.ceil(Number(data["mail:height"]));
        if (!Number.isFinite(height) || height <= 0) return;
        frame.current.style.height = `${Math.min(height, maxFrameHeight)}px`;
        return;
      }
      const href = safeHttpLink(String(data["mail:link"] ?? ""));
      if (href) open.current(href);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      scrolling="no"
      srcDoc={doc}
    />
  );
}
