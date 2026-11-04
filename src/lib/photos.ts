import "server-only";
import sharp from "sharp";
import { sniffLogo } from "@/lib/logos";

/**
 * Photo d'un praticien : l'image envoyée n'est jamais conservée telle quelle. Elle est redressée (orientation de
 * l'appareil), recadrée au carré (près du haut pour une photo en hauteur), puis réencodée sans aucune métadonnée (position GPS, appareil,
 * date de prise de vue). Deux tailles : grand format pour la communication, vignette pour les avatars.
 */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MIN_SIDE = 200;
const FULL = 800;
const THUMB = 192;
const WORK = 1600;
/** Image décompressée au plus (pixels) : une petite image piégée ne doit pas occuper toute la mémoire du serveur. */
const MAX_PIXELS = 50_000_000;

export type Portrait = { data: Buffer; thumb: Buffer };

export async function processPortrait(bytes: Uint8Array): Promise<Portrait | { error: string }> {
  if (!sniffLogo(bytes)) return { error: "Format non reconnu : JPEG, PNG ou WebP uniquement." };
  try {
    // Redressée (orientation de l'appareil), réduite à 1 600 px au plus, fond blanc sous la transparence.
    const { data: raw, info } = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize(WORK, WORK, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels } = info;
    if (Math.min(w, h) < PHOTO_MIN_SIDE) return { error: "Photo trop petite : {min} × {min} pixels au minimum." };
    // Carré : centré en largeur ; sur une photo en hauteur, près du haut, où se trouve le visage d'un portrait.
    const side = Math.min(w, h);
    const crop = { left: Math.round((w - side) / 2), top: h > w ? Math.round((h - side) * 0.2) : 0, width: side, height: side };
    const square = (size: number) => sharp(raw, { raw: { width: w, height: h, channels } }).extract(crop).resize(size, size);
    const [data, thumb] = await Promise.all([
      square(FULL).jpeg({ quality: 85, mozjpeg: true }).toBuffer(),
      square(THUMB).webp({ quality: 82 }).toBuffer(),
    ]);
    return { data, thumb };
  } catch {
    return { error: "Image illisible : enregistrez-la de nouveau en JPEG ou en PNG, puis réessayez." };
  }
}
