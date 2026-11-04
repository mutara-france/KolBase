import type { ApplicationStatus, QuoteStatus } from "@/generated/prisma/client";

/** Catégories de prestataires (reprises du prototype). */
export const SUPPLIER_CATEGORIES = [
  { id: "evenementiel", label: "Agence événementielle" },
  { id: "communication", label: "Communication et promotion" },
  { id: "salle", label: "Salle et lieu de réception" },
  { id: "restauration", label: "Restauration et traiteur" },
  { id: "hebergement", label: "Hébergement" },
  { id: "transport", label: "Transport des participants" },
  { id: "audiovisuel", label: "Audiovisuel et captation" },
  { id: "impression", label: "Impression et signalétique" },
] as const;

export const supplierCategoryLabel = (id: string) => SUPPLIER_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const RFQ_STATUS: Record<string, { label: string; tone: "done" | "electric" | "wait" | "ok" | "bad" }> = {
  draft: { label: "Brouillon", tone: "done" },
  sent: { label: "Envoyée", tone: "electric" },
  answered: { label: "Réponses reçues", tone: "wait" },
  awarded: { label: "Attribuée", tone: "ok" },
  cancelled: { label: "Annulée", tone: "bad" },
};

/** Statut affiché : « Réponses reçues » dès qu'un devis est arrivé sur une demande envoyée. */
export const rfqDisplayStatus = (r: { status: string; quotes: unknown[] }) => (r.status === "sent" && r.quotes.length > 0 ? "answered" : r.status);

export const QUOTE_STATUS: Record<QuoteStatus, string> = { submitted: "Devis envoyé", retained: "Retenu", rejected: "Non retenu" };

export const SPEAKER_STATUS: Record<ApplicationStatus, string> = { pending: "À traiter", retained: "Retenu", rejected: "Non retenu", declined: "Honoraires déclinés" };

/**
 * Agence consultée comme prestataire sur une demande de l'événement qu'elle pilote : conflit d'intérêts.
 * Sur cette demande, l'utilisateur ne voit que le devis et les échanges de son organisation, et n'agit pas
 * pour le client (ni envoyer, ni retenir, ni proposer, ni annuler, ni écrire aux autres prestataires).
 */
export const rfqConflict = (supplierIds: string[], ownOrgIds: string[]) => supplierIds.some((id) => ownOrgIds.includes(id));

/** Ce que l'utilisateur voit d'une demande : tout, ou seulement ce qui concerne son organisation en cas de conflit. */
export function rfqView<R extends { suppliers: { supplierId: string }[]; quotes: { supplierId: string }[]; messages: { supplierId: string }[] }>(r: R, ownOrgIds: string[]) {
  const conflicted = rfqConflict(r.suppliers.map((s) => s.supplierId), ownOrgIds);
  if (!conflicted) return { ...r, conflicted };
  const mine = (x: { supplierId: string }) => ownOrgIds.includes(x.supplierId);
  return { ...r, conflicted, suppliers: r.suppliers.filter(mine), quotes: r.quotes.filter(mine), messages: r.messages.filter(mine) };
}

/** Annuler une demande : l'organisation cliente (organisateurs) ou l'auteur de la demande, jamais en conflit d'intérêts. */
export const canCancelRfq = (p: { organizer: boolean; author: boolean; conflicted: boolean }) => !p.conflicted && (p.organizer || p.author);
