import { beforeAll, expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import {
  isTrustedSender,
  readRemoteTrust,
  setSenderTrust,
  siteOf,
  trustReason,
  writeRemoteTrust,
  type RemoteTrust,
} from "../src/lib/remote-content";

beforeAll(() => {
  const { window } = new JSDOM("<!doctype html><body></body>", {
    url: "https://mail.test",
  });
  Object.assign(globalThis, { window, localStorage: window.localStorage });
});

const empty: RemoteTrust = { allowed: [], blocked: [] };
const accounts = ["me@gmail.com"];

test("known providers and account domains are trusted by default", () => {
  expect(isTrustedSender("Alice <alice@qq.com>", accounts, empty)).toBe(true);
  expect(isTrustedSender("Bob <bob@gmail.com>", accounts, empty)).toBe(true);
  expect(isTrustedSender("Sender <x@example.invalid>", accounts, empty)).toBe(
    false,
  );
});

test("provider subdomains count as trusted while lookalike domains do not", () => {
  expect(isTrustedSender("VIP <vip@vip.163.com>", accounts, empty)).toBe(true);
  expect(isTrustedSender("Mail <noreply@mail.qq.com>", accounts, empty)).toBe(
    true,
  );
  expect(isTrustedSender("Evil <x@qq.com.evil.test>", accounts, empty)).toBe(
    false,
  );
  expect(trustReason("VIP <vip@vip.163.com>", accounts, empty)).toBe(
    "provider",
  );
});

test("the reader can tell why a sender is trusted", () => {
  const allowed = setSenderTrust(empty, "x@example.invalid", true);
  expect(trustReason("x@example.invalid", accounts, allowed)).toBe("allowed");
  expect(trustReason("x@example.invalid", accounts, empty)).toBe("unknown");
  expect(trustReason("Me <me@gmail.com>", accounts, empty)).toBe("provider");
  expect(
    trustReason("Teammate <t@mail.example.com>", ["me@example.com"], empty),
  ).toBe("account");
});

test("a blocked sender overrides provider trust and an allowed sender overrides default block", () => {
  const blocked = setSenderTrust(empty, "alice@qq.com", false);
  expect(isTrustedSender("Alice <alice@qq.com>", accounts, blocked)).toBe(
    false,
  );
  const allowed = setSenderTrust(empty, "x@example.invalid", true);
  expect(isTrustedSender("x@example.invalid", accounts, allowed)).toBe(true);
});

test("trust settings round-trip through localStorage", () => {
  const trust = setSenderTrust(
    setSenderTrust(empty, "x@example.invalid", true),
    "alice@qq.com",
    false,
  );
  writeRemoteTrust(trust);
  expect(readRemoteTrust()).toEqual(trust);
});

test("address-level entries saved by older builds widen to their domain", () => {
  localStorage.setItem(
    "mail:remote-trust",
    JSON.stringify({
      allowed: [
        "no-reply@status-cn-01.flashduty.com",
        "infoqchina@edm.infoq.com.cn",
        "noreply@icloud.com.cn",
      ],
      blocked: ["alice@qq.com"],
    }),
  );
  const trust = readRemoteTrust();
  expect(trust.allowed).toEqual([
    "flashduty.com",
    "infoq.com.cn",
    "icloud.com.cn",
  ]);
  // Blocking stays precise: one mailbox, not the whole provider.
  expect(trust.blocked).toEqual(["alice@qq.com"]);
  expect(
    isTrustedSender("no-reply@status-cn-03.flashduty.com", accounts, trust),
  ).toBe(true);
});

test("trusting a sender covers its whole domain, blocking stays per address", () => {
  const allowed = setSenderTrust(
    empty,
    "DeepSeek <no-reply@status-cn-01.flashduty.com>",
    true,
  );
  expect(allowed.allowed).toEqual(["flashduty.com"]);
  expect(
    isTrustedSender("no-reply@status-cn-01.flashduty.com", accounts, allowed),
  ).toBe(true);
  expect(
    isTrustedSender("no-reply@status-cn-03.flashduty.com", accounts, allowed),
  ).toBe(true);
  expect(isTrustedSender("x@flashduty.com.evil.test", accounts, allowed)).toBe(
    false,
  );

  const blocked = setSenderTrust(
    allowed,
    "no-reply@status-cn-03.flashduty.com",
    false,
  );
  // The domain stays allowed; only that mailbox is blocked.
  expect(blocked.allowed).toEqual(["flashduty.com"]);
  expect(blocked.blocked).toEqual(["no-reply@status-cn-03.flashduty.com"]);
  expect(
    isTrustedSender("no-reply@status-cn-03.flashduty.com", accounts, blocked),
  ).toBe(false);
  expect(
    isTrustedSender("no-reply@status-cn-01.flashduty.com", accounts, blocked),
  ).toBe(true);

  // Trusting again supersedes the block, so the button is never a dead end.
  const again = setSenderTrust(
    blocked,
    "no-reply@status-cn-03.flashduty.com",
    true,
  );
  expect(again.blocked).toEqual([]);
  expect(
    isTrustedSender("no-reply@status-cn-03.flashduty.com", accounts, again),
  ).toBe(true);
});

test("two-label suffixes keep separate sites apart", () => {
  expect(siteOf("mail.example.com.cn")).toBe("example.com.cn");
  expect(siteOf("news.example.com.cn")).toBe("example.com.cn");
  const trust = setSenderTrust(empty, "a@mail.example.com.cn", true);
  expect(isTrustedSender("b@news.example.com.cn", accounts, trust)).toBe(true);
  // Same label, different suffix: not covered.
  expect(isTrustedSender("c@example.com", accounts, trust)).toBe(false);
});
