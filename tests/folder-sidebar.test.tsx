import { beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FolderSidebar } from "../src/components/folder-sidebar";
import type { FolderInfo } from "../src/mygo";

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
const folders: FolderInfo[] = [
  { name: "INBOX", delimiter: "/", role: "inbox", selectable: true },
  { name: "工作", delimiter: "/", role: "", selectable: true },
  { name: "工作/客户", delimiter: "/", role: "", selectable: true },
];
test("expand is independent of selection, persists per account, and active descendants reveal themselves", async () => {
  localStorage.clear();
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  const selected: string[] = [];
  const render = (accountID: string, active = "INBOX") => (
    <FolderSidebar
      key={accountID}
      accountID={accountID}
      folders={folders}
      active={active}
      disabled={false}
      inboxUnread={61}
      onSelect={(name) => selected.push(name)}
    />
  );
  await act(async () => root.render(render("account-a")));
  expect(host.querySelector('[aria-label="61 封未读"]')).not.toBeNull();
  expect(host.querySelector('[title="工作/客户"]')).toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="展开工作"]')!.click(),
  );
  expect(selected).toEqual([]);
  expect(host.querySelector('[title="工作/客户"]')).not.toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[title="工作/客户"]')!.click(),
  );
  expect(selected).toEqual(["工作/客户"]);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(render("account-a")));
  expect(host.querySelector('[title="工作/客户"]')).not.toBeNull();
  await act(async () => root.render(render("account-b")));
  expect(host.querySelector('[title="工作/客户"]')).toBeNull();
  await act(async () => root.render(render("account-b", "工作/客户")));
  expect(
    host.querySelector('[title="工作/客户"][aria-current="page"]'),
  ).not.toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>(".folder-section-toggle")!.click(),
  );
  expect(host.querySelector('[title="工作"]')).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});
