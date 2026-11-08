import { addressOf } from "./reply";

export interface RemoteTrust {
  /** Sender addresses or domains that always load remote images. */
  allowed: string[];
  /** Sender addresses or domains that never load remote images. */
  blocked: string[];
}

const storageKey = "mail:remote-trust";

/**
 * Without a contacts store, trust senders from the well-known mailbox
 * providers and from the user's own account domains by default. Everything
 * else starts blocked, and the reader lets the user load one message or trust
 * / block a sender explicitly.
 */
const defaultTrustedDomains = new Set([
  "qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "188.com",
  "sina.com",
  "sina.cn",
  "sohu.com",
  "139.com",
  "189.cn",
  "aliyun.com",
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "fastmail.com",
  "yandex.com",
]);

const emptyTrust = (): RemoteTrust => ({ allowed: [], blocked: [] });

const normalize = (value: unknown) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].slice(0, 500)
    : [];

/**
 * Older builds stored the sender address itself. Trust now covers the whole
 * registrable domain, so widen the stored list on read: an address becomes its
 * site, and a bare subdomain collapses to its site as well.
 */
const widen = (list: string[]) => [
  ...new Set(
    list
      .map((item) => (item.includes("@") ? trustScopeOf(item) : siteOf(item)))
      .filter(Boolean),
  ),
];

export function readRemoteTrust(): RemoteTrust {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return emptyTrust();
    const data = raw as Record<string, unknown>;
    return {
      allowed: widen(normalize(data.allowed)),
      blocked: normalize(data.blocked),
    };
  } catch {
    return emptyTrust();
  }
}

export function writeRemoteTrust(trust: RemoteTrust) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(trust));
  } catch {}
}

export const senderAddress = (from: string) => addressOf(from).toLowerCase();
export const domainOf = (address: string) =>
  address.split("@")[1]?.trim().toLowerCase() || "";

/**
 * Two-label suffixes under which the registrable domain is three labels.
 * Not a full public-suffix list — enough that `mail.sina.com.cn` and
 * `news.sina.com.cn` share a site instead of collapsing to `com.cn`.
 */
const multiPartSuffixes = new Set([
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "ac.cn",
  "co.uk",
  "org.uk",
  "ac.uk",
  "me.uk",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.kr",
  "or.kr",
  "com.au",
  "net.au",
  "org.au",
  "com.br",
  "com.tw",
  "com.hk",
  "com.sg",
  "com.mx",
  "co.nz",
  "co.za",
  "co.in",
]);

/** The registrable domain of a host: `status-cn-01.flashduty.com` → `flashduty.com`. */
export function siteOf(domain: string) {
  const parts = domain.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return multiPartSuffixes.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

/**
 * What a manual decision applies to. Senders share a domain far more often
 * than an address (`no-reply@status-cn-01…` today, `…-03` tomorrow), so trust
 * is stored per registrable domain rather than per mailbox.
 */
export const trustScopeOf = (from: string) =>
  siteOf(domainOf(senderAddress(from)));

/** Why a sender counts as trusted, for the hint in the reader. */
export type TrustReason =
  "account" | "provider" | "allowed" | "blocked" | "unknown";

/**
 * A stored entry covers the domain itself and its subdomains, so trusting
 * `163.com` also covers `vip.163.com`, and a sender address only ever
 * matches itself. `qq.com.evil.com` does not match `qq.com`.
 */
function covers(entry: string, address: string, domain: string) {
  if (!entry) return false;
  if (entry === address) return true;
  return !!domain && (domain === entry || domain.endsWith("." + entry));
}

function matches(list: string[], address: string, domain: string) {
  return list.some((entry) => covers(entry, address, domain));
}

function providerDomain(domain: string) {
  if (!domain) return false;
  for (const root of defaultTrustedDomains)
    if (domain === root || domain.endsWith("." + root)) return true;
  return false;
}

export function trustReason(
  from: string,
  accountEmails: string[],
  trust: RemoteTrust,
): TrustReason {
  const address = senderAddress(from),
    domain = domainOf(address);
  if (!address) return "unknown";
  if (matches(trust.blocked, address, domain)) return "blocked";
  if (matches(trust.allowed, address, domain)) return "allowed";
  if (providerDomain(domain)) return "provider";
  const own = accountEmails.some((email) =>
    covers(domainOf(senderAddress(email)), address, domain),
  );
  return own ? "account" : "unknown";
}

export function isTrustedSender(
  from: string,
  accountEmails: string[],
  trust: RemoteTrust,
): boolean {
  const reason = trustReason(from, accountEmails, trust);
  return reason === "account" || reason === "provider" || reason === "allowed";
}

/**
 * Trusting covers the whole registrable domain, so every subdomain stops
 * asking and any earlier decision under that domain is superseded. Blocking
 * stays per address: blocking one newsletter mailbox must not silence the
 * rest of its domain.
 */
export function setSenderTrust(
  trust: RemoteTrust,
  from: string,
  trusted: boolean,
): RemoteTrust {
  const address = senderAddress(from),
    site = trustScopeOf(from);
  if (!address || !site) return trust;
  const underSite = (entry: string) =>
    entry === site || entry.endsWith("." + site);
  if (trusted)
    return {
      allowed: [...trust.allowed.filter((item) => !underSite(item)), site],
      blocked: trust.blocked.filter(
        (item) => !underSite(item) && item !== address,
      ),
    };
  return {
    allowed: trust.allowed.filter((item) => item !== address),
    blocked: [...new Set([...trust.blocked, address])],
  };
}
