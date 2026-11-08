import { t, getLocale } from "./i18n";
import type { FolderInfo } from "../mygo";

export const folderRoles = {
  inbox: "收件箱",
  sent: "已发送",
  drafts: "草稿",
  flagged: "星标邮件",
  archive: "归档",
  all: "所有邮件",
  junk: "垃圾邮件",
  trash: "已删除",
};
export type FolderRole = keyof typeof folderRoles;
export interface FolderNode {
  id: string;
  title: string;
  role?: FolderRole;
  selectable: boolean;
  children: FolderNode[];
}
const roleOrder = Object.keys(folderRoles);
const aliases: Record<string, FolderRole> = {
  inbox: "inbox",
  收件箱: "inbox",
  sent: "sent",
  "sent items": "sent",
  "sent messages": "sent",
  已发送: "sent",
  已发送邮件: "sent",
  drafts: "drafts",
  draft: "drafts",
  草稿: "drafts",
  草稿箱: "drafts",
  starred: "flagged",
  flagged: "flagged",
  星标邮件: "flagged",
  archive: "archive",
  archives: "archive",
  归档: "archive",
  归档邮件: "archive",
  "all mail": "all",
  所有邮件: "all",
  junk: "junk",
  spam: "junk",
  "junk email": "junk",
  垃圾箱: "junk",
  垃圾邮件: "junk",
  trash: "trash",
  "deleted items": "trash",
  "deleted messages": "trash",
  已删除: "trash",
  已删除邮件: "trash",
  废纸篓: "trash",
};
export function folderRole(folder: FolderInfo): FolderRole | undefined {
  if (folder.name.toUpperCase() === "INBOX") return "inbox";
  if (Object.hasOwn(folderRoles, folder.role)) return folder.role as FolderRole;
  const leaf = folder.delimiter
    ? folder.name.split(folder.delimiter).at(-1)!
    : folder.name;
  return aliases[leaf.trim().toLowerCase()];
}
export function folderTitle(folder: FolderInfo) {
  const role = folderRole(folder);
  return role
    ? t(folderRoles[role])
    : folder.delimiter
      ? folder.name.split(folder.delimiter).at(-1)!
      : folder.name;
}
export function buildFolderTree(folders: FolderInfo[]) {
  const nodes = new Map<string, FolderNode>(),
    roots: FolderNode[] = [];
  const ensure = (id: string, title: string) => {
    let n = nodes.get(id);
    if (!n) {
      n = { id, title, selectable: false, children: [] };
      nodes.set(id, n);
    }
    return n;
  };
  for (const folder of folders) {
    const parts = folder.delimiter
      ? folder.name.split(folder.delimiter)
      : [folder.name];
    let parent: FolderNode | undefined;
    parts.forEach((part, index) => {
      const id = parts.slice(0, index + 1).join(folder.delimiter);
      const node = ensure(id, part);
      const siblings = parent ? parent.children : roots;
      if (!siblings.includes(node)) siblings.push(node);
      if (index === parts.length - 1) {
        node.selectable = folder.selectable;
        node.role = folderRole(folder);
        node.title = folderTitle(folder);
      }
      parent = node;
    });
  }
  const standard: FolderNode[] = [];
  // Promote special-use mailboxes out of provider containers, preserving their real IDs.
  function collect(nodes: FolderNode[]): FolderNode[] {
    return nodes.flatMap((node) => {
      node.children = collect(node.children);
      if (node.selectable && node.role) {
        standard.push(node);
        return [];
      }
      return node.selectable || node.children.length ? [node] : [];
    });
  }
  const custom = collect(roots);
  const collator = new Intl.Collator(getLocale(), {
    numeric: true,
    sensitivity: "base",
  });
  const sort = (ns: FolderNode[]) => {
    ns.sort(
      (a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id),
    );
    ns.forEach((n) => sort(n.children));
  };
  sort(custom);
  standard.sort(
    (a, b) =>
      roleOrder.indexOf(a.role!) - roleOrder.indexOf(b.role!) ||
      collator.compare(a.title, b.title) ||
      a.id.localeCompare(b.id),
  );
  return { standard, custom };
}
export function ancestorIDs(nodes: FolderNode[], active: string): string[] {
  for (const node of nodes) {
    if (node.id === active) return [];
    const child = ancestorIDs(node.children, active);
    if (node.children.some((n) => n.id === active) || child.length)
      return [node.id, ...child];
  }
  return [];
}
export function readFolderExpansion(key: string): Record<string, boolean> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(
      Object.entries(data).filter(([, value]) => typeof value === "boolean"),
    );
  } catch {
    return {};
  }
}
