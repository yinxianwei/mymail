import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  statSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

// The helper only uses macOS 15 APIs; compiling it never downloads language
// models. Those remain managed by the user's explicit system consent.
if (process.platform === "darwin") {
  for (const [arch, target] of [
    ["arm64", "arm64"],
    ["amd64", "x86_64"],
  ]) {
    const bundle = join("resources", `darwin-${arch}`, "MyMailTranslation.app");
    const contents = join(bundle, "Contents");
    const executable = join(contents, "MacOS", "MyMailTranslation");
    const source = "backend/native/translation-helper.swift";
    mkdirSync(join(contents, "MacOS"), { recursive: true });
    const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.mymail.translation-helper</string><key>CFBundleName</key><string>My Mail Translation</string><key>CFBundleExecutable</key><string>MyMailTranslation</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>15.0</string><key>LSUIElement</key><true/><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>`;
    const plistPath = join(contents, "Info.plist");
    if (!existsSync(plistPath) || readFileSync(plistPath, "utf8") !== plist)
      writeFileSync(plistPath, plist);
    if (
      !existsSync(executable) ||
      statSync(executable).mtimeMs < statSync(source).mtimeMs
    ) {
      execFileSync(
        "xcrun",
        [
          "swiftc",
          "-parse-as-library",
          "-swift-version",
          "5",
          "-O",
          "-target",
          `${target}-apple-macos15.0`,
          source,
          "-o",
          executable,
        ],
        { stdio: "inherit" },
      );
    }
    execFileSync("codesign", ["--force", "--sign", "-", bundle], {
      stdio: "pipe",
    });
  }
}
