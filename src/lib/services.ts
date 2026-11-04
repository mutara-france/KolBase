import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { stripe, stripeEnabled } from "@/lib/stripe";
import { FEATURE_DAYS, featuredUntil } from "@/lib/service-pack";

/** Statuts d'une commande de service. */
export const ORDER_STATUS: Record<string, { label: string; tone: string }> = {
  demandee: { label: "Demandée", tone: "wait" },
  planifiee: { label: "Planifiée", tone: "electric" },
  realisee: { label: "Réalisée", tone: "ok" },
  refusee: { label: "Refusée", tone: "bad" },
  annulee: { label: "Annulée", tone: "done" },
};
export const OPEN_ORDER = ["demandee", "planifiee"];
export { FEATURE_DAYS, featuredUntil };

/** Délai avant l'envoi du bilan d'un service réalisé (ou dès que l'événement a eu lieu). */
export const REPORT_DELAY_DAYS = 7;
/** Durée du cookie d'attribution posé par un lien suivi. */
export const SOURCE_COOKIE = "kb_src";
export const SOURCE_COOKIE_DAYS = 30;

/** Code du lien suivi d'une commande (/r/<code>). */
export const newTrackCode = () => randomBytes(6).toString("base64url");
export const trackedPath = (code: string) => `/r/${code}`;

/** Événements « à la une » : service réalisé depuis moins de sept jours, événement publié et à venir (lien suivi). */
export async function featuredEvents(now = new Date()) {
  const orders = await db.serviceOrder.findMany({
    where: { status: "realisee", offer: { kind: "une" }, doneAt: { gte: new Date(now.getTime() - FEATURE_DAYS * 86400e3) }, event: { publishedAt: { not: null }, startsAt: { gte: now }, organization: { verification: "VERIFIED" } } },
    select: { eventId: true, trackCode: true },
    orderBy: { doneAt: "desc" },
  });
  const byEvent = new Map<string, string | null>();
  for (const o of orders) if (!byEvent.has(o.eventId)) byEvent.set(o.eventId, o.trackCode);
  return byEvent;
}
export const featuredEventIds = async (now = new Date()) => [...(await featuredEvents(now)).keys()];

export type OrderStats = { clicks: number; registrations: number; recipients: number | null; since: number | null };

/**
 * Bilan d'une ou plusieurs commandes : visiteurs uniques du lien suivi, inscriptions arrivées par ce lien,
 * destinataires (e-mailing) et inscriptions à l'événement depuis la réalisation (contexte).
 */
export async function orderStats(orders: { id: string; eventId: string; doneAt: Date | null }[]) {
  const ids = orders.map((o) => o.id);
  const stats = new Map<string, OrderStats>();
  if (ids.length === 0) return stats;
  const [visitors, regs, campaigns] = await Promise.all([
    db.serviceClick.groupBy({ by: ["orderId", "visitor"], where: { orderId: { in: ids } } }),
    db.registration.groupBy({ by: ["sourceOrderId"], where: { sourceOrderId: { in: ids } }, _count: true }),
    db.newsletterCampaign.findMany({ where: { orderId: { in: ids } }, select: { orderId: true, recipients: true } }),
  ]);
  for (const o of orders) {
    const since = o.doneAt ? await db.registration.count({ where: { eventId: o.eventId, createdAt: { gte: o.doneAt } } }) : null;
    stats.set(o.id, {
      clicks: visitors.filter((v) => v.orderId === o.id).length,
      registrations: regs.find((r) => r.sourceOrderId === o.id)?._count ?? 0,
      recipients: campaigns.find((c) => c.orderId === o.id)?.recipients ?? null,
      since,
    });
  }
  return stats;
}

/** Lecture des liens suivis par des robots (aperçus de liens, antivirus des messageries) : non comptée. */
export const isBot = (ua: string) => !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|proofpoint|mimecast|barracuda|safelinks|scanner|curl|wget|python|headless/i.test(ua);

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
