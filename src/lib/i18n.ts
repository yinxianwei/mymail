import { useSyncExternalStore } from "react";
import { en } from "../locales/en";

export type Locale = "zh-CN" | "en";
export type LanguagePreference = Locale | "system";
const key = "mail:language";
const listeners = new Set<() => void>();
let preference: LanguagePreference = "system";
let nativeLocale: Locale | undefined;
try {
  const stored = localStorage.getItem(key);
  if (stored === "en" || stored === "zh-CN") preference = stored;
} catch {
  /* The native preference is loaded after the bridge is ready. */
}

export function resolveLanguage(
  value: LanguagePreference,
  languages: readonly string[],
): Locale {
  if (value !== "system") return value;
  for (const language of languages) {
    const base = language.replaceAll("_", "-").split("-")[0].toLowerCase();
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en";
  }
  return "en";
}
export function getLanguagePreference() {
  return preference;
}
export function getLocale(): Locale {
  if (preference !== "system") return preference;
  if (nativeLocale) return nativeLocale;
  const languages =
    typeof navigator === "undefined" || !navigator.language
      ? ["zh-CN"]
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  return resolveLanguage("system", languages);
}
export function setLanguagePreference(value: string, resolved?: string) {
  if (value !== "system" && value !== "zh-CN" && value !== "en") return;
  preference = value;
  nativeLocale =
    resolved === "en" || resolved === "zh-CN" ? resolved : undefined;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* SQLite remains authoritative. */
  }
  if (typeof document !== "undefined")
    document.documentElement.lang = getLocale();
  for (const changed of listeners) changed();
}
function subscribe(changed: () => void) {
  listeners.add(changed);
  return () => {
    listeners.delete(changed);
  };
}
export function useLocale() {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templates = Object.entries(en)
  .filter(([message]) => /\{\d+\}/.test(message))
  .map(([message, english]) => ({
    pattern: new RegExp(
      "^" +
        message
          .split(/\{\d+\}/)
          .map(escape)
          .join("([\\s\\S]*?)") +
        "$",
    ),
    english,
  }));
function format(message: string, values: Record<string, unknown>) {
  return message.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Object.hasOwn(values, index) ? String(values[index]) : placeholder,
  );
}
/** Translate only explicit interface text. Do not pass message bodies, subjects or folder IDs. */
export function t(
  message: string,
  values: Record<string, unknown> = {},
): string {
  if (getLocale() !== "en") return format(message, values);
  if (Object.hasOwn(en, message)) return format(en[message], values);
  for (const { pattern, english } of templates) {
    const matched = message.match(pattern);
    if (matched)
      return format(
        english,
        Object.fromEntries(matched.slice(1).map((v, i) => [String(i), v])),
      );
  }
  // Known status strings can be combined by the Go service. Translate each
  // exact phrase while leaving paths, IDs and unknown server details intact.
  if (/[；。]| · /.test(message)) {
    const parts = message.split(/([；。]| · )/);
    let changed = false;
    const translated = parts.map((part, index) => {
      if (index % 2) return part;
      const result = t(part);
      if (result !== part) changed = true;
      return result;
    });
    if (!changed) return message;
    return translated
      .map((part, index) =>
        index % 2 ? (part === "；" ? "; " : part === "。" ? "." : part) : part,
      )
      .join("");
  }
  return format(message, values);
}
