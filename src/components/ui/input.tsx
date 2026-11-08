import * as React from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Input — 对应源项目 `.input` / `.input-lg`
 * 焦点环用 box-shadow 而非 ring utility，因为源项目是 3px 柔和光圈，
 * 和 Tailwind 默认的 ring 观感不同。
 */
const fieldBase = [
  "w-full rounded-sm border border-line-strong bg-surface text-base",
  "transition-[border-color,box-shadow] duration-[var(--dur)]",
  "placeholder:text-foreground-3",
  "hover:border-[color-mix(in_srgb,var(--border-strong)_60%,var(--text-3))]",
  "focus:border-brand focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none",
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-foreground-3",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_3px_var(--red-soft)]",
].join(" ");

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: "md" | "lg";
  /** 左侧图标：传 lucide 组件实例，容器会自动留出 30px 内边距 */
  icon?: React.ReactNode;
  /** 右侧快捷键提示，如 '/' 或 '⌘K'（源项目 `.inwrap > .kbd`） */
  kbd?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { className, inputSize = "md", icon, kbd, type = "text", ...props },
    ref,
  ) {
    const input = (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          fieldBase,
          inputSize === "lg"
            ? "h-[var(--h-lg)] px-[10px]"
            : "h-[var(--h-md)] px-[10px]",
          icon && "pl-[30px]",
          kbd && "pr-[30px]",
          className,
        )}
        {...props}
      />
    );

    if (!icon && !kbd) return input;

    return (
      <span className="relative flex items-center [&>svg]:pointer-events-none [&>svg]:absolute [&>svg]:left-[9px] [&>svg]:z-10 [&>svg]:size-4 [&>svg]:text-foreground-4">
        {icon}
        {input}
        {kbd ? (
          <kbd className="kbd pointer-events-none absolute right-[7px] top-1/2 -translate-y-1/2">
            {kbd}
          </kbd>
        ) : null}
      </span>
    );
  },
);

/** 表单字段容器：label + control + hint/error */
export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
  ...props
}: FieldProps) {
  return (
    <div
      data-slot="field"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-sm font-medium text-foreground"
        >
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-danger">
          <CircleAlert className="size-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-foreground-3">{hint}</p>
      ) : null}
    </div>
  );
}
