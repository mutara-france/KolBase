import { canSee, kolVisibility, type Viewer } from "@/lib/visibility";

/** Photo d'un praticien : adresse versionnée (cache long sans image périmée), vignette ou grand format. */
export const photoPath = (id: string, updatedAt: Date, size: "vignette" | "grande" = "vignette") =>
  `/experts/${id}/photo?v=${updatedAt.getTime()}${size === "grande" ? "&taille=grande" : ""}`;

/**
 * Adresse de la photo pour ce visiteur, ou null (pas de photo, ou masquée par le réglage « Photo » du praticien) :
 * le monogramme s'affiche alors, jamais une image refusée.
 */
export function expertPhotoSrc(p: { id: string; photoUpdatedAt: Date | null; visibility: unknown }, viewer: Viewer) {
  if (!p.photoUpdatedAt) return null;
  if (!canSee(kolVisibility(p.visibility).photo, viewer)) return null;
  return photoPath(p.id, p.photoUpdatedAt);
}
