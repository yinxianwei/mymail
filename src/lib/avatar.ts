/**
 * Deterministic avatar color and initial helper for email senders.
 */

const PALETTE = [
  { bg: "#e0f2fe", color: "#0369a1", darkBg: "#0c4a6e", darkColor: "#7dd3fc" }, // Sky
  { bg: "#ede9fe", color: "#6d28d9", darkBg: "#4c1d95", darkColor: "#c4b5fd" }, // Violet
  { bg: "#fce7f3", color: "#be185d", darkBg: "#831843", darkColor: "#f472b6" }, // Pink
  { bg: "#dcfce7", color: "#15803d", darkBg: "#14532d", darkColor: "#86efac" }, // Green
  { bg: "#fef3c7", color: "#b45309", darkBg: "#78350f", darkColor: "#fde68a" }, // Amber
  { bg: "#ffedd5", color: "#c2410c", darkBg: "#7c2d12", darkColor: "#fdba74" }, // Orange
  { bg: "#e0e7ff", color: "#4338ca", darkBg: "#312e81", darkColor: "#a5b4fc" }, // Indigo
  { bg: "#ccfbf1", color: "#0f766e", darkBg: "#134e4a", darkColor: "#5eead4" }, // Teal
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getAvatarColor(nameOrEmail: string, dark = false) {
  const clean = nameOrEmail.trim().toLowerCase();
  const index = hashString(clean) % PALETTE.length;
  const item = PALETTE[index];
  return {
    background: dark ? item.darkBg : item.bg,
    color: dark ? item.darkColor : item.color,
  };
}

export function getAvatarInitial(nameOrEmail: string): string {
  // Strip quotes and angle brackets: "DeepSeek" <no-reply@...> -> DeepSeek
  const clean = nameOrEmail
    .replace(/<[^>]*>/g, "")
    .replace(/["']/g, "")
    .trim();

  if (!clean) return "?";

  // Match first CJK ideograph or first alphanumeric character
  const match = clean.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : clean.charAt(0).toUpperCase();
}
