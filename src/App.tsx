import { useEffect, useId, useRef, useState } from "react";
import {
  Mail,
  Send,
  Inbox,
  Plus,
  RefreshCw,
  Settings,
  Moon,
  Sun,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Search,
  X,
  PenLine,
  FileText,
  Paperclip,
  Reply,
  ReplyAll,
  Forward,
  Star,
  Trash2,
  FolderInput,
  MailOpen,
  Check,
} from "lucide-react";
import {
  MailService as api,
  type Account,
  type AccountInput,
  type Draft,
  type DraftAttachment,
  type Message,
  type FolderInfo,
  type DesktopState,
  type MailTarget,
  type Settings as MailSettings,
  type CacheStats,
  events,
} from "./mygo";
import { UnifiedInboxes } from "./components/unified-inboxes";
import { FolderSidebar } from "./components/folder-sidebar";
import { MailFrame } from "./components/mail-frame";
import {
  ensureHistoryWindow,
  hasMoreHistory,
  mergeMailRows,
} from "./lib/history";
import { folderTitle } from "./lib/folders";
import {
  addressOf,
  composeBody,
  dateTimeText,
  draftHasContent,
  forwardQuote,
  replyQuote,
  resumeDraft,
  senderName,
  splitComposeBody,
  type ComposeQuote,
  type ComposeSeed,
} from "./lib/reply";
import { fileSize } from "./lib/files";
import {
  isTrustedSender,
  readRemoteTrust,
  setSenderTrust,
  trustReason,
  trustScopeOf,
  writeRemoteTrust,
  type RemoteTrust,
} from "./lib/remote-content";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Field, Input } from "@/components/ui/input";
import { ChipInput } from "@/components/ui/chip-input";
import { Textarea } from "@/components/ui/textarea";
import { Modal } from "@/components/ui/modal";
import { mailDocument } from "./mail-html";

const emptyAccount: AccountInput = {
  id: "",
  email: "",
  imapHost: "imap.qq.com",
  imapPort: 993,
  imapTLS: "tls",
  smtpHost: "smtp.qq.com",
  smtpPort: 465,
  smtpTLS: "tls",
  demo: false,
  password: "",
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Distance from the end of the list that starts the next history page.
const historyScrollThreshold = 160;
// Fixed row heights keep the virtual list honest: only the rows in (and just
// around) the viewport are mounted, while spacers stand in for the rest.
const mailRowHeight = 72;
const unifiedRowHeight = 92;
const listOverscan = 6;
const byteText = (n: number) =>
  n >= 1 << 20
    ? `${(n / (1 << 20)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
const dateText = (raw: string) => {
  const d = new Date(raw);
  return Number.isNaN(+d)
    ? ""
    : d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
};
/** Everyone on a reply-all thread except the sender (that is the To line) and
 *  the reader themselves; duplicates and the reader's own address are dropped. */
function replyAllCopies(m: Message, self: string) {
  const own = self.toLowerCase(),
    sender = addressOf(m.from).toLowerCase(),
    seen = new Set<string>([own, sender]),
    result: string[] = [];
  for (const item of m.to.split(",")) {
    const value = item.trim();
    if (!value) continue;
    const address = addressOf(value).toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    result.push(value);
  }
  return result.join(", ");
}

const emptyDesktop: DesktopState = {
  unread: 0,
  accountUnread: {},
  notifications: true,
  notificationStatus: "",
  checking: false,
  lastError: "",
  revision: 0,
};
export function App() {
  const [unified, setUnified] = useState(() => {
    try {
      return localStorage.getItem("mail:inbox-scope") === "all";
    } catch {
      return false;
    }
  });
  function rememberScope(value: string) {
    try {
      localStorage.setItem("mail:inbox-scope", value);
    } catch {}
  }
  const [desktop, setDesktop] = useState<DesktopState>(emptyDesktop);
  const [mailTarget, setMailTarget] = useState<MailTarget | null>(null);
  const acceptDesktop = (next: DesktopState) =>
    setDesktop((previous) =>
      next.revision >= previous.revision ? next : previous,
    );
  const [accounts, setAccounts] = useState<Account[]>([]),
    [account, setAccount] = useState<Account | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([
      { name: "INBOX", delimiter: "", role: "inbox", selectable: true },
    ]),
    [folder, setFolder] = useState("INBOX");
  const [messages, setMessages] = useState<Message[]>([]),
    [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [settings, setSettings] = useState(false),
    [compose, setCompose] = useState(false),
    [query, setQuery] = useState("");
  const [composeSeed, setComposeSeed] = useState<ComposeSeed | null>(null),
    // “写邮件” starts a blank message. The window is otherwise reused by
    // reply/forward, so the intent has to travel with the open flag: a null
    // seed alone would fall back to whatever draft is stored for the account.
    [composeFresh, setComposeFresh] = useState(false);
  const [remoteTrust, setRemoteTrust] = useState<RemoteTrust>(() =>
    readRemoteTrust(),
  );
  const [remoteOverride, setRemoteOverride] = useState<Record<string, boolean>>(
    {},
  );
  const [dark, setDark] = useState(
    () => localStorage.getItem("mail:theme") === "dark",
  );
  const [database, setDatabase] = useState(""),
    [reading, setReading] = useState(false),
    // Which attachment index is being written to disk, so only that row says
    // “保存中…” and the others cannot start a second save panel.
    [savingAttachment, setSavingAttachment] = useState<number | null>(null);
  // Preferences come from Go/SQLite so the monitor and the reader agree.
  const [prefs, setPrefs] = useState<MailSettings>({
    syncIntervalSec: 60,
    autoMarkRead: true,
    remoteDefault: "trusted",
    appendSent: false,
    cacheLimit: 2000,
  });
  const [cache, setCache] = useState<CacheStats>({
    messages: 0,
    headerBytes: 0,
    attachments: 0,
    attachmentBytes: 0,
    sent: 0,
    limit: 2000,
  });
  const [manageTarget, setManageTarget] = useState<"" | "move" | "delete">(""),
    // A move needs two clicks: pick a folder, then confirm. Clicking a folder
    // used to execute immediately, so a mis-click moved the mail away.
    [movePick, setMovePick] = useState(""),
    [moveOptions, setMoveOptions] = useState<FolderInfo[]>([]),
    [managing, setManaging] = useState(""),
    [pendingOps, setPendingOps] = useState(0);
  const [rowLimit, setRowLimit] = useState(50),
    [loadingOlder, setLoadingOlder] = useState(false),
    [olderError, setOlderError] = useState("");
  const [scrollPos, setScrollPos] = useState({ top: 0, height: 600 });
  const [historyDone, setHistoryDone] = useState<Set<string>>(() => new Set());
  const historyRequest = useRef(0),
    historyBusy = useRef(0),
    messageScroll = useRef<HTMLDivElement>(null),
    readerScroll = useRef<HTMLDivElement>(null);
  // mailto: links can arrive before the first account is loaded; the event
  // listener is installed once, so it reads the current sender through refs.
  const sendersRef = useRef<Account[]>([]);
  useEffect(() => {
    sendersRef.current = accounts;
  }, [accounts]);
  function resetHistory() {
    historyRequest.current++;
    historyBusy.current = 0;
    setRowLimit(50);
    setLoadingOlder(false);
    setOlderError("");
    setHistoryDone(new Set());
    setScrollPos((p) => ({ ...p, top: 0 }));
    if (messageScroll.current) messageScroll.current.scrollTop = 0;
  }
  const generation = useRef(0),
    readGeneration = useRef(0);
  // Destructive dialogs must open with focus on Cancel, so a stray Enter
  // dismisses the dialog instead of deleting the message.
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("mail:theme", dark ? "dark" : "light");
  }, [dark]);
  // The list measures its own viewport. jsdom and older WebViews have no
  // ResizeObserver, so the initial fallback height still yields a window.
  useEffect(() => {
    const node = messageScroll.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setScrollPos((p) => ({ ...p, height: node.clientHeight || p.height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Go parses mailto: links and delivers an already-clean draft. A link must
  // never silently replace a stored draft, hence `noResume`.
  useEffect(() => {
    const handler = (draft: Draft) => {
      const sender =
        sendersRef.current.find((a) => !a.demo) ?? sendersRef.current[0];
      if (!sender) {
        setNotice("请先添加邮箱账号，再打开 mailto 链接");
        return;
      }
      setComposeSeed({
        draft: { ...draft, accountId: sender.id, key: "new" },
        content: draft.body,
        quote: null,
        key: "new",
        noResume: true,
      });
      setComposeFresh(false);
      setCompose(true);
    };
    // A plain browser or jsdom has no MyGo runtime. Other IPC calls fail
    // asynchronously and are caught; event subscription throws, so guard it.
    let off = () => {};
    try {
      off = events.composeMail.on(handler);
    } catch {}
    return off;
  }, []);
  useEffect(() => {
    if (!settings) return;
    refreshCache();
  }, [settings]);
  function refreshCache() {
    Promise.resolve()
      .then(() => api.cacheStats())
      .then(setCache)
      .catch(() => {});
  }
  // The reader is one scrolling column now, so a newly opened message starts at
  // the top instead of inheriting the previous message's offset.
  useEffect(() => {
    if (readerScroll.current) readerScroll.current.scrollTop = 0;
  }, [message?.id]);
  useEffect(() => {
    api
      .state()
      .then((s) => {
        setAccounts(s.accounts);
        let saved = "";
        try {
          saved = localStorage.getItem("mail:inbox-scope") || "";
        } catch {}
        setAccount(
          s.accounts.find((a) => saved === `account:${a.id}`) ??
            s.accounts[0] ??
            null,
        );
        setDatabase(s.database);
      })
      .catch((e) => setError(errorText(e)));
    api
      .getSettings()
      .then(setPrefs)
      .catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    const receiveTarget = () =>
      api
        .takeMailTarget()
        .then((target) => {
          if (live && target.accountId) setMailTarget(target);
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    const offState = events.mailChanged.on((state) => {
      if (live) acceptDesktop(state);
    });
    const offTarget = events.openMail.on(() => {
      void receiveTarget();
    });
    api
      .desktopState()
      .then((state) => {
        if (live) acceptDesktop(state);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    void receiveTarget();
    return () => {
      live = false;
      offState();
      offTarget();
    };
  }, []);
  useEffect(() => {
    const g = ++generation.current;
    resetHistory();
    ++readGeneration.current;
    setMessage(null);
    setReading(false);
    setMessages([]);
    setFolders([
      { name: "INBOX", delimiter: "", role: "inbox", selectable: true },
    ]);
    setFolder("INBOX");
    setQuery("");
    setError("");
    if (!account) return;
    let cancelled = false;
    (unified ? api.allInboxMessages() : api.messages(account.id, "INBOX"))
      .then((ms) => {
        if (g === generation.current) setMessages(ms);
      })
      .catch((e) => {
        if (g === generation.current) setError(errorText(e));
      });
    if (!unified)
      api
        .folders(account.id)
        .then((fs) => {
          if (!cancelled) setFolders(fs);
        })
        .catch((e) => {
          if (!cancelled) setError(errorText(e));
        });
    return () => {
      cancelled = true;
    };
  }, [account, unified]);
  useEffect(() => {
    if (!account || desktop.revision === 0) return;
    let cancelled = false;
    const g = generation.current;
    (unified ? api.allInboxMessages() : api.messages(account.id, folder))
      .then((ms) => {
        if (!cancelled && g === generation.current) setMessages(ms);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [desktop.revision, account, folder, unified]);
  useEffect(() => {
    if (!mailTarget || !accounts.length) return;
    const selected = accounts.find((a) => a.id === mailTarget.accountId);
    if (!selected) {
      setMailTarget(null);
      return;
    }
    if (unified) {
      setUnified(false);
      rememberScope(`account:${selected.id}`);
      return;
    }
    if (account?.id !== selected.id) {
      setAccount(selected);
      return;
    }
    const target = mailTarget;
    resetHistory();
    setMailTarget(null);
    const g = ++generation.current;
    ++readGeneration.current;
    setFolder("INBOX");
    setQuery("");
    setMessage(null);
    api
      .resolveMailTarget(target)
      .then(async (found) => {
        if (g !== generation.current) return;
        const rows = await api.messages(selected.id, "INBOX");
        if (g !== generation.current) return;
        setMessages(
          rows.some((m) => m.id === found.id) ? rows : [...rows, found],
        );
        void read(found);
      })
      .catch((e) => {
        if (g === generation.current) setError(errorText(e));
      });
  }, [mailTarget, accounts, account, unified]);
  async function chooseFolder(name: string) {
    resetHistory();
    const g = ++generation.current;
    ++readGeneration.current;
    setFolder(name);
    setMessage(null);
    setReading(false);
    setQuery("");
    setError("");
    if (!account) return;
    setMessages([]);
    try {
      const ms = await api.messages(account.id, name);
      if (g === generation.current) setMessages(ms);
    } catch (e) {
      setError(errorText(e));
    }
  }
  function selectAccount(selected: Account) {
    rememberScope(`account:${selected.id}`);
    if (!unified && account?.id === selected.id) {
      void chooseFolder("INBOX");
      return;
    }
    setUnified(false);
    setAccount(selected);
  }
  function chooseAll() {
    rememberScope("all");
    if (unified) {
      resetHistory();
      const g = ++generation.current;
      ++readGeneration.current;
      setMessage(null);
      setQuery("");
      api
        .allInboxMessages()
        .then((ms) => {
          if (g === generation.current) setMessages(ms);
        })
        .catch((e) => setError(errorText(e)));
      return;
    }
    setUnified(true);
  }
  async function sync() {
    if (!account || busy) return;
    const g = generation.current;
    setHistoryDone(new Set());
    setOlderError("");
    setBusy("正在同步最近邮件…");
    setError("");
    try {
      let ms: Message[];
      if (unified) {
        const status = await api.checkMail();
        acceptDesktop(status);
        ms = await api.allInboxMessages();
        if (status.lastError) setError(status.lastError);
      } else ms = await api.sync(account.id, folder);
      if (g === generation.current) {
        setMessages(ms);
        setNotice("");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function loadOlder() {
    if (!account || historyBusy.current || busy || query.trim()) return;
    const token = ++historyRequest.current,
      g = generation.current;
    historyBusy.current = token;
    setLoadingOlder(true);
    setOlderError("");
    const owners = unified ? accounts : [account],
      target = rowLimit + 50;
    try {
      const result = await ensureHistoryWindow({
        rows: messages,
        accounts: owners,
        folder: unified ? "INBOX" : folder,
        target,
        unified,
        done: historyDone,
        load: api.loadOlder,
        cancelled: () =>
          g !== generation.current || historyRequest.current !== token,
      });
      if (g !== generation.current || historyRequest.current !== token) return;
      const originalIDs = new Set(messages.map((m) => m.id));
      setMessages((previous) => {
        const versions = new Map(
          previous.map((m) => [
            JSON.stringify([m.accountId, m.folder]),
            m.validity,
          ]),
        );
        const added = result.rows.filter(
          (m) =>
            !originalIDs.has(m.id) &&
            (!versions.has(JSON.stringify([m.accountId, m.folder])) ||
              versions.get(JSON.stringify([m.accountId, m.folder])) ===
                m.validity),
        );
        return mergeMailRows(added, previous, unified);
      });
      setHistoryDone(result.done);
      setOlderError(result.error);
      setRowLimit(target);
    } catch (e) {
      if (g === generation.current && historyRequest.current === token)
        setOlderError(errorText(e));
    } finally {
      if (historyBusy.current === token) {
        historyBusy.current = 0;
        setLoadingOlder(false);
      }
    }
  }
  function replyTo(kind: "reply" | "replyAll" | "forward") {
    if (!message || !senderAccount) return;
    const subject = message.subject || "",
      prefix = kind === "forward" ? "Fwd: " : "Re: ",
      // Reply-all goes to the sender and puts everyone else on Cc, the way
      // other clients split the two lists.
      others =
        kind === "replyAll" ? replyAllCopies(message, senderAccount.email) : "";
    setComposeFresh(false);
    setComposeSeed({
      draft: {
        accountId: senderAccount.id,
        key: (kind === "forward" ? "forward:" : "reply:") + message.id,
        to: kind === "forward" ? "" : message.from,
        cc: others,
        bcc: "",
        subject: /^(re|fwd):/i.test(subject) ? subject : prefix + subject,
        body: "",
        attachments: [],
      },
      content: "",
      quote: kind === "forward" ? forwardQuote(message) : replyQuote(message),
      key: (kind === "forward" ? "forward:" : "reply:") + message.id,
    });
    setCompose(true);
  }
  async function read(m: Message) {
    const g = ++readGeneration.current;
    setMessage(m);
    setReading(true);
    setError("");
    try {
      const full = await api.readMessage(m.id);
      if (g === readGeneration.current) {
        setMessage(full);
        setMessages((ms) =>
          ms.map((x) => (x.id === full.id ? { ...x, cached: true } : x)),
        );
        if (!full.seen && prefs.autoMarkRead) {
          await api.markRead(full.id);
          if (g === readGeneration.current) {
            setMessage({ ...full, seen: true });
            setMessages((ms) =>
              ms.map((x) => (x.id === full.id ? { ...x, seen: true } : x)),
            );
          }
        }
      }
    } catch (e) {
      if (g === readGeneration.current) setError(errorText(e));
    } finally {
      if (g === readGeneration.current) setReading(false);
    }
  }
  // The Go side opens a native save panel; an empty path means the reader
  // cancelled, which is not an error worth a banner.
  async function saveAttachment(m: Message, index: number) {
    setSavingAttachment(index);
    setError("");
    setNotice("");
    try {
      const path = await api.downloadAttachment(m.id, index);
      if (path) setNotice(`附件已保存到 ${path}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSavingAttachment(null);
    }
  }
  async function demo() {
    setBusy("正在写入本地示例…");
    try {
      const a = await api.loadDemo();
      const state = await api.state();
      setAccounts(state.accounts);
      setUnified(false);
      rememberScope(`account:${a.id}`);
      setAccount(a);
      setNotice("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  const matching = messages.filter((m) =>
    (m.subject + " " + m.from + " " + m.to)
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const visible = matching.slice(0, rowLimit);
  const rowHeight = unified ? unifiedRowHeight : mailRowHeight;
  const totalRows = visible.length;
  const viewportRows = Math.ceil(Math.max(scrollPos.height, 480) / rowHeight);
  const firstRow = Math.max(
    0,
    Math.min(totalRows, Math.floor(scrollPos.top / rowHeight) - listOverscan),
  );
  const lastRow = Math.min(
    totalRows,
    firstRow + viewportRows + listOverscan * 2,
  );
  const windowRows = visible.slice(firstRow, lastRow);
  const moreAvailable = hasMoreHistory(
    messages,
    unified ? accounts : account ? [account] : [],
    unified ? "INBOX" : folder,
    rowLimit,
    historyDone,
  );
  const senderAccount =
    unified && message
      ? (accounts.find((a) => a.id === message.accountId) ?? account)
      : account;
  const trustedSender = message
    ? isTrustedSender(
        message.from,
        accounts.map((a) => a.email),
        remoteTrust,
      )
    : false;
  const remoteAllowed = message
    ? (remoteOverride[message.id] ??
      (prefs.remoteDefault === "always"
        ? true
        : prefs.remoteDefault === "never"
          ? false
          : trustedSender))
    : false;
  const trust = message
    ? trustReason(
        message.from,
        accounts.map((a) => a.email),
        remoteTrust,
      )
    : "unknown";
  const trustScope = message ? trustScopeOf(message.from) : "";
  const trustNote = !remoteAllowed
    ? ""
    : trust === "provider"
      ? "常用邮箱服务商"
      : trust === "account"
        ? "与你的账号同域"
        : trust === "allowed"
          ? `已信任 ${trustScope}`
          : "仅本次会话";
  function setRemote(trusted: boolean, persist: boolean) {
    if (!message) return;
    setRemoteOverride((values) => ({ ...values, [message.id]: trusted }));
    if (!persist) return;
    const next = setSenderTrust(remoteTrust, message.from, trusted);
    setRemoteTrust(next);
    writeRemoteTrust(next);
  }
  // Every management action changes the local cache first; Go keeps a durable
  // queue for the server write. Reload the rows afterwards so the UI reflects
  // either the optimistic value or a permanent-failure rollback. The open
  // reader holds its own copy of the message, so mirror the flags back into it
  // as well — otherwise the star (and read) buttons never change state.
  async function refreshRows() {
    if (!account) return;
    const rows = unified
      ? await api.allInboxMessages()
      : await api.messages(account.id, folder);
    setMessages(rows);
    setMessage((current) => {
      if (!current) return current;
      const fresh = rows.find((row) => row.id === current.id);
      if (
        !fresh ||
        (current.seen === fresh.seen && current.flagged === fresh.flagged)
      )
        return current;
      return {
        ...current,
        seen: fresh.seen,
        flagged: fresh.flagged,
      };
    });
    try {
      setPendingOps(await api.pendingCount());
    } catch {}
  }
  async function runManage(fn: () => Promise<string>, closeReader: boolean) {
    if (!message || managing) return;
    setManaging("busy");
    setError("");
    try {
      const text = await fn();
      setNotice(text);
      if (closeReader) {
        ++readGeneration.current;
        setMessage(null);
        setReading(false);
      }
      await refreshRows();
    } catch (e) {
      setError(errorText(e));
      await refreshRows().catch(() => {});
    } finally {
      setManaging("");
      setManageTarget("");
    }
  }
  const inTrash =
    !!message &&
    folders.some((f) => f.name === message.folder && f.role === "trash");
  function openMove() {
    if (!message) return;
    setMoveOptions([]);
    setMovePick("");
    setManageTarget("move");
    void api
      .foldersForMove(message.accountId, message.folder)
      .then(setMoveOptions)
      .catch((e) => setError(errorText(e)));
  }
  async function changePrefs(next: MailSettings) {
    setPrefs(next);
    try {
      setPrefs(await api.setSettings(next));
      // Saving a lower cap trims the cache on the Go side immediately.
      refreshCache();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function trimCacheNow() {
    try {
      setCache(await api.trimCache());
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function testMailto() {
    try {
      await api.openMailto(
        "mailto:hello@example.com?subject=My%20Mail%20%E6%B5%8B%E8%AF%95&body=%E8%BF%99%E6%98%AF%E4%B8%80%E6%9D%A1%20mailto%20%E6%B5%8B%E8%AF%95%E9%82%AE%E4%BB%B6",
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  // When the last page is shorter than the viewport there is nothing to
  // scroll, so keep pulling until the list can scroll or history is exhausted.
  useEffect(() => {
    if (
      !account ||
      !messages.length ||
      query.trim() ||
      busy ||
      loadingOlder ||
      olderError ||
      !moreAvailable
    )
      return;
    const node = messageScroll.current;
    if (!node || node.scrollHeight <= 0) return;
    if (
      node.scrollHeight - node.scrollTop - node.clientHeight <
      historyScrollThreshold
    )
      void loadOlder();
  }, [
    account,
    query,
    busy,
    loadingOlder,
    olderError,
    moreAvailable,
    rowLimit,
    messages,
  ]);
  return (
    <div className="mail-app">
      <aside className="mail-sidebar">
        <Button
          variant="primary"
          className="compose-button"
          disabled={!senderAccount || senderAccount.demo}
          onClick={() => {
            setComposeSeed(null);
            setComposeFresh(true);
            setCompose(true);
          }}
        >
          <PenLine size={15} />
          写邮件
        </Button>
        <UnifiedInboxes
          accounts={accounts}
          account={account}
          unified={unified}
          folder={folder}
          unread={desktop.accountUnread}
          onAll={chooseAll}
          onSelect={selectAccount}
        />
        {!unified && (
          <FolderSidebar
            key={account?.id || "empty"}
            accountID={account?.id || "empty"}
            folders={folders}
            active={folder}
            disabled={!!busy}
            onSelect={(name) => void chooseFolder(name)}
            inboxUnread={
              account ? desktop.accountUnread[account.id] : undefined
            }
          />
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-actions">
            <Button variant="ghost" onClick={() => setSettings(true)}>
              <Settings size={15} />
              账号设置
            </Button>
            <IconButton
              label={dark ? "浅色主题" : "深色主题"}
              onClick={() => setDark((v) => !v)}
            >
              {dark ? <Sun /> : <Moon />}
            </IconButton>
          </div>
        </div>
      </aside>
      <main className="mail-main">
        {(error || notice) && (
          <div
            className={"mail-feedback " + (error ? "error" : "")}
            role={error ? "alert" : "status"}
          >
            <span>{error || notice}</span>
            <IconButton
              size="xs"
              label="关闭提示"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X />
            </IconButton>
          </div>
        )}
        {!account ? (
          <div className="welcome">
            <span className="welcome-icon">
              <Mail size={28} />
            </span>
            <h2>添加邮箱</h2>
            <div className="welcome-actions">
              <Button variant="primary" onClick={() => setSettings(true)}>
                <Plus size={15} />
                添加邮箱
              </Button>
              <Button disabled={!!busy} onClick={() => void demo()}>
                打开本地示例
              </Button>
            </div>
          </div>
        ) : (
          <div className={"mail-workspace " + (message ? "has-message" : "")}>
            <section className="message-list" aria-label="邮件列表">
              <div className="list-toolbar">
                <strong>
                  {unified
                    ? "所有收件箱"
                    : folderTitle(
                        folders.find((f) => f.name === folder) ?? {
                          name: folder,
                          delimiter: "",
                          role: "",
                          selectable: true,
                        },
                      )}
                </strong>
                <span>{visible.length}</span>
                <IconButton
                  label={
                    busy || (unified && desktop.checking)
                      ? "正在同步"
                      : "刷新邮件"
                  }
                  disabled={!!busy || (unified && desktop.checking)}
                  onClick={() => void sync()}
                >
                  <RefreshCw
                    className={
                      busy || (unified && desktop.checking) ? "spinning" : ""
                    }
                  />
                </IconButton>
              </div>
              <div className="list-search">
                <Input
                  aria-label="搜索已缓存邮件"
                  icon={<Search size={14} />}
                  placeholder="搜索已缓存的邮件…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setRowLimit(50);
                    setScrollPos((p) => ({ ...p, top: 0 }));
                    if (messageScroll.current)
                      messageScroll.current.scrollTop = 0;
                  }}
                />
              </div>
              <div
                className="message-scroll"
                ref={messageScroll}
                onScroll={(event) => {
                  const node = event.currentTarget;
                  setScrollPos({
                    top: node.scrollTop,
                    height: node.clientHeight || 600,
                  });
                  if (query.trim()) {
                    if (
                      matching.length > rowLimit &&
                      node.scrollHeight - node.scrollTop - node.clientHeight <
                        historyScrollThreshold
                    )
                      setRowLimit((limit) => limit + 50);
                    return;
                  }
                  if (
                    moreAvailable &&
                    !olderError &&
                    node.scrollHeight - node.scrollTop - node.clientHeight <
                      historyScrollThreshold
                  )
                    void loadOlder();
                }}
              >
                <div
                  className="message-virtual"
                  style={{ height: totalRows * rowHeight }}
                  data-row-height={rowHeight}
                >
                  <div
                    className="message-window"
                    style={{
                      transform: `translateY(${firstRow * rowHeight}px)`,
                    }}
                  >
                    {windowRows.map((m) => (
                      <button
                        key={m.id}
                        style={{ height: rowHeight }}
                        className={
                          "message-row " +
                          (message?.id === m.id ? "active" : "")
                        }
                        aria-current={message?.id === m.id ? "true" : undefined}
                        onClick={() => void read(m)}
                      >
                        <span className="message-row-top">
                          {m.flagged && (
                            <Star
                              size={12}
                              fill="currentColor"
                              className="row-star"
                              aria-label="已加星标"
                            />
                          )}
                          <strong>
                            {m.from
                              .replace(/<.*>/, "")
                              .replaceAll('"', "")
                              .trim() || m.from}
                          </strong>
                          <time>{dateText(m.date)}</time>
                        </span>
                        <span className="message-subject">
                          {m.subject || "（无主题）"}
                        </span>
                        {unified && (
                          <span className="message-account">
                            {accounts.find((a) => a.id === m.accountId)
                              ?.email || "邮箱账号"}
                          </span>
                        )}
                        {!m.seen && (
                          <span className="unread-dot" aria-label="未读" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                {visible.length === 0 && (
                  <div className="list-empty">
                    <Inbox size={22} />
                    <p>{query ? "没有匹配的邮件" : "这里还没有邮件"}</p>
                    <small>
                      {query
                        ? "试试发件人或主题关键字"
                        : "点击列表右上角刷新邮件。"}
                    </small>
                  </div>
                )}
                {!query.trim() && (
                  <div className="history-footer">
                    {loadingOlder ? (
                      <span role="status">
                        <RefreshCw size={13} className="spinning" />
                        正在加载更早邮件…
                      </span>
                    ) : olderError ? (
                      <>
                        <p role="alert">{olderError}</p>
                        <Button size="sm" onClick={() => void loadOlder()}>
                          重试加载
                        </Button>
                      </>
                    ) : moreAvailable ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => void loadOlder()}
                      >
                        加载更早邮件
                      </Button>
                    ) : messages.length > 0 ? (
                      <span>已加载全部邮件</span>
                    ) : null}
                  </div>
                )}
              </div>
            </section>
            <section className="message-reader" aria-label="邮件正文">
              {message ? (
                <div className="reader-shell">
                  <div className="reader-actions">
                    <IconButton
                      className="reader-back"
                      label="返回邮件列表"
                      onClick={() => {
                        ++readGeneration.current;
                        setMessage(null);
                        setReading(false);
                      }}
                    >
                      <ArrowLeft />
                    </IconButton>
                    <IconButton
                      className="reader-action"
                      label="回复"
                      disabled={reading}
                      onClick={() => replyTo("reply")}
                    >
                      <Reply />
                    </IconButton>
                    <IconButton
                      className="reader-action"
                      label="回复全部"
                      disabled={reading}
                      onClick={() => replyTo("replyAll")}
                    >
                      <ReplyAll />
                    </IconButton>
                    <IconButton
                      className="reader-action"
                      label="转发"
                      disabled={reading}
                      onClick={() => replyTo("forward")}
                    >
                      <Forward />
                    </IconButton>
                    <span className="reader-action-divider" />
                    <IconButton
                      className={
                        "reader-action" + (message.flagged ? " flagged" : "")
                      }
                      label={message.flagged ? "取消星标" : "加星标"}
                      active={message.flagged}
                      disabled={reading || !!managing}
                      onClick={() =>
                        void runManage(
                          () => api.setFlagged(message.id, !message.flagged),
                          false,
                        )
                      }
                    >
                      <Star fill={message.flagged ? "currentColor" : "none"} />
                    </IconButton>
                    <IconButton
                      className="reader-action"
                      label={message.seen ? "标记为未读" : "标记为已读"}
                      disabled={reading || !!managing}
                      onClick={() =>
                        void runManage(
                          () => api.setSeen(message.id, !message.seen),
                          message.seen,
                        )
                      }
                    >
                      {message.seen ? <MailOpen /> : <Mail />}
                    </IconButton>
                    <IconButton
                      className="reader-action"
                      label="移动到文件夹"
                      disabled={reading || !!managing}
                      onClick={openMove}
                    >
                      <FolderInput />
                    </IconButton>
                    <IconButton
                      className="reader-action"
                      label={inTrash ? "永久删除" : "删除邮件"}
                      disabled={reading || !!managing}
                      onClick={() => setManageTarget("delete")}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                  <div className="reader-scroll" ref={readerScroll}>
                    <h1 className="reader-subject">
                      {message.subject || "（无主题）"}
                    </h1>
                    <article className="reader-card">
                      <header className="reader-card-header">
                        <div className="reader-sender">
                          <div className="reader-sender-row">
                            <strong>{senderName(message.from)}</strong>
                            <time>{dateTimeText(message.date)}</time>
                          </div>
                          <small className="reader-to">发至 {message.to}</small>
                          {senderName(message.from) !== message.from && (
                            <small className="reader-address">
                              {message.from}
                            </small>
                          )}
                        </div>
                      </header>
                      <div className="reader-card-body">
                        <div
                          className={
                            "remote-notice" + (remoteAllowed ? " trusted" : "")
                          }
                        >
                          {remoteAllowed ? (
                            <ShieldCheck size={13} />
                          ) : (
                            <ShieldAlert size={13} />
                          )}
                          <span>
                            {remoteAllowed
                              ? `可信发件人${trustNote ? `（${trustNote}）` : ""} · 已自动加载远程图片，保留原始排版`
                              : "发件人未信任 · 已阻止远程图片，按安全排版显示"}
                          </span>
                          {!reading && message.cached && (
                            <div className="remote-actions">
                              {remoteAllowed ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setRemote(false, false)}
                                  >
                                    本邮件不加载
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRemote(false, true)}
                                  >
                                    总是阻止
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setRemote(true, false)}
                                  >
                                    加载图片
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRemote(true, true)}
                                  >
                                    {trustScope
                                      ? `信任 ${trustScope}`
                                      : "信任发件人"}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        {reading ? (
                          <div className="reader-placeholder">
                            正在获取邮件正文…
                          </div>
                        ) : message.cached ? (
                          <>
                            {message.html ? (
                              <MailFrame
                                title="隔离的邮件正文"
                                doc={mailDocument(message.html, {
                                  dark,
                                  remote: remoteAllowed,
                                  rich: trustedSender,
                                })}
                                onOpenLink={(href) => {
                                  setNotice(
                                    remoteAllowed
                                      ? "正在用系统浏览器打开链接…"
                                      : "发件人未信任：已按你的点击在系统浏览器打开该链接，远程图片仍未加载。",
                                  );
                                  api
                                    .openLink(href)
                                    .then(() => {
                                      if (remoteAllowed) setNotice("");
                                    })
                                    .catch((e) => setError(errorText(e)));
                                }}
                              />
                            ) : (
                              <pre className="plain-body">
                                {message.text || "这封邮件没有可显示的正文。"}
                              </pre>
                            )}
                            {message.attachments?.length > 0 && (
                              <div className="attachment-list">
                                {message.attachments.map((file) => (
                                  <div
                                    className="attachment-row"
                                    key={file.index}
                                  >
                                    <Paperclip size={14} />
                                    <span
                                      className="attachment-name"
                                      title={file.name}
                                    >
                                      {file.name || "未命名附件"}
                                    </span>
                                    {/* A row cached by an older build has no
                                        size until its bytes are fetched. */}
                                    {file.size > 0 && (
                                      <span className="attachment-size">
                                        {fileSize(file.size)}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="attachment-save"
                                      disabled={savingAttachment !== null}
                                      onClick={() =>
                                        void saveAttachment(message, file.index)
                                      }
                                    >
                                      {savingAttachment === file.index
                                        ? "保存中…"
                                        : "保存"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="reader-placeholder">
                            正文尚未获取，可重新点击邮件重试。
                          </div>
                        )}
                      </div>
                    </article>
                  </div>
                </div>
              ) : (
                <div className="reader-empty">
                  <span className="reader-empty-icon">
                    <Mail size={26} />
                  </span>
                  <h2>选择一封邮件</h2>
                  <p>选择左侧的邮件，在这里阅读。</p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      <Modal
        open={settings}
        onOpenChange={setSettings}
        title="设置"
        description="邮箱账号、通知、邮件偏好与本机缓存"
        size="md"
        footer={
          // Preferences apply immediately; the button only closes the dialog so
          // there is an explicit way out besides Esc / the title-bar close.
          <Button variant="primary" onClick={() => setSettings(false)}>
            完成
          </Button>
        }
      >
        <DesktopPreferences state={desktop} onChange={acceptDesktop} />
        <MailPreferences
          prefs={prefs}
          pending={pendingOps}
          cache={cache}
          onChange={changePrefs}
          onTrim={() => void trimCacheNow()}
          onTestMailto={() => void testMailto()}
        />
        <AccountForm
          accounts={accounts}
          active={account?.id}
          database={database}
          onSelect={(a) => {
            selectAccount(a);
            setSettings(false);
          }}
          onAdded={(a) => {
            setAccounts((as) => [...as, a]);
            setUnified(false);
            rememberScope(`account:${a.id}`);
            setAccount(a);
            setSettings(false);
            setNotice("账号已保存，点击刷新邮件开始同步。");
          }}
        />
      </Modal>
      <Modal
        open={manageTarget === "move"}
        onOpenChange={(open) => {
          if (!open) setManageTarget("");
        }}
        title="移动到文件夹"
        description="选中目标文件夹后点「移动」，本地立即生效，联网后同步到服务器"
        size="sm"
        footer={
          <>
            <Button disabled={!!managing} onClick={() => setManageTarget("")}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!movePick || !!managing}
              onClick={() => {
                if (!message || !movePick) return;
                void runManage(
                  () => api.moveMessage(message.id, movePick),
                  true,
                );
              }}
            >
              <FolderInput size={14} aria-hidden="true" />
              移动
            </Button>
          </>
        }
      >
        <div
          className="folder-picker"
          role="radiogroup"
          aria-label="目标文件夹"
          onKeyDown={(event) => {
            const keys = [
              "ArrowDown",
              "ArrowRight",
              "ArrowUp",
              "ArrowLeft",
              "Home",
              "End",
            ];
            if (!keys.includes(event.key) || managing || !moveOptions.length)
              return;
            event.preventDefault();
            const current = moveOptions.findIndex((f) => f.name === movePick);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? moveOptions.length - 1
                  : (current +
                      (event.key === "ArrowUp" || event.key === "ArrowLeft"
                        ? -1
                        : 1) +
                      moveOptions.length) %
                    moveOptions.length;
            setMovePick(moveOptions[next].name);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role="radio"]')
              [next]?.focus();
          }}
        >
          {moveOptions.length === 0 ? (
            <p className="folder-picker-empty">正在读取文件夹…</p>
          ) : (
            moveOptions.map((f) => (
              <button
                key={f.name}
                type="button"
                role="radio"
                aria-checked={movePick === f.name}
                tabIndex={
                  movePick === f.name || (!movePick && f === moveOptions[0])
                    ? 0
                    : -1
                }
                className={
                  "folder-picker-item" +
                  (movePick === f.name ? " selected" : "")
                }
                disabled={!!managing}
                onClick={() => setMovePick(f.name)}
              >
                <FolderInput size={15} aria-hidden="true" />
                <span>{folderTitle(f)}</span>
                <Check
                  size={14}
                  className="folder-picker-check"
                  aria-hidden="true"
                />
              </button>
            ))
          )}
        </div>
      </Modal>
      <Modal
        open={manageTarget === "delete"}
        onOpenChange={(open) => {
          if (!open) setManageTarget("");
        }}
        title={inTrash ? "永久删除这封邮件？" : "删除这封邮件？"}
        description={
          inTrash
            ? "该操作会从服务器上移除，不能撤销。"
            : "邮件会被移到已删除文件夹，可在该文件夹里再次删除。"
        }
        size="sm"
        role="alertdialog"
        initialFocus={cancelDeleteRef}
        footer={
          <>
            <Button
              ref={cancelDeleteRef}
              disabled={!!managing}
              onClick={() => setManageTarget("")}
            >
              取消
            </Button>
            <Button
              variant="danger"
              disabled={!!managing}
              onClick={() => {
                if (!message) return;
                void runManage(
                  () => api.deleteMessage(message.id, inTrash),
                  true,
                );
              }}
            >
              <Trash2 size={14} />
              {inTrash ? "永久删除" : "删除"}
            </Button>
          </>
        }
      >
        <p className="confirm-copy">{message?.subject || "（无主题）"}</p>
      </Modal>
      {senderAccount && (
        <Compose
          open={compose}
          account={senderAccount}
          seed={composeSeed}
          fresh={composeFresh}
          draftKey={composeSeed?.key || "new"}
          dark={dark}
          quoteRich={trustedSender}
          onClose={() => {
            setCompose(false);
            setComposeSeed(null);
          }}
          onSent={(text) => {
            setCompose(false);
            setComposeSeed(null);
            setNotice(text);
          }}
        />
      )}
    </div>
  );
}

function DesktopPreferences({
  state,
  onChange,
}: {
  state: DesktopState;
  onChange: (state: DesktopState) => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function toggle(enabled: boolean) {
    setBusy(true);
    setMessage("");
    try {
      onChange(await api.setNotifications(enabled));
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMessage("");
    try {
      await api.testNotification();
      setMessage("测试通知已发送");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="desktop-preferences">
      <div>
        <label>
          <input
            type="checkbox"
            checked={state.notifications}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          新邮件通知
        </label>
        <Button
          size="sm"
          disabled={busy || !state.notifications}
          onClick={() => void test()}
        >
          测试通知
        </Button>
      </div>
      {(message ||
        state.notificationStatus === "denied" ||
        state.lastError) && (
        <p role="status">
          {message ||
            (state.notificationStatus === "denied"
              ? "请在系统设置中允许 My Mail 通知"
              : state.notificationStatus === "pending"
                ? "请处理系统通知授权提示"
                : state.lastError)}
        </p>
      )}
    </section>
  );
}

function MailPreferences({
  prefs,
  pending,
  cache,
  onChange,
  onTrim,
  onTestMailto,
}: {
  prefs: MailSettings;
  pending: number;
  cache: CacheStats;
  onChange: (next: MailSettings) => void;
  onTrim: () => void;
  onTestMailto: () => void;
}) {
  return (
    <section className="mail-preferences" aria-label="邮件偏好设置">
      <div className="pref-row">
        <label htmlFor="pref-interval">检查新邮件间隔</label>
        <select
          id="pref-interval"
          className="pref-select"
          value={prefs.syncIntervalSec}
          onChange={(e) =>
            onChange({ ...prefs, syncIntervalSec: Number(e.target.value) })
          }
        >
          {[15, 30, 60, 120, 300].map((seconds) => (
            <option key={seconds} value={seconds}>
              {seconds < 60 ? `${seconds} 秒` : `${seconds / 60} 分钟`}
            </option>
          ))}
        </select>
      </div>
      <div className="pref-row">
        <label htmlFor="pref-remote">远程图片</label>
        <select
          id="pref-remote"
          className="pref-select"
          value={prefs.remoteDefault}
          onChange={(e) =>
            onChange({ ...prefs, remoteDefault: e.target.value })
          }
        >
          <option value="trusted">仅可信发件人自动加载</option>
          <option value="always">全部自动加载</option>
          <option value="never">全部阻止，手动加载</option>
        </select>
      </div>
      <label className="pref-check">
        <input
          type="checkbox"
          checked={prefs.autoMarkRead}
          onChange={(e) =>
            onChange({ ...prefs, autoMarkRead: e.target.checked })
          }
        />
        打开邮件后自动标记为已读
      </label>
      <label className="pref-check">
        <input
          type="checkbox"
          checked={prefs.appendSent}
          onChange={(e) => onChange({ ...prefs, appendSent: e.target.checked })}
        />
        发送后把副本追加到服务器「已发送」
      </label>
      <div className="pref-row">
        <label htmlFor="pref-cache">本机缓存上限</label>
        <select
          id="pref-cache"
          className="pref-select"
          value={prefs.cacheLimit}
          onChange={(e) =>
            onChange({ ...prefs, cacheLimit: Number(e.target.value) })
          }
        >
          <option value={500}>每个文件夹保留 500 封</option>
          <option value={2000}>每个文件夹保留 2000 封</option>
          <option value={5000}>每个文件夹保留 5000 封</option>
          <option value={0}>不限制</option>
        </select>
      </div>
      <div className="pref-row">
        <span role="status" className="pref-cache-stats">
          已缓存 {cache.messages} 封 · 正文 {byteText(cache.headerBytes)} · 附件{" "}
          {cache.attachments} 个 / {byteText(cache.attachmentBytes)}
        </span>
        <Button size="sm" variant="ghost" onClick={onTrim}>
          立即清理
        </Button>
      </div>
      <div className="pref-row">
        <span>mailto 深链</span>
        <Button size="sm" variant="ghost" onClick={onTestMailto}>
          测试写信窗口
        </Button>
      </div>
      <p className="pref-note">
        每个账号的每个文件夹按上限保留最新的邮件头与正文，附件一并清除；等待同步到服务器的操作不会被清理。把
        My Mail 设为系统默认邮件阅读器后，点击网页里的 mailto
        链接会直接打开写信窗口。仅当服务商不会自动保存 SMTP
        副本时才需要开启「已发送」追加，否则会产生重复。
        {pending > 0 ? ` 当前有 ${pending} 项操作等待同步到服务器。` : ""}
      </p>
    </section>
  );
}

async function testConnectionWithDeadline(
  form: AccountInput,
  protocol: string,
  requestID: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      api.testConnection(form, protocol, requestID),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${protocol.toUpperCase()} 测试未返回，请重试并查看诊断日志`,
              ),
            ),
          18000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function AccountForm({
  accounts,
  active,
  database,
  onSelect,
  onAdded,
}: {
  accounts: Account[];
  active?: string;
  database: string;
  onSelect: (a: Account) => void;
  onAdded: (a: Account) => void;
}) {
  const [form, setForm] = useState<AccountInput>(emptyAccount),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stage, setStage] = useState(""),
    [logPath, setLogPath] = useState("");
  useEffect(() => {
    api
      .logPath()
      .then(setLogPath)
      .catch(() => {});
  }, []);
  const patch = <K extends keyof AccountInput>(
    key: K,
    value: AccountInput[K],
  ) => setForm((f) => ({ ...f, [key]: value }));
  function preset(provider: string) {
    const presets: Record<string, [string, string]> = {
      qq: ["imap.qq.com", "smtp.qq.com"],
      "163": ["imap.163.com", "smtp.163.com"],
      gmail: ["imap.gmail.com", "smtp.gmail.com"],
    };
    const hosts = presets[provider];
    if (hosts)
      setForm((f) => ({
        ...f,
        imapHost: hosts[0],
        smtpHost: hosts[1],
        imapPort: 993,
        smtpPort: 465,
        imapTLS: "tls",
        smtpTLS: "tls",
      }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const requestID =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      setStage("正在测试 IMAP（最多 15 秒）…");
      await testConnectionWithDeadline(form, "imap", requestID);
      setStage("IMAP 已通过，正在测试 SMTP（最多 15 秒）…");
      await testConnectionWithDeadline(form, "smtp", requestID);
      setStage("连接已通过，正在保存到系统钥匙串，请留意系统解锁提示…");
      const a = await api.saveAccount(form, requestID);
      setForm(emptyAccount);
      onAdded(a);
    } catch (e) {
      const detail = errorText(e);
      setError(
        detail.includes(requestID)
          ? detail
          : detail + " · 测试编号：" + requestID,
      );
      setForm((f) => ({ ...f, password: "" }));
    } finally {
      setBusy(false);
      setStage("");
    }
  }
  return (
    <div className="account-form">
      {accounts.length > 0 && (
        <div className="account-list">
          {accounts.map((a) => (
            <button disabled={busy} key={a.id} onClick={() => onSelect(a)}>
              <Mail size={15} />
              <span>{a.email}</span>
              <small>
                {a.id === active ? "当前账号" : a.demo ? "本地示例" : "切换"}
              </small>
            </button>
          ))}
        </div>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          <Field label="服务商" htmlFor="provider">
            <select
              id="provider"
              className="native-select"
              onChange={(e) => preset(e.target.value)}
            >
              <option value="qq">QQ 邮箱</option>
              <option value="163">163 邮箱</option>
              <option value="gmail">Gmail（需应用密码）</option>
              <option value="custom">自定义 IMAP / SMTP</option>
            </select>
          </Field>
          <Field label="邮箱地址" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              autoComplete="username"
              placeholder="you@qq.com"
              value={form.email}
              onChange={(e) => patch("email", e.target.value)}
            />
          </Field>
          <Field
            label="授权码 / 应用密码"
            htmlFor="password"
            hint="先在服务商网页开启 IMAP。Outlook 需 OAuth2，此原型暂不支持。"
          >
            <Input
              id="password"
              type="password"
              required
              autoComplete="off"
              value={form.password}
              onChange={(e) => patch("password", e.target.value)}
            />
          </Field>
          <div className="server-grid">
            {(["imap", "smtp"] as const).map((kind) => (
              <div className="server-card" key={kind}>
                <b>{kind.toUpperCase()}</b>
                <Field label="服务器" htmlFor={kind + "host"}>
                  <Input
                    id={kind + "host"}
                    required
                    value={kind === "imap" ? form.imapHost : form.smtpHost}
                    onChange={(e) =>
                      patch(
                        kind === "imap" ? "imapHost" : "smtpHost",
                        e.target.value,
                      )
                    }
                  />
                </Field>
                <div className="server-options">
                  <Field label="端口" htmlFor={kind + "port"}>
                    <Input
                      id={kind + "port"}
                      type="number"
                      min={1}
                      max={65535}
                      required
                      value={kind === "imap" ? form.imapPort : form.smtpPort}
                      onChange={(e) =>
                        patch(
                          kind === "imap" ? "imapPort" : "smtpPort",
                          Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <Field label="加密" htmlFor={kind + "tls"}>
                    <select
                      id={kind + "tls"}
                      className="native-select"
                      value={kind === "imap" ? form.imapTLS : form.smtpTLS}
                      onChange={(e) =>
                        patch(
                          kind === "imap" ? "imapTLS" : "smtpTLS",
                          e.target.value,
                        )
                      }
                    >
                      <option value="tls">TLS</option>
                      <option value="starttls">STARTTLS</option>
                    </select>
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? (
            <RefreshCw size={14} className="spinning" />
          ) : (
            <ShieldCheck size={14} />
          )}{" "}
          {busy ? "处理中…" : "测试连接并保存"}
        </Button>
        {stage && (
          <p className="storage-path" role="status">
            {stage}
          </p>
        )}
      </form>
      <p className="storage-path">
        凭证保存到系统钥匙串。数据库：
        <br />
        {database}
        <br />
        诊断日志：{logPath || "正在读取…"}
      </p>
    </div>
  );
}

// The quote renders in a sandboxed frame, whose height cannot be measured
// from the page. Estimate it from the plain text so a short quote does not
// leave a tall empty box, and cap it so a long one scrolls inside the card.
function quoteFrameHeight(quote: ComposeQuote) {
  const lines = (quote.text || "")
    .split("\n")
    .reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / 44)),
      0,
    );
  return Math.min(240, Math.max(88, lines * 21 + 44));
}

function Compose({
  open,
  account,
  seed,
  fresh,
  draftKey,
  dark,
  quoteRich,
  onClose,
  onSent,
}: {
  open: boolean;
  account: Account;
  seed?: ComposeSeed | null;
  /** “写邮件”: start blank instead of restoring the stored draft. */
  fresh?: boolean;
  /** One draft slot per message, so no reply overwrites another. */
  draftKey: string;
  dark: boolean;
  quoteRich: boolean;
  onClose: () => void;
  onSent: (text: string) => void;
}) {
  const emptyDraft = (key: string): Draft => ({
      accountId: account.id,
      key,
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "",
      attachments: [],
    }),
    [draft, setDraft] = useState<Draft>(() => emptyDraft(draftKey || "new")),
    [content, setContent] = useState(""),
    [quote, setQuote] = useState<ComposeQuote | null>(null),
    [quoteOpen, setQuoteOpen] = useState(true),
    // A stored draft that a blank window is *not* showing, offered instead of
    // silently replacing it the moment the reader starts typing.
    [kept, setKept] = useState<Draft | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [picking, setPicking] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const sending = useRef(false);
  const canSend =
    open && ready && !busy && !picking && !!draft.to.trim() && !account.demo;
  const queue = useRef(Promise.resolve()),
    // Nothing is written to the stored draft until the reader actually types:
    // peeking at a reply and closing it must not overwrite what is saved.
    touched = useRef(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setReady(false);
    setError("");
    setQuoteOpen(true);
    setKept(null);
    touched.current = false;
    const key = draftKey || "new";
    if (seed) {
      setDraft({
        ...seed.draft,
        key,
        bcc: seed.draft.bcc ?? "",
        attachments: seed.draft.attachments ?? [],
      });
      setContent(seed.content);
      setQuote(seed.quote);
      setStatus("");
      setReady(true);
      // Each reply has its own slot now, so the stored draft belongs to this
      // message by construction. The legacy "new" slot still needs the
      // attribution check before it is put back into a reply window.
      api
        .getDraft(account.id, key)
        .then((d) => {
          if (!live) return;
          if (draftHasContent(d)) {
            const resumed = seed.noResume
              ? null
              : key === "new"
                ? resumeDraft(d, seed)
                : d;
            if (resumed) {
              const split = splitComposeBody(d.body);
              setDraft({
                ...resumed,
                key,
                body: composeBody(split.content, seed.quote ?? split.quote),
              });
              setContent(split.content);
              setQuote(seed.quote ?? split.quote);
              setStatus("已恢复上次未写完的内容");
              return;
            }
            setKept(d);
          }
        })
        .catch(() => {});
      return () => {
        live = false;
      };
    }
    if (fresh) {
      setDraft(emptyDraft("new"));
      setContent("");
      setQuote(null);
      setStatus("");
      setReady(true);
      api
        .getDraft(account.id, "new")
        .then((d) => {
          if (live && draftHasContent(d)) setKept(d);
        })
        .catch(() => {});
      return () => {
        live = false;
      };
    }
    api
      .getDraft(account.id, key)
      .then((d) => {
        if (!live) return;
        const split = splitComposeBody(d.body);
        setDraft({ ...d, key, body: composeBody(split.content, split.quote) });
        setContent(split.content);
        setQuote(split.quote);
        setReady(true);
        setStatus("草稿保存在本机");
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [open, account.id, seed, fresh, draftKey]);
  function persist(next: Draft) {
    setDraft(next);
    // The stored draft is being replaced from here on, so the offer to bring
    // it back no longer matches what is saved.
    setKept(null);
    setStatus("正在保存…");
    queue.current = queue.current
      .catch(() => {})
      .then(() => api.saveDraft(next))
      .then(() => setStatus("草稿已保存"))
      .catch((e) => {
        setError(errorText(e));
        setStatus("草稿保存失败");
        throw e;
      });
    void queue.current.catch(() => {});
  }
  function change(
    field: "to" | "cc" | "bcc" | "subject" | "body",
    value: string,
  ) {
    const nextContent = field === "body" ? value : content;
    if (field === "body") setContent(value);
    touched.current = true;
    persist({
      ...draft,
      [field]: value,
      body: composeBody(nextContent, quote),
    });
  }
  function setAttachments(next: DraftAttachment[]) {
    touched.current = true;
    persist({ ...draft, attachments: next });
  }
  async function addAttachments() {
    if (picking) return;
    setPicking(true);
    setError("");
    try {
      const picked = await api.pickAttachments();
      if (!picked.length) return;
      const merged = [...(draft.attachments ?? [])];
      for (const file of picked) {
        if (!merged.some((old) => old.path === file.path)) merged.push(file);
      }
      setAttachments(merged);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPicking(false);
    }
  }
  function restoreKept() {
    if (!kept) return;
    const split = splitComposeBody(kept.body);
    setDraft({
      ...kept,
      key: kept.key || "new",
      body: composeBody(split.content, split.quote),
    });
    setContent(split.content);
    setQuote(split.quote);
    setKept(null);
    setStatus("已载入本机的草稿");
  }
  async function close() {
    if (busy) return;
    if (!touched.current) {
      onClose();
      return;
    }
    const next = { ...draft, body: composeBody(content, quote) };
    queue.current = queue.current
      .catch(() => {})
      .then(() => api.saveDraft(next))
      .catch((e) => {
        setError(errorText(e));
        throw e;
      });
    try {
      await queue.current;
      onClose();
    } catch {
      setError("草稿保存失败，请保留窗口并重试。");
    }
  }
  async function send() {
    if (
      !canSend ||
      sending.current ||
      form.current?.querySelector('[aria-invalid="true"]')
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      await queue.current;
      const text = await api.send({
        ...draft,
        body: composeBody(content, quote),
      });
      setDraft(emptyDraft(draftKey || "new"));
      onSent(text);
    } catch (e) {
      setError(errorText(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) void close();
      }}
      title={
        quote ? (quote.kind === "forward" ? "转发邮件" : "回复邮件") : "新邮件"
      }
      description={"从 " + account.email + " 发送纯文本邮件"}
      size="lg"
      dismissOnOverlay={false}
      onKeyDown={(event) => {
        if (
          event.key !== "Enter" ||
          !(event.metaKey || event.ctrlKey) ||
          event.nativeEvent.isComposing
        )
          return;
        event.preventDefault();
        if (event.repeat || sending.current) return;
        // Commit a pending recipient before requesting the form submission.
        if (event.target instanceof HTMLInputElement) event.target.blur();
        window.setTimeout(() => form.current?.requestSubmit(), 0);
      }}
      footer={
        <>
          <span className="compose-from" title={account.email}>
            发件人：{account.email}
          </span>
          <span className="draft-status" role="status">
            {status}
          </span>
          <Button disabled={busy} onClick={() => void close()}>
            保存并关闭
          </Button>
          <Button
            variant="primary"
            disabled={!canSend}
            type="submit"
            form={formId}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            title="发送邮件（⌘/Ctrl + Enter）"
          >
            <Send size={14} />
            {busy ? "正在发送…" : "发送邮件"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={form}
        className="compose-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        onKeyDown={(event) => {
          // Single-line fields must never implicitly send a message.
          if (
            event.key === "Enter" &&
            !event.metaKey &&
            !event.ctrlKey &&
            event.target instanceof HTMLInputElement
          )
            event.preventDefault();
        }}
      >
        {kept && (
          <div className="draft-restore">
            <FileText size={13} />
            <span>
              本机还存着一份草稿
              {kept.subject.trim() ? `（${kept.subject.trim()}）` : ""}
            </span>
            <button type="button" onClick={restoreKept}>
              继续编辑
            </button>
          </div>
        )}
        <div className="recipient-group">
          <div className="recipient-row">
            <label htmlFor="compose-to">收件人</label>
            <ChipInput
              id="compose-to"
              value={draft.to}
              disabled={!ready || busy}
              placeholder="输入邮箱后回车，可添加多个"
              onChange={(value) => change("to", value)}
            />
          </div>
          <div className="recipient-row">
            <label htmlFor="compose-cc">抄送</label>
            <ChipInput
              id="compose-cc"
              value={draft.cc}
              disabled={!ready || busy}
              placeholder="可选"
              onChange={(value) => change("cc", value)}
            />
          </div>
          <div className="recipient-row">
            <label htmlFor="compose-bcc">密送</label>
            <ChipInput
              id="compose-bcc"
              value={draft.bcc ?? ""}
              disabled={!ready || busy}
              placeholder="可选，不会显示给其他收件人"
              onChange={(value) => change("bcc", value)}
            />
          </div>
          <div className="recipient-row">
            <label htmlFor="compose-subject">主题</label>
            <input
              id="compose-subject"
              className="recipient-input"
              disabled={!ready || busy}
              value={draft.subject}
              placeholder="邮件主题"
              onChange={(e) => change("subject", e.target.value)}
            />
          </div>
        </div>
        <div className="compose-attachments">
          <div className="compose-attachments-head">
            <Button
              size="sm"
              type="button"
              disabled={!ready || busy || picking}
              onClick={() => void addAttachments()}
            >
              <Paperclip size={14} />
              {picking ? "正在选择…" : "添加附件"}
            </Button>
            <small>单个不超过 10 MB，合计不超过 25 MB</small>
          </div>
          {(draft.attachments ?? []).length > 0 && (
            <ul className="compose-attachment-list">
              {(draft.attachments ?? []).map((file) => (
                <li key={file.path}>
                  <Paperclip size={13} />
                  <span className="attachment-name" title={file.path}>
                    {file.name}
                  </span>
                  <span className="attachment-size">{fileSize(file.size)}</span>
                  <button
                    type="button"
                    aria-label={"移除 " + file.name}
                    disabled={busy}
                    onClick={() =>
                      setAttachments(
                        (draft.attachments ?? []).filter(
                          (item) => item.path !== file.path,
                        ),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Field
          label={quote?.kind === "reply" ? "回复内容" : "正文"}
          htmlFor="compose-body"
        >
          <Textarea
            id="compose-body"
            disabled={!ready || busy}
            rows={quote ? 6 : 12}
            value={content}
            placeholder={
              quote?.kind === "reply" ? "在此输入回复内容…" : "写下你想说的…"
            }
            onChange={(e) => change("body", e.target.value)}
          />
        </Field>
        {quote && (
          <section
            className={
              "quote-card " +
              (quote.kind === "forward" ? "quote-forward" : "quote-reply")
            }
          >
            <header className="quote-card-head">
              {quote.kind === "reply" ? (
                <>
                  <span
                    className="sender-avatar quote-avatar"
                    aria-hidden="true"
                  >
                    {senderName(quote.from).slice(0, 1).toUpperCase() || "?"}
                  </span>
                  <p className="quote-line">
                    <strong>{senderName(quote.from)}</strong>
                    <span>{quote.date} 写道：</span>
                    {addressOf(quote.from) !== senderName(quote.from) && (
                      <small>{addressOf(quote.from)}</small>
                    )}
                  </p>
                </>
              ) : (
                <div className="quote-meta">
                  <p className="quote-line">
                    <strong>转发的原邮件</strong>
                  </p>
                  <dl className="quote-fields">
                    <div>
                      <dt>发件人</dt>
                      <dd>{quote.from}</dd>
                    </div>
                    <div>
                      <dt>时间</dt>
                      <dd>{quote.date}</dd>
                    </div>
                    <div>
                      <dt>收件人</dt>
                      <dd>{quote.to || "（未知）"}</dd>
                    </div>
                    <div>
                      <dt>主题</dt>
                      <dd>{quote.subject || "（无主题）"}</dd>
                    </div>
                  </dl>
                </div>
              )}
              <button
                type="button"
                className="quote-toggle"
                aria-expanded={quoteOpen}
                onClick={() => setQuoteOpen((value) => !value)}
              >
                {quoteOpen ? "收起引用" : "展开引用"}
              </button>
            </header>
            {quoteOpen && (
              <div className="quote-body">
                {quote.html ? (
                  <iframe
                    title="引用的原邮件"
                    sandbox=""
                    referrerPolicy="no-referrer"
                    style={{ height: quoteFrameHeight(quote) }}
                    srcDoc={mailDocument(quote.html, {
                      dark,
                      rich: quoteRich,
                      compact: true,
                      linkable: false,
                    })}
                  />
                ) : (
                  <pre className="quote-text">{quote.text}</pre>
                )}
              </div>
            )}
            <footer className="quote-foot">
              <span>引用只读，其中的远程图片不加载</span>
              <span>
                {quote.kind === "reply"
                  ? "发送时按纯文本引用，每行加 > 前缀"
                  : "发送时保留上方的邮件信息"}
              </span>
            </footer>
          </section>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <small>纯文本写信 · 草稿自动保存到本机 · 附件在发送时由本机读取</small>
      </form>
    </Modal>
  );
}
