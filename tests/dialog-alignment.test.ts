import { expect, test } from "bun:test";

// jsdom has no layout engine, so alignment rules are checked at their source.
// These are the two places where dialog actions used to drift to the left or
// stretch to the full width.
const overlays = await Bun.file(
  new URL("../src/styles/overlays.css", import.meta.url),
).text();
const mail = await Bun.file(
  new URL("../src/styles/mail.css", import.meta.url),
).text();

const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
  return match?.[0] ?? "";
};

test("dialog footer actions align to the trailing edge", () => {
  const footer = rule(overlays, ".modal-f");
  expect(footer).toContain("justify-content: flex-end");
  expect(rule(overlays, ".modal-f .sp")).toContain("flex: 1");
});

test("form submit buttons stay auto-sized on the right", () => {
  expect(rule(mail, '.account-form > button[type="submit"]')).toContain(
    "align-self: flex-end",
  );
});
