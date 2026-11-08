import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { Button } from "./ui/button";
import { t, useLocale } from "../lib/i18n";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Bundle font/CMap data locally, including CJK mappings. Never fetch a font
// address supplied by the PDF or rely on a CDN for offline previews.
const cMaps = import.meta.glob<string>(
  "/node_modules/pdfjs-dist/cmaps/*.bcmap",
  { eager: true, query: "?url", import: "default" },
);
const fonts = import.meta.glob<string>(
  "/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
  { eager: true, query: "?url", import: "default" },
);
const localAssets = (assets: Record<string, string>) =>
  new Map(
    Object.entries(assets).map(([path, url]) => [path.split("/").at(-1), url]),
  );
const maps = localAssets(cMaps),
  fontFiles = localAssets(fonts);
class LocalPdfDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const url = (
      kind === "cMapUrl"
        ? maps
        : kind === "standardFontDataUrl"
          ? fontFiles
          : new Map<string, string>()
    ).get(filename);
    if (!url) throw new Error("PDF resource is not bundled");
    if (url.startsWith("data:"))
      return Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) =>
        c.charCodeAt(0),
      );
    const response = await fetch(url);
    if (!response.ok) throw new Error("PDF resource unavailable");
    return new Uint8Array(await response.arrayBuffer());
  }
}

export default function PdfPreview({ data }: { data: Uint8Array }) {
  useLocale();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  useEffect(() => {
    let live = true;
    setPdf(null);
    setPage(1);
    setError("");
    setRendering(true);
    const task = pdfjs.getDocument({
      data: data.slice(),
      useWasm: false,
      disableFontFace: true,
      useSystemFonts: true,
      enableXfa: false,
      verbosity: 0,
      useWorkerFetch: false,
      BinaryDataFactory: LocalPdfDataFactory,
    });
    task.onPassword = () => {
      if (live) setError("此 PDF 需要密码，请下载后查看。");
      void task.destroy().catch(() => {});
    };
    task.promise
      .then((doc) => {
        if (live) setPdf(doc);
      })
      .catch(() => {
        if (live)
          setError((previous) => previous || "无法预览此 PDF，可下载后查看。");
      });
    return () => {
      live = false;
      void task.destroy().catch(() => {});
    };
  }, [data]);
  useEffect(() => {
    if (!pdf) return;
    let live = true;
    let render: pdfjs.RenderTask | undefined;
    setRendering(true);
    setError("");
    pdf
      .getPage(page)
      .then(async (sheet) => {
        if (!live || !canvas.current) return;
        const natural = sheet.getViewport({ scale: 1 });
        const scale = Math.min(
          1.5,
          1600 / natural.width,
          Math.sqrt(8_000_000 / (natural.width * natural.height)),
        );
        const viewport = sheet.getViewport({ scale });
        const target = canvas.current;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        render = sheet.render({ canvas: target, viewport });
        await render.promise;
        if (live) setRendering(false);
      })
      .catch(() => {
        if (live) {
          setError("无法预览此 PDF，可下载后查看。");
          setRendering(false);
        }
      });
    return () => {
      live = false;
      render?.cancel();
    };
  }, [pdf, page]);
  return (
    <div className="pdf-preview">
      {pdf && (
        <div className="pdf-preview-toolbar">
          <Button
            size="sm"
            disabled={page <= 1 || rendering}
            onClick={() => setPage((value) => value - 1)}
          >
            {t("上一页")}
          </Button>
          <span role="status">
            {t("第 {0} / {1} 页", { 0: page, 1: pdf.numPages })}
          </span>
          <Button
            size="sm"
            disabled={page >= pdf.numPages || rendering}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("下一页")}
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="form-error">
          {t(error)}
        </p>
      ) : (
        <>
          {rendering && <p role="status">{t("正在生成预览…")}</p>}
          <canvas
            ref={canvas}
            aria-label={t("PDF 页面预览")}
            hidden={rendering}
          />
        </>
      )}
    </div>
  );
}
