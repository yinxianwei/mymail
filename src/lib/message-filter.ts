import type { Message } from "../mygo";

export type MessageFilter = "all" | "unread" | "starred" | "attachments";

/** Header-only local filtering: never fetches bodies or contacts a server. */
export function filterCachedMessages(
  rows: Message[],
  query: string,
  filter: MessageFilter,
): Message[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter((m) => {
    if (filter === "unread" && m.seen) return false;
    if (filter === "starred" && !m.flagged) return false;
    if (filter === "attachments" && !m.attachments?.length) return false;
    return (
      !needle ||
      [m.subject, m.from, m.to, ...(m.attachments ?? []).map((a) => a.name)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle)
    );
  });
}
