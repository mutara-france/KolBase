/**
 * Offres et règles de facturation (module pur, testé).
 * - Organisation : 599 € HT/mois, à partir de la première action qui engage un tiers (sollicitation envoyée,
 *   appel à candidatures ou événement publié, demande de devis envoyée).
 * - Prestataire : référencement gratuit ; 249 € HT/mois à partir du premier devis retenu via KolBase.
 * - Premier mois offert (une fois), sans engagement ; gratuités accordées par KolBase.
 */
export const PLANS = {
  organisation: { label: "Abonnement organisation", cents: 59900 },
  prestataire: { label: "Abonnement prestataire", cents: 24900 },
} as const;
export type Plan = keyof typeof PLANS;
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
export const formatPrice = (cents: number) => `${(cents / 100).toLocaleString("fr-FR")} € HT par mois`;
