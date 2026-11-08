import "server-only";
import { db } from "@/lib/db";
import { EVENT_ORGANIZER_ROLES, eventEnded, eventScope } from "@/lib/events";
import { rfqView } from "@/lib/suppliers";
import { quoteTtc } from "@/lib/quotes";
import { activeMandate, type AwardRight } from "@/lib/mandates";
import type { OrgRole } from "@/generated/prisma/client";

type Member = Parameters<typeof eventScope>[0] & { id: string; memberships: { organizationId: string; organization: { kind: string } }[] };

/**
 * Demandes de devis d'une organisation, vues par l'utilisateur connecté (liste et page d'une demande) : périmètre
 * d'une agence mandatée, conflit d'intérêts (agence consultée sur la demande), auteurs, présents des événements passés.
 */
export async function orgRfqs(orgId: string, user: Member, roles: OrgRole[], only?: string) {
  const scope = eventScope(user, roles);
  const scoped = Object.keys(scope).length > 0;
  const isOrganizer = roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r));
  const [raw, mandates] = await Promise.all([
    db.rfq.findMany({
      where: { organizationId: orgId, ...(only ? { id: only } : {}), ...(scoped ? { event: scope } : {}) },
      include: {
        event: true,
        suppliers: { include: { supplier: true } },
        quotes: { include: { supplier: true }, orderBy: { amountCents: "asc" } },
        messages: { include: { author: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: "asc" } },
        review: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    // Agences mandatées : signalées parmi les prestataires consultés ; droit de décision de l'agence connectée.
    db.mandate.findMany({
      where: { mandatorId: orgId, ...activeMandate() },
      include: { agency: { select: { id: true, name: true, _count: { select: { agencyEvents: { where: { organizationId: orgId } } } } } } },
      orderBy: { startsAt: "desc" },
    }),
  ]);
  const agencyName = new Map(mandates.map((m) => [m.agencyId, m.agency.name]));
  const own = (id: string) => user.memberships.some((m) => m.organizationId === id);
  const ownOrgIds = user.memberships.filter((m) => m.organization.kind === "PRESTATAIRE").map((m) => m.organizationId);
  // Devis rangés par total TTC (taux de TVA par ligne) : la meilleure offre d'abord. Agence consultée : son seul devis.
  const rfqs = raw.map((r) => rfqView({ ...r, quotes: [...r.quotes].sort((a, b) => quoteTtc(a) - quoteTtc(b)) }, ownOrgIds));
  const rightFor = (r: { conflicted: boolean; event: { agencyId: string | null } | null }): AwardRight => {
    if (r.conflicted) return "none";
    if (isOrganizer) return "award";
    const m = mandates.find((x) => x.agencyId === r.event?.agencyId && own(x.agencyId));
    return !m ? "none" : m.canAward ? "award" : "propose";
  };
  // Auteur de chaque demande, et son agence quand il agit par un mandat.
  const ids = [...new Set(rfqs.flatMap((r) => [r.createdById, r.proposedById, r.cancelledById]).filter((x): x is string => !!x))];
  const people = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, memberships: { where: { organization: { kind: "PRESTATAIRE" } }, select: { organizationId: true } } } })
    : [];
  const creators = new Map(
    people.map((u) => {
      const agency = u.memberships.map((m) => agencyName.get(m.organizationId)).find(Boolean);
      return [u.id, { name: `${u.firstName} ${u.lastName}`, agency: agency ?? null }];
    }),
  );
  // Présents des événements passés : le coût par participant d'un devis s'y rapporte après l'événement.
  const now = new Date();
  const past = [...new Set(rfqs.filter((r) => r.event && eventEnded(r.event, now)).map((r) => r.event!.id))];
  const presentBy = new Map(
    (past.length ? await db.registration.groupBy({ by: ["eventId"], where: { eventId: { in: past }, checkedInAt: { not: null } }, _count: { _all: true } }) : []).map((g) => [g.eventId, g._count._all]),
  );
  // Prestataire retenu sur une demande où l'agence est consultée : son nom seulement (pas le montant d'un concurrent).
  const keptElsewhere = (id: string) => raw.find((x) => x.id === id)?.quotes.find((q) => q.status === "retained")?.supplier.name ?? null;
  return { rfqs, mandates, agencyName, creators, presentBy, rightFor, isOrganizer, own, keptElsewhere, now };
}

export type OrgRfq = Awaited<ReturnType<typeof orgRfqs>>["rfqs"][number];

/** Prestataires référencés de l'annuaire, avec leurs repères (note, prix « à partir de », photo de couverture). */
export async function supplierDirectory(excludeOrgIds: string[]) {
  const [orgs, ratings] = await Promise.all([
    db.organization.findMany({
      where: { kind: "PRESTATAIRE", listed: true, verification: "VERIFIED", NOT: { supplierCategories: { isEmpty: true } }, id: { notIn: excludeOrgIds } },
      include: {
        photos: { select: { id: true, createdAt: true }, orderBy: { position: "asc" }, take: 1 },
        offers: { select: { unitCents: true, unit: true }, orderBy: { unitCents: "asc" }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    db.supplierReview.groupBy({ by: ["supplierId"], where: { hiddenAt: null }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  return orgs.map((s) => {
    const r = ratings.find((x) => x.supplierId === s.id);
    return {
      id: s.id, name: s.name, categories: s.supplierCategories, city: s.headquarters, coverage: s.coverage, about: s.about, since: s.createdAt.getFullYear(),
      rating: r?._avg.rating ?? null, reviews: r?._count._all ?? 0, logoUpdatedAt: s.logoUpdatedAt, priceHint: s.priceHint, capacities: s.capacities,
      accessible: s.accessible, banner: s.bannerUpdatedAt ? { id: s.id, bannerUpdatedAt: s.bannerUpdatedAt } : null, cover: s.photos[0] ?? null, from: s.offers[0] ?? null,
    };
  });
}
export type DirectorySupplier = Awaited<ReturnType<typeof supplierDirectory>>[number];
