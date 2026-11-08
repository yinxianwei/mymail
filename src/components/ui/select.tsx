import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select — 对应源项目 `.select` + `.pop` / `.mi` 菜单
 * 源项目是“原生 <select> 隐身 + 自绘按钮自绘菜单”，Radix 版直接接管，
 * 键盘/滚动/typeahead 都比原版完整，视觉参数取自 .pop：
 *   菜单圆角 10px（--r-lg）、内距 4px、条目最小高 30px、条目圆角 6px。
 */

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
    triggerSize?: "sm" | "md" | "lg";
  }
>(function SelectTrigger(
  { className, triggerSize = "md", children, ...props },
  ref,
) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      data-slot="select-trigger"
      className={cn(
        "inline-flex w-full items-center justify-between gap-2 rounded-sm border border-line-strong bg-surface px-[10px]",
        "text-base text-foreground transition-[border-color,box-shadow] duration-[var(--dur)]",
        "hover:border-[color-mix(in_srgb,var(--border-strong)_60%,var(--text-3))]",
        "focus:border-brand focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none",
        "data-[state=open]:border-brand data-[state=open]:shadow-[0_0_0_3px_var(--accent-soft)]",
        "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-foreground-3",
        triggerSize === "sm" && "h-[var(--h-sm)] text-sm",
        triggerSize === "md" && "h-[var(--h-md)]",
        triggerSize === "lg" && "h-[var(--h-lg)]",
        className,
      )}
      {...props}
    >
      <span className="truncate text-left">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-3 shrink-0 text-foreground-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent(
  { className, children, position = "popper", ...props },
  ref,
) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={4}
        className={cn(
          "z-[80] max-h-[min(420px,70vh)] min-w-[200px] max-w-[320px] overflow-y-auto",
          "rounded-lg bg-surface p-1 text-base shadow-elev-3",
          "data-[state=open]:animate-[riseIn_0.16s_var(--ease)]",
          position === "popper" && "w-[var(--radix-select-trigger-width)]",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex min-h-[30px] w-full cursor-default select-none items-center gap-[9px] rounded-sm px-2",
        "whitespace-nowrap text-base text-foreground outline-none",
        "data-[highlighted]:bg-surface-2",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="ml-auto">
        <Check className="size-3.5 text-brand" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn("px-2 py-1.5 text-xs text-foreground-3", className)}
      {...props}
    />
  );
});

export const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-divider", className)}
      {...props}
    />
  );
});
