import { applyStripeSubscription } from "@/lib/billing";
import { stripe, type StripeSubscription } from "@/lib/stripe";
import { verifyWebhook } from "@/lib/stripe-core";
import { db } from "@/lib/db";
import { notifyPaymentFailed } from "@/lib/notifications";

/**
 * Notifications Stripe (déclarer <APP_URL>/api/stripe/webhook chez Stripe, secret dans STRIPE_WEBHOOK_SECRET) :
 * paiement terminé, abonnement créé, modifié ou résilié, échec de paiement.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Non configuré." }, { status: 503 });
  const payload = await req.text();
  if (!verifyWebhook(payload, req.headers.get("stripe-signature") ?? "", secret)) return Response.json({ error: "Signature invalide." }, { status: 400 });
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
  // Stripe peut envoyer deux fois le même événement, et pas forcément dans l'ordre : chacun n'est traité qu'une fois
  // (identifiant enregistré d'abord, retiré si le traitement échoue pour que Stripe réessaie).
  try {
    await db.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return Response.json({ received: true, duplicate: true });
    throw e;
  }
  try {
    await handle(event);
  } catch (e) {
    await db.stripeEvent.delete({ where: { id: event.id } }).catch(() => {});
    console.error("[stripe] notification en échec", event.type, event.id, e);
    return Response.json({ error: "Traitement impossible." }, { status: 500 });
  }
  return Response.json({ received: true });
}

async function handle(event: { type: string; data: { object: Record<string, unknown> } }) {
  const o = event.data.object;
  if (event.type === "checkout.session.completed") {
    const orgId = (o.metadata as Record<string, string> | undefined)?.orgId;
    if (orgId && typeof o.subscription === "string") await applyStripeSubscription(orgId, await stripe<StripeSubscription>("GET", `/v1/subscriptions/${o.subscription}`));
  } else if (event.type.startsWith("customer.subscription.")) {
    const s = o as unknown as StripeSubscription;
    const orgId = s.metadata?.orgId ?? (await db.subscription.findUnique({ where: { stripeSubscriptionId: s.id }, select: { organizationId: true } }))?.organizationId;
    // L'état courant est relu chez Stripe : une notification arrivée en retard n'écrase pas un état plus récent.
    if (orgId) await applyStripeSubscription(orgId, await stripe<StripeSubscription>("GET", `/v1/subscriptions/${s.id}`));
  } else if (event.type === "invoice.payment_failed") {
    const sub = await db.subscription.findFirst({ where: { stripeCustomerId: String(o.customer) }, select: { organizationId: true } });
    if (sub) notifyPaymentFailed(sub.organizationId);
  }
}
