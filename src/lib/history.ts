import type { Account, HistoryPage, Message } from "../mygo";

export const historyKey = (id: string, folder: string, validity: number) =>
  JSON.stringify([id, folder, validity]);
export function mergeMailRows(
  previous: Message[],
  incoming: Message[],
  unified: boolean,
): Message[] {
  const rows = new Map(previous.map((m) => [m.id, m]));
  for (const m of incoming) {
    const old = rows.get(m.id);
    rows.set(m.id, old?.cached && !m.cached ? { ...m, cached: true } : m);
  }
  return [...rows.values()].sort((a, b) =>
    unified
      ? (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) ||
        a.id.localeCompare(b.id)
      : b.uid - a.uid,
  );
}
export function accountHistory(rows: Message[], id: string, folder: string) {
  const found = rows.filter(
    (m) =>
      m.accountId === id && m.folder.toUpperCase() === folder.toUpperCase(),
  );
  const oldest = found.reduce<Message | undefined>(
    (previous, m) => (!previous || m.uid < previous.uid ? m : previous),
    undefined,
  );
  return {
    count: found.length,
    before: oldest?.uid || 0,
    validity: oldest?.validity || 0,
  };
}
export function hasMoreHistory(
  rows: Message[],
  accounts: Account[],
  folder: string,
  limit: number,
  done: Set<string>,
) {
  return (
    rows.length > limit ||
    accounts.some((a) => {
      const cursor = accountHistory(rows, a.id, folder);
      return !done.has(historyKey(a.id, folder, cursor.validity));
    })
  );
}

// Before revealing the next merged window, each account must contribute at
// least that many candidates (or be exhausted), otherwise a busy inbox is skipped.
export async function ensureHistoryWindow(options: {
  rows: Message[];
  accounts: Account[];
  folder: string;
  target: number;
  unified: boolean;
  done: Set<string>;
  load: (
    id: string,
    folder: string,
    before: number,
    validity: number,
  ) => Promise<HistoryPage>;
  cancelled: () => boolean;
}) {
  const completed = new Set(options.done);
  const results = await Promise.allSettled(
    options.accounts.map(async (account) => {
      let rows = options.rows.filter((m) => m.accountId === account.id),
        cursor = accountHistory(rows, account.id, options.folder);
      for (
        let attempts = 0;
        attempts < 4 && cursor.count < options.target && !options.cancelled();
        attempts++
      ) {
        if (
          completed.has(historyKey(account.id, options.folder, cursor.validity))
        )
          break;
        const page = await options.load(
          account.id,
          options.folder,
          cursor.before,
          cursor.validity,
        );
        if (options.cancelled()) break;
        rows = mergeMailRows(rows, page.messages, options.unified);
        const next = accountHistory(rows, account.id, options.folder);
        next.validity = page.validity || next.validity || cursor.validity;
        if (!page.hasMore) {
          completed.add(historyKey(account.id, options.folder, next.validity));
          cursor = next;
          break;
        }
        const before = page.nextUID || next.before;
        if (!before || (cursor.before > 0 && before >= cursor.before))
          throw new Error("历史邮件加载未取得进展，请刷新后重试");
        cursor = { ...next, before };
      }
      return rows;
    }),
  );
  const incoming: Message[] = [];
  const failures: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") incoming.push(...result.value);
    else
      failures.push(
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      );
  }
  return {
    rows: mergeMailRows(options.rows, incoming, options.unified),
    done: completed,
    error: failures.length ? failures[0] : "",
  };
}
