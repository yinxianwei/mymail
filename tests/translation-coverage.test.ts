import { expect, test } from "bun:test";
import ts from "typescript";
import { en } from "../src/locales/en";

test("interface strings and template placeholders have English catalog entries", async () => {
  const paths = [
    "src/App.tsx",
    "src/components/draft-manager.tsx",
    "src/components/folder-sidebar.tsx",
    "src/components/unified-inboxes.tsx",
    "src/components/language-preferences.tsx",
    "src/components/settings-sections.tsx",
    "src/components/attachment-preview.tsx",
    "src/components/message-translation.tsx",
    "src/components/pdf-preview.tsx",
    "src/components/ui/chip-input.tsx",
    "src/components/ui/modal.tsx",
  ];
  const missing: string[] = [];
  for (const path of paths) {
    const content = await Bun.file(
      new URL("../" + path, import.meta.url),
    ).text();
    const tree = ts.createSourceFile(
      path,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      let key = "";
      if (ts.isStringLiteral(node)) key = node.text;
      else if (ts.isJsxText(node)) key = node.text.trim().replace(/\s+/g, " ");
      else if (ts.isTemplateExpression(node)) {
        key =
          node.head.text +
          node.templateSpans
            .map((span, i) => `{${i}}${span.literal.text}`)
            .join("");
        if (
          !/\p{Script=Han}/u.test(
            node.head.text +
              node.templateSpans.map((span) => span.literal.text).join(""),
          )
        )
          key = "";
      }
      if (
        /\p{Script=Han}/u.test(key) &&
        key !== "简体中文" &&
        !Object.hasOwn(en, key)
      )
        missing.push(`${path}: ${key}`);
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  expect(missing).toEqual([]);
});
