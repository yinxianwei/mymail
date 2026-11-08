import { t } from "../../lib/i18n";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** 给读屏的补充说明；不传则用 title 兜底 */
  description?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
  /** 底部操作区，不传则不渲染 `.modal-f` */
  footer?: React.ReactNode;
  /** 点遮罩是否关闭，默认 true */
  dismissOnOverlay?: boolean;
  /** 破坏性确认用 alertdialog：读屏会先念内容再念按钮，不会当普通对话框跳过 */
  role?: "dialog" | "alertdialog";
  /**
   * 打开时把焦点放到这个元素上。默认 Radix 聚焦第一个可聚焦元素——
   * 也就是右上角的关闭按钮；危险操作要落在「取消」上，误触 Enter 才不删库。
   */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /**
   * 卡片内的键盘处理。⌘↵ 这类对话框级快捷键挂这里，
   * 无论焦点在输入框还是底部按钮上都能触发。
   */
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

/**
 * Modal — 对应源项目 `.scrim` / `.modal-wrap` / `.modal`
 *
 * 结构上的关键点：`.modal-wrap` 才是那个 `position:fixed; inset:0` 的定位层，
 * `.modal` 只是居中的卡片。Radix 的 Content 不写定位，正好可以落在
 * `.modal-wrap` 上——这样点击四周空白（target === currentTarget）就是关灯。
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  className,
  children,
  footer,
  dismissOnOverlay = true,
  role = "dialog",
  initialFocus,
  onKeyDown,
}: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="scrim enter" />
        <DialogPrimitive.Content
          className="modal-wrap"
          role={role}
          onOpenAutoFocus={
            initialFocus
              ? (e) => {
                  e.preventDefault();
                  initialFocus.current?.focus();
                }
              : undefined
          }
          onPointerDownOutside={(e) => {
            if (!dismissOnOverlay) e.preventDefault();
          }}
          onClick={(e) => {
            if (dismissOnOverlay && e.target === e.currentTarget)
              onOpenChange(false);
          }}
        >
          <div
            onKeyDown={onKeyDown}
            className={cn(
              "modal enter",
              className,
              size === "sm" && "sm",
              size === "lg" && "lg",
            )}
          >
            <div className="modal-h">
              <DialogPrimitive.Title asChild>
                <h2>{title}</h2>
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <IconButton size="sm" label={t("关闭")} title="">
                  <X style={{ width: 15, height: 15 }} />
                </IconButton>
              </DialogPrimitive.Close>
            </div>
            <DialogPrimitive.Description className="sr">
              {description ?? (typeof title === "string" ? title : t("对话框"))}
            </DialogPrimitive.Description>
            <div className="modal-b">{children}</div>
            {footer ? <div className="modal-f">{footer}</div> : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
