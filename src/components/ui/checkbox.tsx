import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "@/lib/utils";

/**
 * Checkbox — 对应源项目 `.check`（含 `.round` 圆形变体）
 * 勾形用两条 border 手绘，而不是 lucide Check 图标：
 * 源项目就是 8×5 的 L 形 border 旋转 -45°，换图标会在 15px 尺寸下明显走样。
 */
const box = [
  "group peer size-[15px] shrink-0 appearance-none rounded-[4px] border-[1.5px] border-line-strong",
  "bg-surface transition-[background-color,border-color] duration-[var(--dur)]",
  "hover:border-foreground-4",
  "focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1",
  "disabled:cursor-not-allowed disabled:opacity-45",
  "data-[state=checked]:border-brand data-[state=checked]:bg-brand",
  "data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand",
].join(" ");

export interface CheckboxProps extends React.ComponentPropsWithoutRef<
  typeof CheckboxPrimitive.Root
> {
  round?: boolean;
}

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox({ className, round = false, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      data-slot="checkbox"
      className={cn(box, round && "size-4 rounded-full", className)}
      {...props}
    >
      {/* Indicator 只在选中时挂载，所以 popCheck 每次勾选都会重播一次。
          源项目 `.check:checked::after` 是瞬现的——这里补一个 0.34s 的弹入，
          让 15px 的小方块也能看出「点到了」。任务完成时的整行动效
          （.fx-done [data-slot=checkbox]）仍然由 motion.css 负责，两者不冲突。 */}
      <CheckboxPrimitive.Indicator className="grid h-full w-full place-items-center text-brand-foreground animate-[popCheck_0.34s_var(--spring)]">
        {/* 勾：8×5 的 L 形 border 旋转 -45°（源项目 .check:checked::after 的同一手法） */}
        <span className="h-[5px] w-2 -translate-y-px rotate-[-45deg] border-b-[1.8px] border-l-[1.8px] border-current group-data-[state=indeterminate]:hidden" />
        {/* 横线：半选态 7×1.8px */}
        <span className="hidden h-[1.8px] w-[7px] bg-current group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

/** Radio — 对应源项目 `.radio`（原生 input，无需 Radix）
 *  用原生 input 而不是 Radix RadioGroup：同名 name 自动成组，方向键切换、
 *  表单序列化、屏幕阅读器播报全部由浏览器负责，换 Radix 只是多一层 context。
 *
 *  ⚠️ 内点**不能**用 `input::before` 画：Chromium 在 appearance:none 的
 *  input 上仍会画出自己的实心圆，结果就是「选中态正常、未选中态是一个黑球」。
 *  这里改成 input + 同级 span，用 peer-checked 驱动，行为完全确定。 */
export interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  /** 标签下方的补充说明 */
  hint?: string;
}

export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(
  function Radio({ className, label, hint, id, disabled, ...props }, ref) {
    const autoId = React.useId();
    const rid = id ?? autoId;

    return (
      <span
        className={cn(
          "inline-flex items-start gap-2",
          disabled && "opacity-45",
        )}
      >
        <span className="relative mt-px grid size-[15px] shrink-0 place-items-center">
          <input
            ref={ref}
            type="radio"
            id={rid}
            data-slot="radio"
            disabled={disabled}
            className={cn(
              "peer size-[15px] cursor-pointer appearance-none rounded-full bg-surface",
              "border-[1.5px] border-line-strong transition-colors duration-[var(--dur)]",
              "hover:border-foreground-4",
              "checked:border-brand",
              "focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1",
              "disabled:cursor-not-allowed",
              className,
            )}
            {...props}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute size-[7px] scale-0 rounded-full bg-brand transition-transform duration-[var(--dur)] peer-checked:scale-100"
          />
        </span>
        {label || hint ? (
          <label
            htmlFor={rid}
            className="flex cursor-pointer flex-col gap-0.5 leading-tight"
          >
            {label ? (
              <span className="text-base text-foreground">{label}</span>
            ) : null}
            {hint ? (
              <span className="text-xs text-foreground-3">{hint}</span>
            ) : null}
          </label>
        ) : null}
      </span>
    );
  },
);

/** 单选组的排布容器。只负责间距方向，不接管受控状态。 */
export function RadioGroup({
  orientation = "vertical",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "vertical" | "horizontal";
}) {
  return (
    <div
      role="radiogroup"
      data-slot="radio-group"
      className={cn(
        "flex",
        orientation === "vertical"
          ? "flex-col gap-2.5"
          : "flex-row flex-wrap items-center gap-4",
        className,
      )}
      {...props}
    />
  );
}
