import { t } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, RefreshCw, Trash2 } from "lucide-react";
import { MailService as api, type Account, type Draft } from "../mygo";
import { draftHasContent, splitComposeBody } from "../lib/reply";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { Modal } from "./ui/modal";

export function DraftManager({
  accounts,
  onClose,
  onResume,
}: {
  accounts: Account[];
  onClose: () => void;
  onResume: (draft: Draft, account: Account) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [target, setTarget] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    Promise.allSettled(accounts.map((a) => api.listDrafts(a.id))).then(
      (results) => {
        if (!live) return;
        const rows: Draft[] = [];
        const failures: string[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled")
            rows.push(...result.value.filter(draftHasContent));
          else failures.push(accounts[index].email);
        });
        setDrafts(rows);
        if (failures.length)
          setError(`无法读取以下邮箱的本地草稿：${failures.join("、")}`);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [accounts, revision]);

  async function remove() {
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.clearDraft(target.accountId, target.key || "new");
      setDrafts((rows) =>
        rows.filter(
          (d) =>
            d.accountId !== target.accountId ||
            (d.key || "new") !== (target.key || "new"),
        ),
      );
      setTarget(null);
    } catch {
      setDeleteError("删除失败，草稿已保留，请重试。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !deleting) onClose();
        }}
        title={t("本地草稿")}
        description={t("查看、继续编辑或删除本机保存的草稿，不影响服务器草稿")}
        size="md"
        footer={
          <Button onClick={onClose} disabled={deleting}>
            {t("完成")}
          </Button>
        }
      >
        <div className="draft-manager">
          {loading && (
            <p role="status">
              <RefreshCw size={14} className="spinning" />
              {t("正在读取草稿…")}
            </p>
          )}
          {error && (
            <div className="draft-list-error">
              <p role="alert">{t(error)}</p>
              <Button
                size="sm"
                onClick={() => setRevision((v) => v + 1)}
                disabled={loading}
              >
                {t("重试读取")}
              </Button>
            </div>
          )}
          {!loading && !error && !drafts.length && (
            <p className="draft-list-empty">
              <FileText size={22} />
              {t("没有未完成的本地草稿")}
            </p>
          )}
          {!loading &&
            drafts.map((draft) => {
              const owner = accounts.find((a) => a.id === draft.accountId);
              if (!owner) return null;
              const preview = splitComposeBody(draft.body).content.trim();
              return (
                <article
                  className="draft-list-item"
                  key={JSON.stringify([draft.accountId, draft.key || "new"])}
                >
                  <div className="draft-list-copy">
                    <strong>{draft.subject.trim() || t("（无主题）")}</strong>
                    <small>{owner.email}</small>
                    <span>
                      {t("收件人：")}
                      {draft.to.trim() || t("未填写")}
                    </span>
                    {preview && <p>{preview}</p>}
                    {!!draft.attachments?.length && (
                      <small>
                        <Paperclip size={12} />
                        {draft.attachments.length === 1
                          ? t("1 个附件")
                          : t("{0} 个附件", { 0: draft.attachments.length })}
                      </small>
                    )}
                  </div>
                  <div className="draft-list-actions">
                    <Button size="sm" onClick={() => onResume(draft, owner)}>
                      {t("继续编辑")}
                    </Button>
                    <IconButton
                      label={t("删除草稿：{0}", {
                        0: draft.subject.trim() || t("无主题"),
                      })}
                      onClick={() => {
                        setTarget(draft);
                        setDeleteError("");
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </article>
              );
            })}
        </div>
      </Modal>
      <Modal
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !deleting) setTarget(null);
        }}
        title={t("删除这份本地草稿？")}
        description={t("删除后无法恢复，不会删除服务器上的草稿或附件源文件")}
        role="alertdialog"
        size="sm"
        initialFocus={cancel}
        footer={
          <>
            <Button
              ref={cancel}
              disabled={deleting}
              onClick={() => setTarget(null)}
            >
              {t("取消")}
            </Button>
            <Button
              variant="danger"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? t("正在删除…") : t("删除草稿")}
            </Button>
          </>
        }
      >
        <p className="confirm-copy">
          {target?.subject.trim() || t("（无主题）")}
        </p>
        <p className="draft-delete-scope">
          {t("删除后无法恢复；服务器草稿和附件原文件不受影响。")}
        </p>
        {deleteError && (
          <p className="form-error" role="alert">
            {t(deleteError)}
          </p>
        )}
      </Modal>
    </>
  );
}
