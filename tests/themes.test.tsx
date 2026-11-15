import { expect, test, beforeAll } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NovaRail, type ThemeId } from "../src/components/nova-rail";
import { NovaAiCard } from "../src/components/nova-ai-card";
import { NovaBanner } from "../src/components/nova-banner";
import { getAvatarBg, getAvatarInitial } from "../src/lib/avatar";

beforeAll(() => {
  const { window } = new JSDOM("<!doctype html><body></body>", {
    url: "https://mail.test",
  });
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
});

test("Nova theme components render and handle interactions properly", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  let selectedTheme: ThemeId = "nova";
  let foldersToggled = false;
  let draftsOpened = false;

  await act(async () => {
    root.render(
      <NovaRail
        unified={false}
        folder="INBOX"
        filter="all"
        unreadCount={5}
        foldersOpen={false}
        theme={selectedTheme}
        onSelectInbox={() => {}}
        onSelectStarred={() => {}}
        onSelectUnified={() => {}}
        onToggleFolders={() => {
          foldersToggled = true;
        }}
        onOpenDrafts={() => {
          draftsOpened = true;
        }}
        onOpenSettings={() => {}}
        onThemeChange={(t) => {
          selectedTheme = t;
        }}
      />,
    );
  });

  // Verify rail logo and badge dot
  expect(host.querySelector(".nova-logo-badge")).not.toBeNull();
  expect(host.querySelector(".badge-dot")).not.toBeNull();

  // Test folder toggle action
  const folderBtn =
    host.querySelector<HTMLButtonElement>('[title="更多文件夹"]');
  expect(folderBtn).not.toBeNull();
  await act(async () => folderBtn?.click());
  expect(foldersToggled).toBe(true);

  // Test drafts action
  const draftsBtn = host.querySelector<HTMLButtonElement>('[title="本地草稿"]');
  expect(draftsBtn).not.toBeNull();
  await act(async () => draftsBtn?.click());
  expect(draftsOpened).toBe(true);

  // Test AI Card
  let aiCardClicked = false;
  await act(async () => {
    root.render(<NovaAiCard onAction={() => (aiCardClicked = true)} />);
  });
  expect(host.textContent).toContain("GPT 5.5");
  expect(host.textContent).toContain("Pro (20x)");
  expect(host.querySelectorAll(".nova-ai-bar").length).toBe(24);
  const aiCard = host.querySelector<HTMLDivElement>(".nova-ai-card");
  await act(async () => aiCard?.click());
  expect(aiCardClicked).toBe(true);

  // Test Banner and dismiss
  localStorage.removeItem("mail:nova:banner:dismissed");
  await act(async () => {
    root.render(<NovaBanner />);
  });
  expect(host.textContent).toContain("开启 AI 智邮");
  expect(host.textContent).toContain("体验新一代智能收件箱");

  const dismissBtn = host.querySelector<HTMLButtonElement>(
    ".nova-banner-dismiss",
  );
  expect(dismissBtn).not.toBeNull();
  await act(async () => dismissBtn?.click());
  expect(localStorage.getItem("mail:nova:banner:dismissed")).toBe("true");

  await act(async () => {
    root.unmount();
  });
  host.remove();
});

test("Avatar color and monogram generation is deterministic", () => {
  const bg1 = getAvatarBg("Rico Oktananda <rico@example.invalid>");
  const bg2 = getAvatarBg("Rico Oktananda <rico@example.invalid>");
  expect(bg1).toBe(bg2);

  expect(getAvatarInitial("Rico Oktananda")).toBe("R");
  expect(getAvatarInitial('"Alicia from Deel" <alicia@deel.com>')).toBe("A");
  expect(getAvatarInitial("Substack Read")).toBe("S");
});
