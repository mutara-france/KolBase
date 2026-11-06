/**
 * Offres et règles de facturation (module pur, testé).
 * - Organisation : 599 € HT/mois, à partir de la première action qui engage un tiers (sollicitation envoyée,
 *   appel à candidatures ou événement publié, demande de devis envoyée).
 * - Sociétés savantes, associations professionnelles et organismes de formation : publier un événement dans l'agenda
 *   reste gratuit (l'agenda public est le produit d'appel) ; leurs autres actions engageantes restent sur abonnement.
 * - Prestataire : référencement gratuit ; 249 € HT/mois à partir du premier devis retenu via KolBase.
 * - Premier mois offert (une fois), sans engagement ; gratuités accordées par KolBase.
 * - Formule annuelle : dix mois payés pour douze (deux mois offerts).
 */
import type { SubscriptionStatus } from "@/generated/prisma/client";

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
/**
 * Facturation Stripe d'un abonnement en cours : en pause sans date de reprise pendant une suspension par KolBase ; en
 * pause jusqu'à la fin d'une gratuité en cours (reprise automatique) ; sinon facturée normalement.
 */
export function stripePause(o: { suspended: boolean; exemptUntil: Date | null | undefined }, now = new Date()): { pause: false } | { pause: true; resumesAt: Date | null } {
  if (o.suspended) return { pause: true, resumesAt: null };
  if (o.exemptUntil && o.exemptUntil > now) return { pause: true, resumesAt: o.exemptUntil };
  return { pause: false };
}
/** Statut affiché : la gratuité prime. */
export const displayStatus = (s: SubLike, now = new Date()) => (exempt(s, now) ? "offerte" : s?.status ?? "aucun");
/** Actions engageantes autorisées : gratuité, mois offert, abonnement actif, ou paiement en cours de relance. */
export const canEngage = (s: SubLike, now = new Date()) => exempt(s, now) || ["essai", "active", "impayee"].includes(s?.status ?? "");

/** Statut Stripe d'un abonnement → statut KolBase. */
export const fromStripeStatus = (st: string): SubscriptionStatus =>
  st === "trialing" ? "essai" : st === "active" ? "active" : st === "past_due" || st === "unpaid" ? "impayee" : st === "canceled" || st === "incomplete_expired" ? "resiliee" : "a_activer";

/** Actions qui déclenchent l'abonnement d'une organisation (libellés des messages). */
export const ENGAGING = {
  sollicitation: "envoyer des sollicitations aux experts",
  appel: "publier une opportunité",
  evenement: "publier un événement dans l'agenda",
  devis: "envoyer une demande de devis",
  reponse: "répondre à de nouvelles demandes de devis",
  proposition: "accepter le projet proposé par un expert",
} as const;
export type Motive = keyof typeof ENGAGING;

/** Organisations qui publient leurs événements gratuitement : sociétés savantes, associations, organismes de formation. */
export const FREE_EVENT_KINDS: readonly string[] = ["SOCIETE_SAVANTE", "ASSOCIATION_PRO", "ORGANISME_FORMATION"];
/** Cette action engageante demande-t-elle l'abonnement pour ce type d'organisation ? */
export const needsSubscription = (kind: string, motive: Motive) => !(motive === "evenement" && FREE_EVENT_KINDS.includes(kind));
export const asMotive = (v: unknown): Motive | null => (typeof v === "string" && Object.hasOwn(ENGAGING, v) ? (v as Motive) : null);
/** Identifiant d'objet (événement, dossier, demande de devis) passé dans une adresse : sinon ignoré. */
export const asObjectId = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);

/** Lien joint au refus d'une action engageante : la page qui lève le blocage. */
export type GateLink = { href: string; label: string };
/** Ce qui bloque une action engageante sur une page (bouton désactivé) : contrat de sous-traitance, puis abonnement. */
/** Ce qui bloque une action engageante, dans l'ordre : validation de l'organisation, contrat, abonnement. */
export type Blocked = "validation" | "contrat" | "abonnement" | null;
/** Fin de la consigne affichée sous un bouton désactivé (« Envoi possible … »). */
export const BLOCKED_UNTIL = {
  validation: "une fois l'organisation validée par KolBase",
  contrat: "une fois le contrat de sous-traitance accepté par un administrateur",
  abonnement: "une fois l'abonnement activé",
} as const;

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
    case "appel": return { href: `${base}/opportunites#nouvel-appel`, label: "Publier l'opportunité" };
    case "devis": return { href: id ? `${base}/prestataires#rfq-${id}` : `${base}/prestataires?onglet=nouvelle`, label: "Envoyer la demande de devis" };
    case "reponse": return { href: `${base}/devis`, label: "Répondre aux demandes de devis" };
    case "proposition": return { href: id ? `${base}/dossiers/${id}` : `${base}/dossiers`, label: "Revenir à la proposition" };
    default: return null;
  }
}
/** Traduction (t de la langue d'affichage) ; par défaut, le texte français avec ses variables. */
type Tr = (key: string, vars?: Record<string, string | number>) => string;
const fr: Tr = (key, vars) => key.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""));
export const formatPrice = (cents: number, interval: Interval = "month", t: Tr = fr, loc = "fr-FR") =>
  t(interval === "year" ? "{amount} € HT par an" : "{amount} € HT par mois", { amount: (cents / 100).toLocaleString(loc) });

/** Ce que l'abonnement représente pour l'organisation, en une phrase (prise en main). */
export function billingInfo(kind: string, s: SubLike, now = new Date(), t: Tr = fr, loc = "fr-FR") {
  const status = displayStatus(s, now);
  if (status === "offerte") return t("Abonnement : offert par KolBase jusqu'au {date}.", { date: s!.exemptUntil!.toLocaleDateString(loc, { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }) });
  if (status === "essai" || status === "active") return t("Abonnement : {status}.", { status: t(STATUS_LABEL[status]).toLowerCase() });
  if (status === "impayee") return t("Abonnement : paiement en attente, vérifiez votre moyen de paiement.");
  const price = formatPrice(PLANS[planFor(kind)].cents, "month", t, loc);
  const yearPrice = formatPrice(PLANS.organisation.yearCents, "year", t, loc);
  return kind === "PRESTATAIRE"
    ? t("Abonnement : référencement gratuit ; {price} seulement après un premier devis retenu, pour répondre à de nouvelles demandes (premier mois offert).", { price })
    : FREE_EVENT_KINDS.includes(kind)
      ? t("Abonnement : création, équipe, annuaire, brouillons et publication d'événements gratuits ; {price} (ou {yearPrice}) dès la première sollicitation, la première opportunité publiée ou la première demande de devis, premier mois offert.", { price, yearPrice })
      : t("Abonnement : création, équipe, annuaire et brouillons gratuits ; {price} (ou {yearPrice}) dès la première action qui engage un tiers, premier mois offert.", { price, yearPrice });
}
