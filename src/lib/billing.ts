import "server-only";
import { db } from "@/lib/db";
import { stripe, stripeEnabled, type StripeSubscription } from "@/lib/stripe";
import { asInterval, asObjectId, canEngage, ENGAGING, fromStripeStatus, planFor, planPrice, PLANS, subscribeHref, TRIAL_DAYS, type Blocked, type GateLink, type Interval, type Motive } from "@/lib/billing-plans";
import { dpaCurrent, dpaHref, dpaMessage } from "@/lib/dpa";

export { stripeEnabled };

/** Une action engageante est-elle possible pour cette organisation ? (toujours, si la facturation n'est pas activée) */
export async function engagementAllowed(orgId: string) {
  if (!stripeEnabled()) return true;
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { status: true, exemptUntil: true } });
  return canEngage(sub);
}

/** Message d'une action refusée faute d'abonnement (chemin de la page d'abonnement donné en clair). */
export const gateMessage = (motive: Motive) => `Pour ${ENGAGING[motive]}, un administrateur de l'organisation active l'abonnement (premier mois offert) : menu du compte › Abonnement.`;

/** L'action engageante est-elle bloquée faute d'abonnement ? (prestataire : réponse à une nouvelle demande) */
export async function billingBlocked(orgId: string, motive: Motive) {
  if (!stripeEnabled()) return false;
  return motive === "reponse" ? !(await supplierCanQuote(orgId)) : !(await engagementAllowed(orgId));
}

/** Contrat de sous-traitance (RGPD) accepté dans sa version en vigueur ? (toujours vrai pour un prestataire) */
export async function dpaAccepted(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true, dpaVersion: true } });
  return !!org && dpaCurrent(org);
}

/**
 * Contrôle commun des actions qui engagent un tiers (sollicitations, appel, événement, demande de devis) :
 * contrat de sous-traitance accepté, puis abonnement. Renvoie le refus (message et lien vers la page qui lève
 * le blocage) ou null. `objet` : l'action à reprendre ensuite (événement, dossier, demande de devis).
 */
export async function engagementGate(orgId: string, motive: Motive, objet?: string | null): Promise<{ error: string; fix: GateLink } | null> {
  if (!(await dpaAccepted(orgId))) return { error: dpaMessage(motive), fix: { href: dpaHref(orgId, motive, objet), label: "Accepter le contrat de sous-traitance" } };
  if (!(await engagementAllowed(orgId))) return { error: gateMessage(motive), fix: { href: subscribeHref(orgId, motive, objet), label: "Activer l'abonnement" } };
  return null;
}

/** Ce qui bloque l'action sur la page (bouton désactivé, bandeau) : le contrat, puis l'abonnement. */
export async function engagementBlock(orgId: string, motive: Motive): Promise<Blocked> {
  if (motive !== "reponse" && !(await dpaAccepted(orgId))) return "contrat";
  return (await billingBlocked(orgId, motive)) ? "abonnement" : null;
}

/** Un prestataire peut-il répondre à de nouvelles demandes ? Gratuit jusqu'à son premier devis retenu. */
export async function supplierCanQuote(supplierId: string) {
  if (!stripeEnabled()) return true;
  const sub = await db.subscription.findUnique({ where: { organizationId: supplierId }, select: { status: true, exemptUntil: true } });
  if (canEngage(sub)) return true;
  const won = await db.quote.count({ where: { supplierId, status: "retained" } });
  return won === 0;
}

/** Premier devis retenu d'un prestataire : l'abonnement est à activer (renvoie true si c'est le premier). */
export async function markSupplierTriggered(supplierId: string, label: string) {
  const existing = await db.subscription.findUnique({ where: { organizationId: supplierId } });
  if (existing?.triggeredAt) return false;
  await db.subscription.upsert({
    where: { organizationId: supplierId },
    update: { triggeredAt: new Date(), triggeredBy: label },
    create: { organizationId: supplierId, plan: "prestataire", status: "a_activer", triggeredAt: new Date(), triggeredBy: label },
  });
  return true;
}

const date = (sec: number | null | undefined) => (sec ? new Date(sec * 1000) : null);

/** Enregistre l'état d'un abonnement Stripe (notification, retour de paiement). */
export async function applyStripeSubscription(orgId: string, s: StripeSubscription) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
  if (!org) return;
  const status = fromStripeStatus(s.status);
  const data = {
    status, stripeCustomerId: s.customer, stripeSubscriptionId: s.id, trialEndsAt: date(s.trial_end), currentPeriodEnd: date(s.current_period_end),
    cancelAtPeriodEnd: !!s.cancel_at_period_end, ...(status === "essai" ? { trialUsed: true } : {}),
    interval: asInterval(s.items?.data?.[0]?.price?.recurring?.interval ?? s.metadata?.interval),
  };
  await db.subscription.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, plan: planFor(org.kind), ...data } });
}

/** Page de paiement Stripe (mensuel ou annuel, premier mois offert si jamais utilisé). */
export async function checkoutUrl(orgId: string, adminEmail: string, interval: Interval = "month", back: { motive?: Motive | null; objet?: string | null } = {}) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, include: { subscription: true } });
  const plan = PLANS[planFor(org.kind)];
  const amount = planPrice(planFor(org.kind), interval);
  let customer = org.subscription?.stripeCustomerId ?? null;
  if (!customer) {
    const c = await stripe<{ id: string }>("POST", "/v1/customers", { email: adminEmail, name: org.legalName ?? org.name, metadata: { orgId, siren: org.siren ?? "" } });
    customer = c.id;
    await db.subscription.upsert({ where: { organizationId: orgId }, update: { stripeCustomerId: customer }, create: { organizationId: orgId, plan: planFor(org.kind), stripeCustomerId: customer } });
  }
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const taxRate = process.env.STRIPE_TAX_RATE;
  const session = await stripe<{ url: string }>("POST", "/v1/checkout/sessions", {
    mode: "subscription",
    customer,
    locale: "fr",
    payment_method_types: ["card", "sepa_debit"],
    billing_address_collection: "required",
    customer_update: { name: "auto", address: "auto" },
    tax_id_collection: { enabled: true },
    line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: amount, recurring: { interval }, tax_behavior: "exclusive", product_data: { name: `KolBase — ${plan.label}${interval === "year" ? " (annuel)" : ""}` } } }],
    subscription_data: { metadata: { orgId, interval }, ...(org.subscription?.trialUsed ? {} : { trial_period_days: TRIAL_DAYS }), ...(taxRate ? { default_tax_rates: [taxRate] } : {}) },
    metadata: { orgId, interval },
    // Retour : message « Abonnement activé » et, si une action attendait, lien pour la reprendre.
    success_url: `${app}/organisations/${orgId}/abonnement?session={CHECKOUT_SESSION_ID}${back.motive ? `&motif=${back.motive}` : ""}${back.motive && asObjectId(back.objet) ? `&objet=${back.objet}` : ""}`,
    cancel_url: `${app}/organisations/${orgId}/abonnement?annule=1`,
  });
  return session.url;
}

/** Retour du paiement : synchronise sans attendre la notification Stripe. */
export async function syncCheckout(orgId: string, sessionId: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  const s = await stripe<{ metadata?: Record<string, string>; subscription: StripeSubscription | string | null }>("GET", `/v1/checkout/sessions/${sessionId}`, { expand: ["subscription"] });
  if (s.metadata?.orgId !== orgId || !s.subscription || typeof s.subscription === "string") return;
  await applyStripeSubscription(orgId, s.subscription);
}

/** Espace client Stripe : moyen de paiement, factures, résiliation. */
export async function portalUrl(orgId: string) {
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId } });
  if (!sub?.stripeCustomerId) return null;
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const p = await stripe<{ url: string }>("POST", "/v1/billing_portal/sessions", { customer: sub.stripeCustomerId, return_url: `${app}/organisations/${orgId}/abonnement` });
  return p.url;
}
