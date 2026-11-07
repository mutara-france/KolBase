import "server-only";
import { db } from "@/lib/db";
import { quoteTtc } from "@/lib/quotes";

export const PHOTO_MAX_BYTES = 800 * 1024;
/** Réalisations en images de la vitrine d'un prestataire. */
export const PHOTO_MAX = 12;
/** Bannière de la vitrine : une image large (1 600 × 400 px conseillés). */
export const BANNER_MAX_BYTES = 1536 * 1024;
export const EQUIPMENT = ["Vidéoprojecteur et écran", "Sonorisation et micros", "Visioconférence", "Wi-Fi", "Captation vidéo", "Salles de sous-commission", "Restauration sur place", "Parking", "Hébergement sur place"] as const;
export const OFFER_UNITS = { personne: "par personne", forfait: "forfait", jour: "par jour", nuit: "par nuit" } as const;
export type Capacities = { seats?: number; cocktail?: number; banquet?: number; rooms?: number };
export const CAPACITY_LABEL: Record<keyof Capacities, string> = { seats: "places assises (conférence)", cocktail: "personnes en cocktail", banquet: "couverts assis", rooms: "chambres" };

export function readCapacities(raw: unknown): Capacities {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Capacities = {};
  for (const k of Object.keys(CAPACITY_LABEL) as (keyof Capacities)[]) {
    const v = Number(o[k]);
    if (Number.isInteger(v) && v > 0 && v < 100000) out[k] = v;
  }
  return out;
}

export const photoSrc = (p: { id: string; createdAt: Date }) => `/photos/${p.id}?v=${p.createdAt.getTime()}`;
/** URL de la bannière (versionnée par sa date de mise à jour), ou null sans bannière. */
export const bannerSrc = (o: { id: string; bannerUpdatedAt: Date | null }) => (o.bannerUpdatedAt ? `/bannieres/${o.id}?v=${o.bannerUpdatedAt.getTime()}` : null);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Indicateurs d'un prestataire, calculés à partir de son activité sur KolBase : taux et délai de réponse,
 * prestations réalisées (références anonymisées), avis vérifiés. `withMarket` ajoute la comparaison de prix
 * (réservée au prestataire lui-même).
 */
export async function supplierBook(supplierId: string, withMarket = false) {
  const [invites, quotes, reviews] = await Promise.all([
    db.rfqSupplier.findMany({ where: { supplierId, rfq: { status: { not: "draft" } } }, select: { declined: true, rfq: { select: { sentAt: true } } } }),
    db.quote.findMany({
      where: { supplierId },
      include: { rfq: { select: { category: true, city: true, headcount: true, sentAt: true, event: { select: { startsAt: true, city: true, typeId: true } } } } },
    }),
    db.supplierReview.findMany({ where: { supplierId }, include: { client: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const answered = quotes.length;
  const delays = quotes.filter((q) => q.rfq.sentAt).map((q) => (q.createdAt.getTime() - q.rfq.sentAt!.getTime()) / 36e5).filter((h) => h >= 0);
  const retained = quotes.filter((q) => q.status === "retained");
  // Références : prestations déjà réalisées (événement passé), pas les devis retenus pour un événement à venir.
  const now = new Date();
  const references = retained
    .map((q) => ({ category: q.rfq.category, city: q.rfq.event?.city ?? q.rfq.city, date: q.rfq.event?.startsAt ?? q.rfq.sentAt ?? q.createdAt, headcount: q.rfq.headcount }))
    .filter((r) => r.date < now)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const rating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;

  // Prix par participant (TTC) : le prestataire face à la médiane anonymisée de sa catégorie (3 devis d'au moins 2 prestataires).
  let market: { category: string; mine: number; median: number; count: number }[] = [];
  if (withMarket) {
    const cats = [...new Set(quotes.map((q) => q.rfq.category))];
    const all = cats.length
      ? await db.quote.findMany({ where: { rfq: { category: { in: cats }, headcount: { gt: 0 } } }, select: { supplierId: true, amountCents: true, vatBp: true, ttcCents: true, rfq: { select: { category: true, headcount: true } } } })
      : [];
    market = cats.flatMap((c) => {
      const per = (q: (typeof all)[number]) => quoteTtc(q) / q.rfq.headcount! / 100;
      const inCat = all.filter((q) => q.rfq.category === c);
      const mine = median(inCat.filter((q) => q.supplierId === supplierId).map(per));
      const others = new Set(inCat.map((q) => q.supplierId));
      const m = median(inCat.map(per));
      return mine != null && m != null && inCat.length >= 3 && others.size >= 2 ? [{ category: c, mine, median: m, count: inCat.length }] : [];
    });
  }
  return {
    invites: invites.length,
    answered,
    responseRate: invites.length ? Math.round((answered / invites.length) * 100) : null,
    delayHours: median(delays),
    retained: retained.length,
    references,
    reviews,
    rating,
    market,
  };
}

export const delayLabel = (h: number | null, locale = "fr") => (h == null ? null : h < 24 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} ${locale === "en" ? "d" : "j"}`);
