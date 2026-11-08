import * as React from "react";

/**
 * useAutoGrow — 让 textarea 随内容长高（不出现内部滚动条）。
 *
 * 手法就两步：先把 height 设成 auto 让浏览器重新计算，再设成 scrollHeight。
 * 少了第一步的话 textarea 只会越撑越高——因为 scrollHeight 是相对当前高度算的。
 *
 * 用 useLayoutEffect 而不是 useEffect：内容变高要在浏览器绘制前完成，
 * 否则会先看到一帧被裁掉的字再跳高。
 *
 * 传 value 进来（而不是只靠 onInput）是为了覆盖「外部改值」的场景：
 * 切换任务时标题换了，高度得跟着变；只监听 input 事件是跟不上的。
 */
export function useAutoGrow<T extends HTMLTextAreaElement>(value?: string) {
  const ref = React.useRef<T>(null);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useLayoutEffect(resize, [value, resize]);

  return { ref, onInput: resize };
}
