import { expect, test } from "bun:test";
import { en } from "../src/locales/en";
import {
  getLocale,
  resolveLanguage,
  setLanguagePreference,
  t,
} from "../src/lib/i18n";
import { folderTitle } from "../src/lib/folders";
import { composeBody, splitComposeBody } from "../src/lib/reply";

test("language negotiation, UI translation and placeholders preserve user data", () => {
  try {
    expect(resolveLanguage("system", ["en-US", "zh-CN"])).toBe("en");
    expect(resolveLanguage("system", ["fr", "zh-Hans"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["fr"])).toBe("en");
    expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
    setLanguagePreference("en");
    expect(getLocale()).toBe("en");
    expect(t("写邮件")).toBe("Compose");
    expect(t("附件已保存到 {0}", { 0: "/tmp/中文 {0}.pdf" })).toBe(
      "Attachment saved to /tmp/中文 {0}.pdf",
    );
    expect(t("附件已保存到 /tmp/中文.pdf")).toBe(
      "Attachment saved to /tmp/中文.pdf",
    );
    expect(
      t("IMAP 认证失败，请检查授权码并确认已开启 IMAP · 测试编号：abc123"),
    ).toContain("Test ID: abc123");
    expect(t("unknown diagnostic")).toBe("unknown diagnostic");
    expect(t("原始诊断。路径；/tmp/文件.txt")).toBe(
      "原始诊断。路径；/tmp/文件.txt",
    );
    expect(
      folderTitle({
        name: "Sent Items",
        role: "sent",
        delimiter: "/",
        selectable: true,
      }),
    ).toBe("Sent");
    expect(
      folderTitle({
        name: "Projects/我的计划",
        role: "",
        delimiter: "/",
        selectable: true,
      }),
    ).toBe("我的计划");
    const original = "中文正文\n\nOn a date, a sender wrote:\n> Original text";
    const split = splitComposeBody(original);
    expect(composeBody(split.content, split.quote)).toBe(original);
    setLanguagePreference("zh-CN");
    expect(t("写邮件")).toBe("写邮件");
  } finally {
    setLanguagePreference("system");
  }
});

test("all English catalog entries keep the same interpolation placeholders", () => {
  for (const [source, translated] of Object.entries(en)) {
    const placeholders = (s: string) =>
      [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
    expect(placeholders(translated)).toEqual(placeholders(source));
    expect(translated.trim().length).toBeGreaterThan(0);
  }
});
