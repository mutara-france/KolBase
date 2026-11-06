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

/** Photo d'un compte sans profil praticien (membre d'organisation) : adresse versionnée, comme celle d'un praticien. */
export const userPhotoPath = (userId: string, updatedAt: Date) => `/comptes/${userId}/photo?v=${updatedAt.getTime()}`;

/** Photo à afficher pour un compte : celle du profil praticien s'il en a un, sinon celle du compte. */
export function accountPhoto(u: { id: string; photoUpdatedAt: Date | null; practitioner?: { id: string; photoUpdatedAt: Date | null } | null }) {
  if (u.practitioner) return u.practitioner.photoUpdatedAt ? photoPath(u.practitioner.id, u.practitioner.photoUpdatedAt) : null;
  return u.photoUpdatedAt ? userPhotoPath(u.id, u.photoUpdatedAt) : null;
}
