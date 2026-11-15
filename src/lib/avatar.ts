const avatarColors = [
  "#2563eb", // vibrant blue
  "#7c3aed", // violet
  "#ea580c", // orange
  "#059669", // emerald
  "#db2777", // rose
  "#0891b2", // cyan
];

export function getAvatarBg(from: string): string {
  let hash = 0;
  for (let i = 0; i < from.length; i++) {
    hash = (hash << 5) - hash + from.charCodeAt(i);
    hash |= 0;
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function getAvatarInitial(from: string): string {
  const clean = from.replace(/<.*>/, "").replaceAll('"', "").trim() || from;
  return clean.charAt(0).toUpperCase() || "M";
}
