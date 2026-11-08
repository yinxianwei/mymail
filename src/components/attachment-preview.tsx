import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { MailService as api, type AttachmentPreview as Preview } from "../mygo";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { t, useLocale } from "../lib/i18n";
import { fileSize } from "../lib/files";

const PdfPreview = lazy(() => import("./pdf-preview"));
export interface PreviewTarget {
  messageId: string;
  index: number;
  name: string;
}

export function AttachmentPreview({
  target,
  onClose,
}: {
  target: PreviewTarget;
  onClose: () => void;
}) {
  useLocale();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    setPreview(null);
    setError("");
    setNotice("");
    api
      .previewAttachment(target.messageId, target.index)
      .then((result) => {
        if (live) setPreview(result);
      })
      .catch(() => {
        if (live) setError("附件预览加载失败，请重试。");
      });
    return () => {
      live = false;
    };
  }, [target.messageId, target.index, revision]);
  const bytes = useMemo(
    () =>
      preview?.kind === "pdf"
        ? Uint8Array.from(atob(preview.data), (c) => c.charCodeAt(0))
        : null,
    [preview],
  );
  async function download() {
    if (saving) return;
    setSaving(true);
    setNotice("");
    try {
      const path = await api.downloadAttachment(target.messageId, target.index);
      if (path) setNotice(t("附件已保存到 {0}", { 0: path }));
    } catch {
      setNotice(t("附件写入失败，请换一个保存位置"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={target.name || t("未命名附件")}
      description={t("附件预览")}
      size="lg"
      className="attachment-preview-modal"
      footer={
        <>
          <span className="draft-status" role="status">
            {notice || (preview ? fileSize(preview.size) : "")}
          </span>
          <Button disabled={saving} onClick={() => void download()}>
            <Download size={14} />
            {saving ? t("保存中…") : t("下载附件")}
          </Button>
        </>
      }
    >
      {error ? (
        <div className="attachment-preview-empty">
          <p role="alert">{t(error)}</p>
          <Button onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={14} />
            {t("重试")}
          </Button>
        </div>
      ) : !preview ? (
        <p role="status">{t("正在加载附件…")}</p>
      ) : preview.kind === "image" &&
        /^image\/(png|jpeg|gif|webp|bmp)$/.test(preview.mime) ? (
        <img
          className="attachment-preview-image"
          src={`data:${preview.mime};base64,${preview.data}`}
          alt={target.name}
          onError={() => setError("附件预览加载失败，请重试。")}
        />
      ) : preview.kind === "text" ? (
        <>
          {preview.truncated && (
            <p className="pref-note">
              {t("内容较长，仅预览前 256 KB，下载可查看完整文件。")}
            </p>
          )}
          <pre className="attachment-preview-text">{preview.text}</pre>
        </>
      ) : preview.kind === "pdf" && bytes ? (
        <Suspense fallback={<p role="status">{t("正在生成预览…")}</p>}>
          <PdfPreview data={bytes} />
        </Suspense>
      ) : (
        <p className="attachment-preview-empty">
          {t(
            preview.reason === "too-large"
              ? "附件超过 10 MB，请下载后查看。"
              : preview.reason === "image-too-large"
                ? "图片尺寸过大，请下载后查看。"
                : "此文件类型暂不支持预览，可下载后查看。",
          )}
        </p>
      )}
    </Modal>
  );
}
