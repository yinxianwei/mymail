import { execFileSync } from "node:child_process";
import { defineConfig } from "mygo-cli";

/**
 * Ad-hoc signing — mygo's default — keys the designated requirement to the
 * build's cdhash, so every rebuild has a new identity and macOS treats the app
 * as a stranger: the keychain asks for the login password again each time the
 * app reads its stored mail password.
 *
 * Signing with a real identity moves that requirement onto the certificate
 * (`identifier "dev.mymail.desktop" and certificate leaf = H"…"`), which does
 * not change between builds, so one "Always Allow" keeps working.
 */
function signingIdentity() {
  const override = process.env.MYMAIL_SIGN;
  if (override) return override;
  if (process.platform !== "darwin") return "-";
  try {
    const out = execFileSync(
      "security",
      ["find-identity", "-v", "-p", "codesigning"],
      { encoding: "utf8" },
    );
    const identities = [...out.matchAll(/"([^"]+)"/g)].map(([, id]) => id);
    return (
      identities.find((id) => id.startsWith("Developer ID Application")) ??
      identities.find((id) => id.startsWith("Apple Development")) ??
      "-"
    );
  } catch {
    // No keychain access or no identity: fall back to ad-hoc signing.
    return "-";
  }
}

export default defineConfig({
  name: "My Mail",
  identifier: "dev.mymail.desktop",
  version: "0.3.0",
  // 1024×1024 PNG; mygo turns it into the bundle .icns.
  icon: "resources/icon.png",
  main: "./backend",
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web && bun run licenses",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  // macOS registers mailto in the bundle's CFBundleURLTypes; the app becomes
  // the system mail handler only after the user picks it as the default mail
  // reader. Windows/Linux register at runtime in backend/main.go.
  urlSchemes: ["mailto"],
  out: "build",
  macos: {
    // Set MYMAIL_SIGN to pick another identity, or to "-" for ad-hoc signing.
    signingIdentity: signingIdentity(),
  },
});
