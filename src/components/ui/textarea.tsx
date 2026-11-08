import * as React from "react";
import { cn } from "@/lib/utils";
import { useAutoGrow } from "@/lib/use-auto-grow";

/** Textarea — 对应源项目 `.textarea` */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * 随内容自动撑高（评论框、任务标题这类「一行长到多行」的输入）。
   * 开启后去掉拖拽手柄和内部滚动条——两个都开着会互相抢高度。
   */
  autoGrow?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { className, autoGrow = false, value, onInput, ...props },
    ref,
  ) {
    const grow = useAutoGrow<HTMLTextAreaElement>(
      typeof value === "string" ? value : undefined,
    );

    // 外部 ref 与内部测量用的 ref 要指向同一个节点
    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        grow.ref.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref, grow.ref],
    );

    return (
      <textarea
        ref={setRef}
        data-slot="textarea"
        value={value}
        onInput={(e) => {
          onInput?.(e);
          if (autoGrow) grow.onInput();
        }}
        className={cn(
          "w-full min-h-[72px] resize-y rounded-sm border border-line-strong bg-surface px-[10px] py-2",
          "text-base leading-[1.5] transition-[border-color,box-shadow] duration-[var(--dur)]",
          "placeholder:text-foreground-3",
          "hover:border-[color-mix(in_srgb,var(--border-strong)_60%,var(--text-3))]",
          "focus:border-brand focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none",
          "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-foreground-3",
          autoGrow && "resize-none overflow-hidden",
          className,
        )}
        {...props}
      />
    );
  },
);
