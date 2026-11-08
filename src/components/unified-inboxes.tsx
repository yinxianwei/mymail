import { useState } from "react";
import { ChevronRight, Inbox } from "lucide-react";
import type { Account } from "../mygo";

export function UnifiedInboxes({
  accounts,
  account,
  unified,
  folder,
  unread,
  onAll,
  onSelect,
}: {
  accounts: Account[];
  account: Account | null;
  unified: boolean;
  folder: string;
  unread: Record<string, number>;
  onAll: () => void;
  onSelect: (account: Account) => void;
}) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem("mail:all-inboxes-expanded") !== "false";
    } catch {
      return true;
    }
  });
  const total = accounts.reduce((sum, a) => sum + (unread[a.id] || 0), 0);
  function toggle() {
    setExpanded((previous) => {
      const next = !previous;
      try {
        localStorage.setItem("mail:all-inboxes-expanded", String(next));
      } catch {}
      return next;
    });
  }
  if (!accounts.length) return null;
  return (
    <nav className="unified-inboxes" aria-label="快捷文件夹">
      <div className={"folder-tree-row " + (unified ? "selected" : "")}>
        <button
          className="folder-disclosure"
          type="button"
          aria-label={expanded ? "收起所有收件箱" : "展开所有收件箱"}
          aria-expanded={expanded}
          onClick={toggle}
        >
          <ChevronRight size={12} className={expanded ? "open" : ""} />
        </button>
        <button
          type="button"
          className="folder-select"
          aria-current={unified ? "page" : undefined}
          onClick={onAll}
        >
          <Inbox size={16} />
          <span>所有收件箱</span>
          {total > 0 && <small className="folder-unread">{total}</small>}
        </button>
      </div>
      {expanded && (
        <ul className="folder-tree-list">
          {accounts.map((a) => (
            <li key={a.id}>
              <div
                className={
                  "folder-tree-row " +
                  (!unified && account?.id === a.id && folder === "INBOX"
                    ? "selected"
                    : "")
                }
                style={{ paddingLeft: 14 }}
              >
                <span className="folder-disclosure-spacer" />
                <button
                  type="button"
                  className="folder-select"
                  title={a.email}
                  aria-current={
                    !unified && account?.id === a.id && folder === "INBOX"
                      ? "page"
                      : undefined
                  }
                  onClick={() => onSelect(a)}
                >
                  <Inbox size={15} />
                  <span>{a.email}</span>
                  {unread[a.id] > 0 && (
                    <small className="folder-unread">{unread[a.id]}</small>
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
