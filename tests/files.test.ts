import { expect, test } from "bun:test";
import { fileSize } from "../src/lib/files";

test("attachment sizes read the way a file list would show them", () => {
  expect(fileSize(0)).toBe("0 B");
  expect(fileSize(-1)).toBe("0 B");
  expect(fileSize(512)).toBe("512 B");
  expect(fileSize(1023)).toBe("1023 B");
  expect(fileSize(1024)).toBe("1 KB");
  expect(fileSize(1536)).toBe("1.5 KB");
  expect(fileSize(5 * 1024 * 1024)).toBe("5 MB");
  expect(fileSize(Number.NaN)).toBe("0 B");
});
