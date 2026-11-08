import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Languages, MoreHorizontal, RefreshCw } from "lucide-react";
import { MailService as api, type TranslationResult } from "../mygo";
import { Modal } from "./ui/modal";
import { Segmented } from "./ui/segmented";
import { DropdownMenu, MenuItem, MenuSeparator } from "./ui/dropdown-menu";
import { IconButton } from "./ui/icon-button";
import { MailFrame } from "./mail-frame";
import { mailDocument } from "../mail-html";
import { Button } from "./ui/button";
import { t, useLocale } from "../lib/i18n";

export function MessageTranslation({
  messageId,
  enabled = true,
  trusted = false,
  remote = false,
  dark = false,
  subject = "",
  html = "",
  text = "",
  children,
}: {
  messageId: string;
  enabled?: boolean;
  trusted?: boolean;
  children?: ReactNode;
  remote?: boolean;
  dark?: boolean;
  subject?: string;
  html?: string;
  text?: string;
}) {
  useLocale();
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"original" | "translated">("translated");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const id = active.current;
      active.current = null;
      if (id) void api.cancelTranslation(id).catch(() => {});
    };
  }, [messageId, enabled]);
  async function translate() {
    if (active.current || !enabled) return;
    const request = crypto.randomUUID();
    active.current = request;
    setBusy(true);
    setError("");
    try {
      const translated = await api.translateMessage(messageId, request);
      if (mounted.current && active.current === request) {
        setResult(translated);
        setView("translated");
      }
    } catch (error) {
      if (mounted.current && active.current === request)
        setError(
          error instanceof Error
            ? error.message === "翻译已取消"
              ? ""
              : error.message
            : "翻译失败，请检查系统语言包后重试。",
        );
    } finally {
      if (mounted.current && active.current === request) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  function cancel() {
    const request = active.current;
    active.current = null;
    setBusy(false);
    setError("");
    if (request) void api.cancelTranslation(request).catch(() => {});
  }
  const shownHTML = view === "original" ? html : result?.html || "";
  const doc = useMemo(
    () =>
      shownHTML ? mailDocument(shownHTML, { dark, remote, rich: trusted }) : "",
    [shownHTML, dark, remote, trusted],
  );
  function changeOpen(value: boolean) {
    setOpen(value);
    if (!value) cancel();
  }
  return (
    <>
      <DropdownMenu
        trigger={
          <IconButton label={t("更多操作")}>
            <MoreHorizontal />
          </IconButton>
        }
      >
        {children}
        {enabled && (
          <>
            <MenuSeparator />
            <MenuItem
              icon={Languages}
              onSelect={() => {
                setOpen(true);
                if (!result) void translate();
              }}
            >
              {t("翻译为中文")}
            </MenuItem>
          </>
        )}
      </DropdownMenu>
      <Modal
        open={open}
        onOpenChange={changeOpen}
        title={t("邮件翻译")}
        size="lg"
        className="translation-modal"
      >
        <div className="translation-toolbar">
          <Segmented
            aria-label={t("邮件翻译")}
            value={view}
            onValueChange={setView}
            options={[
              { value: "original", label: t("原文") },
              { value: "translated", label: t("中文译文") },
            ]}
          />
          {busy && (
            <Button size="sm" variant="ghost" onClick={cancel}>
              {t("取消")}
            </Button>
          )}
          {!busy && !result && !error && (
            <Button size="sm" onClick={() => void translate()}>
              {t("重试")}
            </Button>
          )}
        </div>
        {busy && (
          <p className="translation-note" role="status">
            <RefreshCw size={14} className="spinning" /> {t("正在翻译…")}
            {t("首次使用可能需要下载英中语言包，可在系统提示中确认。")}
          </p>
        )}
        {error && (
          <div className="translation-error">
            <p className="form-error" role="alert">
              {t(error)}
            </p>
            <Button size="sm" onClick={() => void translate()}>
              {t("重试")}
            </Button>
          </div>
        )}
        {(view === "original" || result) && (
          <div className="translation-result">
            <h3>{view === "original" ? subject : result?.subject}</h3>
            {doc ? (
              <MailFrame
                title={view === "original" ? t("原文") : t("中文译文")}
                doc={doc}
                onOpenLink={(href) => {
                  void api.openLink(href).catch(() => setError("无法打开链接"));
                }}
              />
            ) : (
              <pre>{view === "original" ? text : result?.text}</pre>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
