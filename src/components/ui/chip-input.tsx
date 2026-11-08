import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ChipInput — 收件人 / 抄送这种“多个地址”的输入框。
 *
 * 值仍然是逗号分隔的字符串（和 Draft 里的 `to` / `cc` 一致，草稿与 IPC 都不必
 * 换格式），显示时拆成一个个 chip：回车、逗号、分号、Tab 或失焦都会把当前输入
 * 提交成 chip；输入框为空时按退格删掉最后一个；粘贴多个地址会一次性拆开。
 */
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const SEPARATORS = /[,;，；]+/;

/** Splits a stored value into chip labels. */
export function splitAddresses(value: string) {
  return value
    .split(SEPARATORS)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** `Alice <a@b.com>` → `a@b.com`, so the format check looks at the address. */
function addressOf(raw: string) {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

export interface ChipInputProps {
  id: string;
  /** Comma-separated addresses, the same shape Draft stores. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChipInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  className,
}: ChipInputProps) {
  const chips = splitAddresses(value || "");
  const [text, setText] = React.useState("");
  const [invalid, setInvalid] = React.useState("");
  const input = React.useRef<HTMLInputElement>(null);

  /** Commits whatever separators-delimited text is pending; returns false if
   *  anything in it was not an address. */
  function commit(raw: string) {
    const tokens = splitAddresses(raw);
    if (!tokens.length) return true;
    const next = [...chips];
    for (const token of tokens) {
      if (!EMAIL.test(addressOf(token))) {
        setInvalid(token);
        return false;
      }
      if (!next.some((chip) => chip.toLowerCase() === token.toLowerCase()))
        next.push(token);
    }
    setInvalid("");
    setText("");
    onChange(next.join(", "));
    return true;
  }

  function remove(index: number) {
    onChange(chips.filter((_, i) => i !== index).join(", "));
    input.current?.focus();
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5 py-1", className)}
      onClick={() => input.current?.focus()}
    >
      {chips.map((chip, index) => (
        <span
          key={chip}
          className="recipient-chip inline-flex max-w-full min-w-0 items-center gap-1 rounded-[5px] bg-[var(--accent-soft)] py-[3px] pl-2 pr-1 text-[12.5px] leading-[1.7] text-[var(--text)]"
        >
          <span className="truncate">{chip}</span>
          <button
            type="button"
            aria-label={"移除 " + chip}
            title="移除"
            disabled={disabled}
            onClick={(event) => {
              // The row focuses the input on any click; removing a chip must
              // not also steal focus before the list is rebuilt.
              event.stopPropagation();
              remove(index);
            }}
            className="shrink-0 rounded-[3px] text-[var(--text-3)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        ref={input}
        value={text}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        placeholder={chips.length ? "" : placeholder}
        className="min-w-[140px] flex-1 bg-transparent px-1 py-[3px] text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-4)] disabled:cursor-not-allowed"
        onChange={(event) => {
          const next = event.target.value;
          setInvalid("");
          if (SEPARATORS.test(next.slice(-1))) commit(next);
          else setText(next);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit(text);
          } else if (
            event.key === "," ||
            event.key === ";" ||
            event.key === "、"
          ) {
            event.preventDefault();
            commit(text);
          } else if (event.key === "Backspace" && !text && chips.length) {
            event.preventDefault();
            remove(chips.length - 1);
          } else if (event.key === "Tab" && text) {
            commit(text);
          }
        }}
        onBlur={() => commit(text)}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (!SEPARATORS.test(pasted)) return;
          event.preventDefault();
          commit(text + pasted);
        }}
      />
      {invalid && (
        <span className="w-full text-[11px] text-[var(--red)]">
          “{invalid}”不是有效地址，需要包含 @ 和域名
        </span>
      )}
    </div>
  );
}
