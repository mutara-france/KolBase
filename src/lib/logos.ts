/** Logos d'organisation : formats acceptés, contrôle du contenu réel et URL publique versionnée. */

export const LOGO_MAX_BYTES = 500 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

/**
 * Type réel de l'image d'après ses premiers octets (le type annoncé par le navigateur ne suffit pas).
 * Le SVG est volontairement exclu : il peut embarquer du script.
 */
export function sniffLogo(bytes: Uint8Array): LogoType | null {
  const b = (i: number) => bytes[i];
  if (bytes.length >= 8 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return "image/png";
  if (bytes.length >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** URL du logo (avec la date de mise à jour pour invalider les caches), ou null sans logo. */
export const logoSrc = (o: { id: string; logoUpdatedAt: Date | null }) => (o.logoUpdatedAt ? `/logos/${o.id}?v=${o.logoUpdatedAt.getTime()}` : null);
