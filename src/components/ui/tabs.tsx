import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * Tabs — 对应源项目 `.tabs` / `.tab` / `.tab.on`
 * 指示条是 2px 实心条，贴容器底边（bottom: -1px），左右各内缩 8px。
 * active 态用文字色变化 + 下划线，不用背景块——这是 Gr8r 和 shadcn 默认 tabs 最大的差异。
 */

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="tabs"
      className={cn(
        "flex gap-0.5 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    count?: React.ReactNode;
  }
>(function TabsTrigger({ className, count, children, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-slot="tab"
      className={cn(
        // 高度走 --h-lg（36px）而不是 h-9：数值相同，但黄金规则要求尺寸
        // 一律从 token 取，h-9 是 Tailwind 默认刻度，改 token 值时它不会跟着变。
        "relative inline-flex h-[var(--h-lg)] items-center gap-1.5 whitespace-nowrap px-2.5",
        "text-sm font-medium text-foreground-2 transition-colors duration-[var(--dur)]",
        "hover:text-foreground",
        "data-[state=active]:text-foreground",
        "data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:-bottom-px",
        "data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-sm data-[state=active]:after:bg-foreground",
        'data-[state=active]:after:content-[""]',
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      {count != null ? (
        <span className="text-2xs font-medium text-foreground-3">{count}</span>
      ) : null}
    </TabsPrimitive.Trigger>
  );
});

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn("focus-visible:outline-none", className)}
      {...props}
    />
  );
});
