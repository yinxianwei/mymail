import { expect, test } from "bun:test";
import { ancestorIDs, buildFolderTree, folderTitle } from "../src/lib/folders";
import type { FolderInfo } from "../src/mygo";
const f = (
  name: string,
  role = "",
  delimiter = "/",
  selectable = true,
): FolderInfo => ({ name, role, delimiter, selectable });
test("system folders have stable priority regardless of server order", () => {
  const input = [
    f("Trash"),
    f("项目10"),
    f("Sent Messages"),
    f("INBOX"),
    f("Drafts"),
    f("项目2"),
    f("Spam"),
  ];
  const tree = buildFolderTree(input);
  expect(tree.standard.map((n) => n.role)).toEqual([
    "inbox",
    "sent",
    "drafts",
    "junk",
    "trash",
  ]);
  expect(tree.custom.map((n) => n.title)).toEqual(["项目2", "项目10"]);
  expect(buildFolderTree([...input].reverse())).toEqual(tree);
});
test("server special-use metadata wins over localized folder names", () => {
  expect(folderTitle(f("随意命名", "sent"))).toBe("已发送");
  expect(
    buildFolderTree([
      f("[Gmail]", "", "/", false),
      f("[Gmail]/Mail sent", "sent"),
    ]).standard[0]?.id,
  ).toBe("[Gmail]/Mail sent");
  expect(
    buildFolderTree([
      f("[Gmail]", "", "/", false),
      f("[Gmail]/Mail sent", "sent"),
    ]).custom,
  ).toEqual([]);
});
test("hierarchy follows the real delimiter and preserves the full mailbox ID", () => {
  const tree = buildFolderTree([
    f("工作.客户.合同", "", "."),
    f("工作.内部", "", "."),
    f("名称/含斜杠", "", ""),
  ]);
  const work = tree.custom.find((n) => n.id === "工作")!;
  expect(work.selectable).toBe(false);
  expect(work.children.find((n) => n.id === "工作.客户")?.children[0]?.id).toBe(
    "工作.客户.合同",
  );
  expect(ancestorIDs(tree.custom, "工作.客户.合同")).toEqual([
    "工作",
    "工作.客户",
  ]);
  expect(tree.custom.find((n) => n.id === "名称/含斜杠")?.children).toEqual([]);
});
test("nonselectable containers survive and selectable parents remain navigable", () => {
  const tree = buildFolderTree([
    f("项目", "", "/", true),
    f("项目/子目录"),
    f("分类", "", "/", false),
    f("分类/内容"),
  ]);
  expect(tree.custom.find((n) => n.id === "项目")?.selectable).toBe(true);
  expect(tree.custom.find((n) => n.id === "分类")?.selectable).toBe(false);
  expect(buildFolderTree([f("空分类", "", "/", false)]).custom).toEqual([]);
});
