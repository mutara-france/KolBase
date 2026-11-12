import "server-only";
import { db } from "@/lib/db";
import { stripe, stripeEnabled, type StripeSubscription } from "@/lib/stripe";
import { addonPrice, ADDONS, addonsFor, addonsFromStripe, asInterval, asObjectId, canEngage, ENGAGING, fromStripeStatus, needsSubscription, planFor, planPrice, PLANS, RUNNING, stripePause, subscribeHref, TRIAL_DAYS, type Addon, type Blocked, type GateLink, type Interval, type Motive } from "@/lib/billing-plans";
import { dpaCurrent, dpaHref, dpaMessage } from "@/lib/dpa";
import { makeT, type T } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export { stripeEnabled };

/** Une action engageante est-elle possible pour cette organisation ? (toujours, si la facturation n'est pas activée) */
async function engagementAllowed(orgId: string) {
  if (!stripeEnabled()) return true;
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { status: true, exemptUntil: true } });
  return canEngage(sub);
}

/** Message d'une action refusée faute d'abonnement (chemin de la page d'abonnement donné en clair). */
export const gateMessage = (motive: Motive, t: T = makeT("fr")) =>
  t("Pour {motive}, un administrateur de l'organisation active l'abonnement (premier mois offert) : menu du compte › Abonnement.", { motive: t(ENGAGING[motive]) });

/**
 * L'action engageante est-elle bloquée faute d'abonnement ? (prestataire : réponse à une nouvelle demande ; société
 * savante, association ou organisme de formation : la publication d'un événement reste gratuite)
 */
export async function billingBlocked(orgId: string, motive: Motive) {
  if (!stripeEnabled()) return false;
  if (motive === "reponse") return !(await supplierCanQuote(orgId));
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true } });
  if (org && !needsSubscription(org.kind, motive)) return false;
  return !(await engagementAllowed(orgId));
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
  const { t } = await getT();
  if (!(await dpaAccepted(orgId))) return { error: dpaMessage(motive, t), fix: { href: dpaHref(orgId, motive, objet), label: t("Accepter le contrat de sous-traitance") } };
  if (await billingBlocked(orgId, motive)) return { error: gateMessage(motive, t), fix: { href: subscribeHref(orgId, motive, objet), label: t("Activer l'abonnement") } };
  return null;
}

/**
 * Ce qui bloque l'action sur la page (bouton désactivé, consigne, bandeau), dans l'ordre réel : la validation de
 * l'organisation par KolBase, puis le contrat, puis l'abonnement.
 */
export async function engagementBlock(orgId: string, motive: Motive): Promise<Blocked> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { verification: true } });
  if (org && org.verification !== "VERIFIED") return "validation";
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
    // Options : les lignes de l'abonnement Stripe font foi (ajout, retrait, résiliation).
    addons: addonsFromStripe(s.items?.data ?? []),
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

/**
 * Facturation Stripe alignée sur l'état de l'organisation (stripePause) : suspendue, en pause sans date de reprise ;
 * gratuité en cours, en pause jusqu'à sa fin (reprise automatique, resumes_at) ; sinon, facturation normale.
 * pause_collection « void » : rien n'est facturé pendant la pause. Appelée après la suspension, la réactivation et la
 * gratuité (accordée ou retirée). Renvoie ce qui a été fait (null : pas d'abonnement Stripe en cours).
 */
export async function syncStripePause(orgId: string): Promise<"paused" | "resumed" | null> {
  const [sub, org] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId: orgId }, select: { stripeSubscriptionId: true, status: true, exemptUntil: true } }),
    db.organization.findUnique({ where: { id: orgId }, select: { verification: true } }),
  ]);
  if (!stripeEnabled() || !sub?.stripeSubscriptionId || !["essai", "active", "impayee"].includes(sub.status)) return null;
  const p = stripePause({ suspended: org?.verification === "SUSPENDED", exemptUntil: sub.exemptUntil });
  await stripe("POST", `/v1/subscriptions/${sub.stripeSubscriptionId}`, p.pause
    ? { pause_collection: { behavior: "void", ...(p.resumesAt ? { resumes_at: Math.floor(p.resumesAt.getTime() / 1000) } : {}) } }
    : { pause_collection: "" });
  return p.pause ? "paused" : "resumed";
}

/** Espace client Stripe : moyen de paiement, factures, résiliation. */
export async function portalUrl(orgId: string) {
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId } });
  if (!sub?.stripeCustomerId) return null;
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const p = await stripe<{ url: string }>("POST", "/v1/billing_portal/sessions", { customer: sub.stripeCustomerId, return_url: `${app}/organisations/${orgId}/abonnement` });
  return p.url;
}

/** Produit Stripe de l'option, créé à la première souscription (identifiant fixe : il sert à relire les lignes). */
async function addonProduct(addon: Addon) {
  const { product, label } = ADDONS[addon];
  const found = await stripe<{ id: string }>("GET", `/v1/products/${product}`).catch(() => null);
  if (!found) await stripe("POST", "/v1/products", { id: product, name: label, metadata: { addon } });
  return product;
}

export type AddonChange = "added" | "removed" | "unchanged" | "no_subscription" | "not_offered";

/**
 * Ajoute ou retire une option sur l'abonnement Stripe en cours de l'organisation : une ligne de plus, à la périodicité
 * de l'abonnement et à son taux de TVA. Ajout : le prorata de la période en cours est facturé aussitôt (rien pendant
 * le mois offert). Retrait : l'option cesse aussitôt et la part non consommée est déduite de la prochaine facture.
 * L'état enregistré est celui que Stripe renvoie.
 */
export async function changeAddon(orgId: string, addon: Addon, on: boolean): Promise<AddonChange> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { kind: true, subscription: { select: { stripeSubscriptionId: true, status: true, interval: true } } } });
  if (!org || !addonsFor(org.kind).includes(addon)) return "not_offered";
  const sub = org.subscription;
  if (!sub?.stripeSubscriptionId || !RUNNING.includes(sub.status)) return "no_subscription";
  const path = `/v1/subscriptions/${sub.stripeSubscriptionId}`;
  const current = await stripe<StripeSubscription>("GET", path);
  const line = current.items?.data.find((i) => i.price?.product === ADDONS[addon].product);
  if (on === !!line) {
    await applyStripeSubscription(orgId, current);
    return "unchanged";
  }
  const interval = asInterval(current.items?.data[0]?.price?.recurring?.interval ?? sub.interval);
  const updated = on
    ? await stripe<StripeSubscription>("POST", path, {
        items: [{ quantity: 1, price_data: { currency: "eur", product: await addonProduct(addon), unit_amount: addonPrice(addon, interval), recurring: { interval }, tax_behavior: "exclusive" } }],
        proration_behavior: "always_invoice",
      })
    : await stripe<StripeSubscription>("POST", path, { items: [{ id: line!.id, deleted: true }], proration_behavior: "create_prorations" });
  await applyStripeSubscription(orgId, updated);
  return on ? "added" : "removed";
}
