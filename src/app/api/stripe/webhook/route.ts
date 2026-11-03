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
  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  const o = event.data.object;
  if (event.type === "checkout.session.completed") {
    const orgId = (o.metadata as Record<string, string> | undefined)?.orgId;
    if (orgId && typeof o.subscription === "string") await applyStripeSubscription(orgId, await stripe<StripeSubscription>("GET", `/v1/subscriptions/${o.subscription}`));
  } else if (event.type.startsWith("customer.subscription.")) {
    const s = o as unknown as StripeSubscription;
    const orgId = s.metadata?.orgId ?? (await db.subscription.findUnique({ where: { stripeSubscriptionId: s.id }, select: { organizationId: true } }))?.organizationId;
    if (orgId) await applyStripeSubscription(orgId, event.type === "customer.subscription.deleted" ? { ...s, status: "canceled" } : s);
  } else if (event.type === "invoice.payment_failed") {
    const sub = await db.subscription.findFirst({ where: { stripeCustomerId: String(o.customer) }, select: { organizationId: true } });
    if (sub) notifyPaymentFailed(sub.organizationId);
  }
  return Response.json({ received: true });
}
