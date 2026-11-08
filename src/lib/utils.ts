import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 className：clsx 处理条件，tailwind-merge 消解冲突。
 * 注意：twMerge 不认识 Gr8r 的自定义 utility 名（如 shadow-elev-2 已被
 * @theme 注册，能识别；但 h-[var(--h-md)] 这类任意值只做字符串比较）。
 * 所以组件里同一个尺寸属性不要写两次，避免依赖 merge 的猜测。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
