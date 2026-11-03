import "server-only";
import { db } from "@/lib/db";
import { stripe, stripeEnabled, type StripeSubscription } from "@/lib/stripe";
import { canEngage, ENGAGING, fromStripeStatus, planFor, PLANS, TRIAL_DAYS, type Motive } from "@/lib/billing-plans";

export { stripeEnabled };

/** Une action engageante est-elle possible pour cette organisation ? (toujours, si la facturation n'est pas activée) */
export async function engagementAllowed(orgId: string) {
  if (!stripeEnabled()) return true;
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { status: true, exemptUntil: true } });
  return canEngage(sub);
}

/** Message d'une action refusée faute d'abonnement (l'adresse de la page d'abonnement est donnée en clair). */
export const gateMessage = (motive: Motive) => `Pour ${ENGAGING[motive]}, un administrateur de l'organisation active l'abonnement (premier mois offert) : Membres et réglages › Abonnement.`;

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
  };
  await db.subscription.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, plan: planFor(org.kind), ...data } });
}

/** Page de paiement Stripe (abonnement mensuel, premier mois offert si jamais utilisé). */
export async function checkoutUrl(orgId: string, adminEmail: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, include: { subscription: true } });
  const plan = PLANS[planFor(org.kind)];
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
    line_items: [{ quantity: 1, price_data: { currency: "eur", unit_amount: plan.cents, recurring: { interval: "month" }, tax_behavior: "exclusive", product_data: { name: `KolBase — ${plan.label}` } } }],
    subscription_data: { metadata: { orgId }, ...(org.subscription?.trialUsed ? {} : { trial_period_days: TRIAL_DAYS }), ...(taxRate ? { default_tax_rates: [taxRate] } : {}) },
    metadata: { orgId },
    success_url: `${app}/organisations/${orgId}/abonnement?session={CHECKOUT_SESSION_ID}`,
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
