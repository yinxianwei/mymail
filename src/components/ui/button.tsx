import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button — 对应源项目 `.btn` / `.btn-*`
 * 高度必须走 var(--h-*)，不要用 h-8/h-9：Tailwind 的 32/36px 会立刻破坏紧凑感。
 * data-slot + data-variant 供视图层 CSS 钩挂（见 styles/views/board.css）。
 */
const buttonVariants = cva(
  [
    "relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-sm border border-transparent font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--dur)]",
    "active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
    "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-90",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-brand-foreground shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)] hover:bg-brand-hover active:bg-brand-active",
        secondary:
          "border-line-strong bg-surface text-foreground shadow-elev-1 hover:bg-surface-2 active:bg-surface-3",
        ghost:
          "text-foreground-2 hover:bg-surface-2 hover:text-foreground active:bg-surface-3 active:text-foreground",
        danger: "bg-danger text-white hover:bg-danger-hover",
        "danger-ghost": "text-danger hover:bg-danger-soft",
      },
      size: {
        sm: "h-[var(--h-sm)] px-2 text-xs",
        md: "h-[var(--h-md)] px-[11px] text-sm",
        lg: "h-[var(--h-lg)] px-3.5 text-base",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "secondary", size: "md", block: false },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      block,
      asChild = false,
      loading = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-slot="button"
        data-variant={variant ?? "secondary"}
        data-loading={loading || undefined}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cn(
          buttonVariants({ variant, size, block }),
          // 源项目 `.is-loading` 只设 pointer-events:none，不降透明度。
          // 这里 loading 会顺带 disabled，所以必须把 dim 顶回来，
          // 否则加载中的主按钮会淡成一片，看起来像被禁用了。
          loading && "disabled:opacity-100",
          className,
        )}
        {...props}
      >
        {loading ? (
          <>
            {/* 源项目是 ::after 画的 14px 圆环，四边里留一边透明形成缺口。
              换成 lucide Loader2 会变成细弧线，在 30px 高的按钮里明显偏轻。
              描边颜色也照抄：主色按钮用当前文字色（白），次级/幽灵用 --text-2，
              否则次级按钮上的环会是纯黑。 */}
            <span className="absolute inset-0 grid place-items-center">
              <span
                aria-hidden
                className={cn(
                  "size-3.5 animate-spin rounded-full border-2 border-r-transparent",
                  variant === "primary" || variant === "danger"
                    ? "border-current"
                    : "border-foreground-2",
                )}
              />
            </span>
            <span className="invisible">{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);

export { buttonVariants };
