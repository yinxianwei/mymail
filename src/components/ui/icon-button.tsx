import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** IconButton — 对应源项目 `.ibtn` / `.ibtn-sm` / `.ibtn-xs` */
const iconButtonVariants = cva(
  [
    // .ibtn 是挂钩类：components.css 没搬（改用 Tailwind 实现），但 shell.css
    // 里有 `.sgroup-h .ibtn { opacity: 0 }` 这类依赖，所以类名必须留着。
    "ibtn",
    "relative inline-flex shrink-0 items-center justify-center rounded-sm text-foreground-2",
    "transition-[background-color,color] duration-[var(--dur)]",
    "hover:bg-surface-2 hover:text-foreground",
    "active:bg-surface-3 active:text-foreground",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      size: {
        xs: "size-[22px] rounded-xs [&_svg]:size-3.5",
        sm: "size-[var(--h-sm)] [&_svg]:size-4",
        md: "size-[var(--h-md)] [&_svg]:size-4",
      },
      active: { true: "bg-surface-3 text-foreground", false: "" },
    },
    defaultVariants: { size: "md", active: false },
  },
);

export interface IconButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  asChild?: boolean;
  /** 必填：图标按钮没有可见文字，必须提供可访问名称 */
  label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { className, size, active, asChild = false, label, children, ...props },
    ref,
  ) {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-slot="icon-button"
        aria-label={label}
        title={label}
        aria-pressed={active || undefined}
        className={cn(iconButtonVariants({ size, active }), className)}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);

export { iconButtonVariants };
