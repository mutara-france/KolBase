/** Monogramme stable, dérivé du nom, dans les couleurs de la charte (bleu, indigo, violet, rose, outremer profond). */
const hashCode = (s: string) => [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
const COLORS = ["#1800AB", "#3A16D9", "#7208C9", "#A85278", "#0E0066", "#5638F0"];

export function initialsOf(name: string) {
  const parts = name.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function avatarColor(name: string) {
  return COLORS[Math.abs(hashCode(name)) % COLORS.length];
}

export function Avatar({ name, size = 40, square = false, ring = false }: { name: string; size?: number; square?: boolean; ring?: boolean }) {
  return (
    <span
      className={`avatar${square ? " square" : ""}${ring ? " ring" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: avatarColor(name) }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}
