import { t, useLocale } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import {
  Inbox,
  Send,
  FileText,
  Star,
  Archive,
  Mail,
  ShieldAlert,
  Trash2,
  Folder,
  ChevronRight,
} from "lucide-react";
import type { FolderInfo } from "../mygo";
import {
  ancestorIDs,
  buildFolderTree,
  readFolderExpansion,
  type FolderNode,
} from "../lib/folders";

const icons = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  flagged: Star,
  archive: Archive,
  all: Mail,
  junk: ShieldAlert,
  trash: Trash2,
};
export function FolderSidebar({
  accountID,
  folders,
  active,
  disabled,
  onSelect,
  inboxUnread,
}: {
  accountID: string;
  folders: FolderInfo[];
  active: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  inboxUnread?: number;
}) {
  const locale = useLocale();
  const storageKey = `mail:folder-expansion:${accountID}`;
  const [expanded, setExpanded] = useState(() =>
    readFolderExpansion(storageKey),
  );
  const { standard, custom } = useMemo(
    () => buildFolderTree(folders),
    [folders, locale],
  );
  useEffect(() => {
    const ancestors = ancestorIDs([...standard, ...custom], active);
    const customActive =
      custom.some((n) => n.id === active) ||
      ancestorIDs(custom, active).length > 0;
    setExpanded((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const id of [...ancestors, ...(customActive ? ["$custom"] : [])]) {
        if (!next[id]) {
          next[id] = true;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [active, standard, custom]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(expanded));
    } catch {
      /* Preference persistence must not interrupt mailbox navigation. */
    }
  }, [expanded, storageKey]);
  const toggle = (id: string, defaultOpen = false) =>
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultOpen) }));
  function render(nodes: FolderNode[], depth = 0): React.ReactNode {
    return (
      <ul className="folder-tree-list">
        {nodes.map((node) => {
          const Icon = node.role ? icons[node.role] : Folder;
          const hasChildren = node.children.length > 0;
          const open = expanded[node.id] ?? false;
          return (
            <li key={node.id}>
              <div
                className={
                  "folder-tree-row " + (active === node.id ? "selected" : "")
                }
                style={{ paddingLeft: depth * 14 }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className="folder-disclosure"
                    aria-label={`${open ? t("收起") : t("展开")}${node.title}`}
                    aria-expanded={open}
                    onClick={() => toggle(node.id)}
                  >
                    <ChevronRight size={12} className={open ? "open" : ""} />
                  </button>
                ) : (
                  <span className="folder-disclosure-spacer" />
                )}
                <button
                  type="button"
                  className="folder-select"
                  disabled={node.selectable && disabled}
                  aria-current={active === node.id ? "page" : undefined}
                  title={node.id}
                  onClick={() =>
                    node.selectable ? onSelect(node.id) : toggle(node.id)
                  }
                  onKeyDown={(e) => {
                    if (
                      hasChildren &&
                      (e.key === "ArrowLeft" || e.key === "ArrowRight")
                    ) {
                      e.preventDefault();
                      setExpanded((prev) => ({
                        ...prev,
                        [node.id]: e.key === "ArrowRight",
                      }));
                    }
                  }}
                >
                  <Icon size={16} />
                  <span>{node.title}</span>
                  {node.role === "inbox" &&
                    inboxUnread !== undefined &&
                    inboxUnread > 0 && (
                      <small
                        className="folder-unread"
                        aria-label={t("{0} 封未读", { 0: inboxUnread })}
                      >
                        {inboxUnread > 999 ? "999+" : inboxUnread}
                      </small>
                    )}
                </button>
              </div>
              {hasChildren && open && render(node.children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <nav aria-label={t("邮箱文件夹")} className="folder-navigation">
      {render(standard)}
      {custom.length > 0 && (
        <div className="custom-folders">
          <button
            type="button"
            className="folder-section-toggle"
            aria-expanded={expanded.$custom ?? true}
            onClick={() => toggle("$custom", true)}
          >
            <ChevronRight
              size={12}
              className={(expanded.$custom ?? true) ? "open" : ""}
            />
            <span>{t("我的文件夹")}</span>
          </button>
          {(expanded.$custom ?? true) && render(custom)}
        </div>
      )}
    </nav>
  );
}
