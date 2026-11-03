import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { stripe, stripeEnabled } from "@/lib/stripe";

/** Statuts d'une commande de service. */
export const ORDER_STATUS: Record<string, { label: string; tone: string }> = {
  demandee: { label: "Demandée", tone: "wait" },
  planifiee: { label: "Planifiée", tone: "electric" },
  realisee: { label: "Réalisée", tone: "ok" },
  refusee: { label: "Refusée", tone: "bad" },
  annulee: { label: "Annulée", tone: "done" },
};
export const OPEN_ORDER = ["demandee", "planifiee"];
export const FEATURE_DAYS = 7;

/** Événements « à la une » : service réalisé depuis moins de sept jours, événement publié et à venir. */
export async function featuredEventIds(now = new Date()) {
  const orders = await db.serviceOrder.findMany({
    where: { status: "realisee", offer: { kind: "une" }, doneAt: { gte: new Date(now.getTime() - FEATURE_DAYS * 86400e3) }, event: { publishedAt: { not: null }, startsAt: { gte: now } } },
    select: { eventId: true },
    orderBy: { doneAt: "desc" },
  });
  return [...new Set(orders.map((o) => o.eventId))];
}

/** Membres qui ont accepté de recevoir la lettre d'information (adresse confirmée). */
export function newsletterAudience() {
  return db.user.findMany({
    where: { notifyPrefs: { path: ["newsletter"], equals: true }, emailVerifiedAt: { not: null } },
    select: { id: true, email: true, firstName: true, locale: true, unsubscribeToken: true },
  });
}

/** Jeton de désinscription d'un membre (créé à la première lettre). */
export async function unsubscribeToken(userId: string, current: string | null) {
  if (current) return current;
  const token = randomBytes(18).toString("base64url");
  await db.user.update({ where: { id: userId }, data: { unsubscribeToken: token } });
  return token;
}

/** Facturation d'un service réalisé : ligne ajoutée à la prochaine facture Stripe de l'organisation, sinon à facturer à part. */
export async function invoiceOrder(orderId: string) {
  const o = await db.serviceOrder.findUnique({ where: { id: orderId }, include: { event: { select: { title: true } }, organization: { select: { subscription: { select: { stripeCustomerId: true } } } } } });
  if (!o || o.invoicedAt) return null;
  const customer = o.organization.subscription?.stripeCustomerId;
  if (!stripeEnabled() || !customer || o.priceCents <= 0) {
    await db.serviceOrder.update({ where: { id: o.id }, data: { invoiceRef: o.priceCents <= 0 ? "offert" : "à facturer hors Stripe" } });
    return null;
  }
  const item = await stripe<{ id: string }>("POST", "/v1/invoiceitems", { customer, amount: o.priceCents, currency: "eur", description: `${o.label} — ${o.event.title}`, metadata: { orderId: o.id } });
  await db.serviceOrder.update({ where: { id: o.id }, data: { invoicedAt: new Date(), invoiceRef: item.id } });
  return item.id;
}
