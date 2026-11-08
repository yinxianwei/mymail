import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  /** 默认展开——只给截图回归用，业务里不要传 */
  defaultOpen?: boolean;
}

/**
 * DropdownMenu — 对应源项目 `.pop` + `.mi` / `.mh` / `.msep`
 *
 * 结构上分两层：Radix 的 Content 只负责定位（popper 会写 inline transform），
 * 真正的外观 `.pop` 放在内层。合在一起的话 popIn 动画的 transform 会和
 * popper 的 transform 互相覆盖，弹出时会有一次位置跳变。
 */
export function DropdownMenu({
  trigger,
  children,
  align = "end",
  side = "bottom",
  sideOffset = 6,
  defaultOpen,
}: DropdownMenuProps) {
  return (
    <DropdownMenuPrimitive.Root defaultOpen={defaultOpen}>
      <DropdownMenuPrimitive.Trigger asChild>
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className="pop-host"
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={8}
        >
          <div className="pop enter">{children}</div>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

export interface MenuItemProps {
  icon?: LucideIcon;
  children: React.ReactNode;
  /** 右侧的辅助信息，通常是快捷键 */
  right?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: (e: Event) => void;
}

export function MenuItem({
  icon,
  children,
  right,
  danger,
  disabled,
  onSelect,
}: MenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn("mi", danger && "danger")}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icon ? React.createElement(icon, { size: 15, className: "i" }) : null}
      <span className="trunc">{children}</span>
      {right ? <span className="r">{right}</span> : null}
    </DropdownMenuPrimitive.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="msep" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuPrimitive.Label className="mh">
      {children}
    </DropdownMenuPrimitive.Label>
  );
}

export const Kbd = ({ children }: { children: React.ReactNode }) => (
  <span className="kbd">{children}</span>
);
