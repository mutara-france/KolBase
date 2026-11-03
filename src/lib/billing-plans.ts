/**
 * Offres et règles de facturation (module pur, testé).
 * - Organisation : 599 € HT/mois, à partir de la première action qui engage un tiers (sollicitation envoyée,
 *   appel à candidatures ou événement publié, demande de devis envoyée).
 * - Prestataire : référencement gratuit ; 249 € HT/mois à partir du premier devis retenu via KolBase.
 * - Premier mois offert (une fois), sans engagement ; gratuités accordées par KolBase.
 * - Formule annuelle : dix mois payés pour douze (deux mois offerts).
 */
export const PLANS = {
  organisation: { label: "Abonnement organisation", cents: 59900, yearCents: 599000 },
  prestataire: { label: "Abonnement prestataire", cents: 24900, yearCents: 249000 },
} as const;
export type Plan = keyof typeof PLANS;
export type Interval = "month" | "year";
export const asInterval = (v: unknown): Interval => (v === "year" ? "year" : "month");
/** Prix d'une échéance (centimes HT). */
export const planPrice = (plan: Plan, interval: Interval) => (interval === "year" ? PLANS[plan].yearCents : PLANS[plan].cents);
/** Équivalent mensuel (revenu mensuel récurrent, affichage « soit … par mois »). */
export const monthlyCents = (plan: Plan, interval: Interval) => Math.round(planPrice(plan, interval) / (interval === "year" ? 12 : 1));
/** Mois offerts par la formule annuelle. */
export const freeMonths = (plan: Plan) => Math.round(12 - PLANS[plan].yearCents / PLANS[plan].cents);
export const TRIAL_DAYS = 30;
export const planFor = (kind: string): Plan => (kind === "PRESTATAIRE" ? "prestataire" : "organisation");

export const STATUS_LABEL: Record<string, string> = {
  aucun: "Pas encore d'abonnement",
  a_activer: "À activer",
  essai: "Premier mois offert",
  active: "Actif",
  impayee: "Paiement en attente",
  resiliee: "Résilié",
  offerte: "Offert par KolBase",
};

export type SubLike = { status: string; exemptUntil: Date | null } | null | undefined;
export const exempt = (s: SubLike, now = new Date()) => !!s?.exemptUntil && s.exemptUntil > now;
/** Statut affiché : la gratuité prime. */
export const displayStatus = (s: SubLike, now = new Date()) => (exempt(s, now) ? "offerte" : s?.status ?? "aucun");
/** Actions engageantes autorisées : gratuité, mois offert, abonnement actif, ou paiement en cours de relance. */
export const canEngage = (s: SubLike, now = new Date()) => exempt(s, now) || ["essai", "active", "impayee"].includes(s?.status ?? "");

/** Statut Stripe d'un abonnement → statut KolBase. */
export const fromStripeStatus = (st: string) =>
  st === "trialing" ? "essai" : st === "active" ? "active" : st === "past_due" || st === "unpaid" ? "impayee" : st === "canceled" || st === "incomplete_expired" ? "resiliee" : "a_activer";

/** Actions qui déclenchent l'abonnement d'une organisation (libellés des messages). */
export const ENGAGING = {
  sollicitation: "envoyer des sollicitations aux experts",
  appel: "publier un appel à candidatures",
  evenement: "publier un événement dans l'agenda",
  devis: "envoyer une demande de devis",
  reponse: "répondre à de nouvelles demandes de devis",
} as const;
export type Motive = keyof typeof ENGAGING;
export const asMotive = (v: unknown): Motive | null => (typeof v === "string" && Object.hasOwn(ENGAGING, v) ? (v as Motive) : null);
/** Identifiant d'objet (événement, dossier, demande de devis) passé dans une adresse : sinon ignoré. */
export const asObjectId = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);

/** Page d'abonnement avec le motif (et l'objet) de l'action en attente : le retour de paiement y ramène. */
export const subscribeHref = (orgId: string, motive: Motive, objet?: string | null) =>
  `/organisations/${orgId}/abonnement?motif=${motive}${asObjectId(objet) ? `&objet=${objet}` : ""}`;

/**
 * Après l'activation de l'abonnement : lien pour reprendre l'action qui l'a demandée.
 * `publish` : pour un événement connu, le bouton « Publier maintenant » publie directement.
 */
export function resumeAction(orgId: string, motive: Motive | null, objet?: string | null): { href: string; label: string; publish?: string } | null {
  const base = `/organisations/${orgId}`;
  const id = asObjectId(objet);
  switch (motive) {
    case "evenement": return id ? { href: `${base}/evenements/${id}`, label: "Publier maintenant", publish: id } : { href: `${base}/evenements`, label: "Revenir aux événements" };
    case "sollicitation": return id ? { href: `${base}/dossiers/${id}#modifier`, label: "Revenir au dossier" } : { href: `${base}/dossiers/nouveau`, label: "Envoyer les sollicitations" };
    case "appel": return { href: `${base}/opportunites#nouvel-appel`, label: "Publier l'appel" };
    case "devis": return { href: id ? `${base}/prestataires#rfq-${id}` : `${base}/prestataires?onglet=nouvelle`, label: "Envoyer la demande de devis" };
    case "reponse": return { href: `${base}/devis`, label: "Répondre aux demandes de devis" };
    default: return null;
  }
}
export const formatPrice = (cents: number, interval: Interval = "month") => `${(cents / 100).toLocaleString("fr-FR")} € HT par ${interval === "year" ? "an" : "mois"}`;

/** Ce que l'abonnement représente pour l'organisation, en une phrase (prise en main). */
export function billingInfo(kind: string, s: SubLike, now = new Date()) {
  const status = displayStatus(s, now);
  if (status === "offerte") return `Abonnement : offert par KolBase jusqu'au ${s!.exemptUntil!.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" })}.`;
  if (status === "essai" || status === "active") return `Abonnement : ${STATUS_LABEL[status].toLowerCase()}.`;
  if (status === "impayee") return "Abonnement : paiement en attente, vérifiez votre moyen de paiement.";
  return kind === "PRESTATAIRE"
    ? `Abonnement : référencement gratuit ; ${formatPrice(PLANS.prestataire.cents)} seulement après un premier devis retenu, pour répondre à de nouvelles demandes (premier mois offert).`
    : `Abonnement : création, équipe, annuaire et brouillons gratuits ; ${formatPrice(PLANS.organisation.cents)} (ou ${formatPrice(PLANS.organisation.yearCents, "year")}) dès la première action qui engage un tiers, premier mois offert.`;
}
