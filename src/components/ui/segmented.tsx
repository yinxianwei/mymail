import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented — 对应源项目 `.seg`
 * 轨道 padding 2px，按钮高度 = var(--h-sm) - 2px（24px）。
 * 不要用 Tailwind 的 gap-0.5 之外的值，2px 的缝隙是这个控件的识别点。
 */
export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface SegmentedProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}

export function Segmented<T extends string = string>({
  options,
  value,
  onValueChange,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-slot="segmented"
      className={cn(
        "inline-flex gap-0.5 rounded-sm bg-surface-3 p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onKeyDown={(event) => {
              const direction =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!direction && event.key !== "Home" && event.key !== "End")
                return;
              event.preventDefault();
              const index =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (options.indexOf(opt) + direction + options.length) %
                      options.length;
              onValueChange(options[index].value);
              (
                event.currentTarget.parentElement?.children[
                  index
                ] as HTMLButtonElement
              )?.focus();
            }}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "inline-flex h-[calc(var(--h-sm)-2px)] items-center gap-[5px] rounded-[5px] px-[9px]",
              "text-xs font-medium transition-[background-color,color] duration-[var(--dur)]",
              "[&_svg]:size-3.5 [&_svg]:shrink-0",
              on
                ? "bg-surface text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--border)]"
                : "text-foreground-2 hover:text-foreground",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
