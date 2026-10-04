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

export const QUOTE_STATUS: Record<string, string> = { submitted: "Devis envoyé", retained: "Retenu", rejected: "Non retenu" };

export const SPEAKER_STATUS: Record<string, string> = { pending: "À traiter", retained: "Retenu", rejected: "Non retenu" };
