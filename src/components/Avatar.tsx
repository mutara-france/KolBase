/** Monogramme coloré stable, dérivé du nom (comme dans le prototype). */
const hashCode = (s: string) => [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
const HUES = [226, 262, 199, 168, 24, 340, 289, 145, 12, 210];

export function initialsOf(name: string) {
  const parts = name.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, size = 40, square = false, ring = false }: { name: string; size?: number; square?: boolean; ring?: boolean }) {
  const hue = HUES[Math.abs(hashCode(name)) % HUES.length];
  return (
    <span
      className={`avatar${square ? " square" : ""}${ring ? " ring" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 30) % 360} 65% 45%))` }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}
