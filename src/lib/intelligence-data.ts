import "server-only";
import { db } from "@/lib/db";
import { LINK_KINDS, loyalty, personKey, type LinkKind, type Loyalty } from "@/lib/intelligence";

/**
 * KolBase Intelligence : lecture du portefeuille d'experts de l'organisation et des déclarations publiques de ses
 * concurrents suivis. Deux sources seulement : les dossiers de l'organisation elle-même, et les lignes qu'elle a
 * importées de la base publique Transparence Santé. Aucune donnée d'une autre organisation cliente n'est lue.
 */

const yearOf = (d: Date) => d.getUTCFullYear();
const bounds = (year: number) => ({ gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) });

export type PortfolioExpert = {
  id: string; name: string; specialty: string | null; loyalty: Loyalty; cents: number; previousCents: number; engagements: number; firstYear: number;
  /** Liens publics de cet expert avec des concurrents suivis, sur l'année regardée. */
  shared: { competitor: string; cents: number; count: number }[];
};

/**
 * Portefeuille d'experts sur une année : experts engagés (proposition acceptée, date de leur accord : même définition
 * que les statistiques), leur ancienneté dans le portefeuille, et ceux que des concurrents suivis déclarent aussi.
 * Rapprochement avec les déclarations publiques par RPPS, à défaut par nom et prénom.
 */
export async function portfolio(orgId: string, year: number) {
  const [links, publicLinks] = await Promise.all([
    db.projectExpert.findMany({
      // Experts engagés : proposition acceptée (même définition que isEngaged, lib/projects).
      where: { project: { organizationId: orgId }, status: { notIn: ["ATT_EXPERTS", "DECLINE"] } },
      select: {
        feeCents: true, respondedAt: true, createdAt: true, practitionerId: true,
        practitioner: { select: { rpps: true, specialty: true, user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    db.publicLink.findMany({
      where: { organizationId: orgId, date: bounds(year) },
      select: { amountCents: true, beneficiaryId: true, beneficiaryName: true, competitor: { select: { name: true } } },
    }),
  ]);
  // Déclarations publiques de l'année, par identifiant et par nom du bénéficiaire.
  const byKey = new Map<string, typeof publicLinks>();
  for (const l of publicLinks) {
    for (const key of [l.beneficiaryId ? `id:${l.beneficiaryId}` : null, l.beneficiaryName ? `nom:${personKey(l.beneficiaryName)}` : null]) {
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), l]);
    }
  }
  type Acc = { name: string; specialty: string | null; rpps: string | null; years: Set<number>; cents: number; previousCents: number; engagements: number };
  const experts = new Map<string, Acc>();
  for (const l of links) {
    const y = yearOf(l.respondedAt ?? l.createdAt);
    const e = experts.get(l.practitionerId) ?? { name: `${l.practitioner.user.firstName} ${l.practitioner.user.lastName}`, specialty: l.practitioner.specialty, rpps: l.practitioner.rpps, years: new Set<number>(), cents: 0, previousCents: 0, engagements: 0 };
    e.years.add(y);
    if (y === year) { e.cents += l.feeCents ?? 0; e.engagements++; }
    if (y === year - 1) e.previousCents += l.feeCents ?? 0;
    experts.set(l.practitionerId, e);
  }
  const rows: PortfolioExpert[] = [];
  for (const [id, e] of experts) {
    const place = loyalty([...e.years], year);
    if (!place) continue;
    // Par RPPS quand le fichier le publie ; sinon par nom (une même ligne n'est comptée qu'une fois).
    const found = new Set([...(e.rpps ? byKey.get(`id:${e.rpps}`) ?? [] : []), ...(byKey.get(`nom:${personKey(e.name)}`) ?? [])]);
    const shared = new Map<string, { competitor: string; cents: number; count: number }>();
    for (const l of found) {
      const s = shared.get(l.competitor.name) ?? { competitor: l.competitor.name, cents: 0, count: 0 };
      s.cents += l.amountCents;
      s.count++;
      shared.set(l.competitor.name, s);
    }
    rows.push({ id, name: e.name, specialty: e.specialty, loyalty: place, cents: e.cents, previousCents: e.previousCents, engagements: e.engagements, firstYear: Math.min(...e.years), shared: [...shared.values()].sort((a, b) => b.cents - a.cents) });
  }
  rows.sort((a, b) => b.cents - a.cents || b.previousCents - a.previousCents || a.name.localeCompare(b.name, "fr"));
  const active = rows.filter((r) => r.loyalty !== "dormant");
  const total = active.reduce((s, r) => s + r.cents, 0);
  const count = (l: Loyalty) => rows.filter((r) => r.loyalty === l).length;
  const years = [...new Set(links.map((l) => yearOf(l.respondedAt ?? l.createdAt)))].sort();
  return {
    experts: rows, total, active: active.length,
    loyalty: { nouveau: count("nouveau"), fidele: count("fidele"), revenu: count("revenu"), dormant: count("dormant") },
    // Fidélisation : part des experts de l'année précédente encore engagés cette année.
    retention: count("fidele") + count("dormant") > 0 ? count("fidele") / (count("fidele") + count("dormant")) : null,
    shared: active.filter((r) => r.shared.length > 0).length,
    years,
  };
}

export type CompetitorSummary = {
  id: string; name: string; aliases: string[]; lines: number;
  year: { cents: number; lines: number; beneficiaries: number; byKind: Record<LinkKind, { cents: number; lines: number }> };
  previousCents: number;
  categories: { label: string; cents: number; lines: number }[];
  purposes: { label: string; cents: number; lines: number }[];
  top: { name: string; cents: number; lines: number }[];
};

/**
 * Déclarations publiques de chaque concurrent suivi sur une année : montants par type de lien, bénéficiaires distincts,
 * catégories et objets les plus déclarés, premiers bénéficiaires. Sommes calculées en numeric (centimes).
 */
export async function competitorOverview(orgId: string, year: number) {
  const { gte, lt } = bounds(year);
  const prev = bounds(year - 1);
  const competitors = await db.competitor.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" }, include: { _count: { select: { links: true } } } });
  type Row = { competitorId: string; label: string | null; cents: unknown; lines: unknown };
  const num = (v: unknown) => Number(v ?? 0);
  const [kinds, previous, people, categories, purposes, top, years] = await Promise.all([
    db.$queryRaw<Row[]>`SELECT "competitorId", "kind"::text AS label, SUM("amountCents"::numeric) AS cents, COUNT(*) AS lines FROM "PublicLink" WHERE "organizationId" = ${orgId} AND "date" >= ${gte} AND "date" < ${lt} GROUP BY 1, 2`,
    db.$queryRaw<Row[]>`SELECT "competitorId", NULL AS label, SUM("amountCents"::numeric) AS cents, COUNT(*) AS lines FROM "PublicLink" WHERE "organizationId" = ${orgId} AND "date" >= ${prev.gte} AND "date" < ${prev.lt} GROUP BY 1`,
    db.$queryRaw<Row[]>`SELECT "competitorId", NULL AS label, 0 AS cents, COUNT(DISTINCT COALESCE("beneficiaryId", lower("beneficiaryName"))) AS lines FROM "PublicLink" WHERE "organizationId" = ${orgId} AND "date" >= ${gte} AND "date" < ${lt} GROUP BY 1`,
    db.$queryRaw<Row[]>`SELECT "competitorId", "category" AS label, SUM("amountCents"::numeric) AS cents, COUNT(*) AS lines FROM "PublicLink" WHERE "organizationId" = ${orgId} AND "date" >= ${gte} AND "date" < ${lt} AND "category" IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC`,
    db.$queryRaw<Row[]>`SELECT "competitorId", "purpose" AS label, SUM("amountCents"::numeric) AS cents, COUNT(*) AS lines FROM "PublicLink" WHERE "organizationId" = ${orgId} AND "date" >= ${gte} AND "date" < ${lt} AND "purpose" IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC`,
    db.$queryRaw<Row[]>`SELECT "competitorId", MIN("beneficiaryName") AS label, SUM("amountCents"::numeric) AS cents, COUNT(*) AS lines FROM "PublicLink" WHERE "organizationId" = ${orgId} AND "date" >= ${gte} AND "date" < ${lt} AND "beneficiaryName" IS NOT NULL GROUP BY 1, COALESCE("beneficiaryId", lower("beneficiaryName")) ORDER BY 3 DESC`,
    db.$queryRaw<{ year: unknown }[]>`SELECT DISTINCT date_part('year', "date") AS year FROM "PublicLink" WHERE "organizationId" = ${orgId} AND "date" IS NOT NULL ORDER BY 1`,
  ]);
  const of = (rows: Row[], id: string) => rows.filter((r) => r.competitorId === id);
  const ranked = (rows: Row[], id: string, n: number) => of(rows, id).slice(0, n).map((r) => ({ label: r.label ?? "", cents: num(r.cents), lines: num(r.lines) }));
  const summaries: CompetitorSummary[] = competitors.map((c) => {
    const byKind = Object.fromEntries(LINK_KINDS.map((k) => {
      const r = of(kinds, c.id).find((x) => x.label === k);
      return [k, { cents: num(r?.cents), lines: num(r?.lines) }];
    })) as CompetitorSummary["year"]["byKind"];
    return {
      id: c.id, name: c.name, aliases: c.aliases, lines: c._count.links,
      year: { cents: LINK_KINDS.reduce((s, k) => s + byKind[k].cents, 0), lines: LINK_KINDS.reduce((s, k) => s + byKind[k].lines, 0), beneficiaries: num(of(people, c.id)[0]?.lines), byKind },
      previousCents: num(of(previous, c.id)[0]?.cents),
      categories: ranked(categories, c.id, 6), purposes: ranked(purposes, c.id, 6),
      top: ranked(top, c.id, 10).map((r) => ({ name: r.label, cents: r.cents, lines: r.lines })),
    };
  });
  return { competitors: summaries, years: years.map((y) => num(y.year)) };
}

export type ProductRow = {
  id: string | null; name: string; range: string | null; archived: boolean;
  /** Experts engagés dans l'année, dont ceux entrés dans le panel de l'organisation par ce produit. */
  experts: number; recruited: number; previousExperts: number; cents: number; dossiers: number;
  /** Réponses des experts sollicités dans l'année : acceptations et refus (les sollicitations sans réponse ne comptent pas). */
  accepted: number; declined: number;
  events: number; registrations: number;
};

/**
 * Activité par produit sur une année. Un dossier porte son produit ; un événement porte le sien, à défaut celui de son
 * dossier. « Recruté » : la toute première collaboration de l'expert avec l'organisation date de cette année et s'est
 * faite sur ce produit. Les dossiers et événements sans produit sont comptés à part (« Sans produit ») et listés pour
 * être rattachés, avec le produit que leur titre laisse deviner.
 */
export async function productOverview(orgId: string, year: number) {
  const { gte, lt } = bounds(year);
  const [products, projects, events] = await Promise.all([
    db.product.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } }),
    db.project.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true, productId: true, experts: { select: { practitionerId: true, status: true, feeCents: true, respondedAt: true, createdAt: true } } },
    }),
    db.event.findMany({
      where: { organizationId: orgId, cancelledAt: null, startsAt: { gte, lt } },
      select: { id: true, title: true, productId: true, project: { select: { productId: true } }, _count: { select: { registrations: { where: { cancelledAt: null } } } } },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  const NONE = "";
  const blank = (p: { id: string | null; name: string; range: string | null; archived: boolean }): ProductRow => ({ ...p, experts: 0, recruited: 0, previousExperts: 0, cents: 0, dossiers: 0, accepted: 0, declined: 0, events: 0, registrations: 0 });
  const rows = new Map<string, ProductRow>([[NONE, blank({ id: null, name: "", range: null, archived: false })], ...products.map((p) => [p.id, blank({ id: p.id, name: p.name, range: p.range, archived: !!p.archivedAt })] as const)]);
  const engaged = (s: string) => s !== "ATT_EXPERTS" && s !== "DECLINE";
  const when = (e: { respondedAt: Date | null; createdAt: Date }) => e.respondedAt ?? e.createdAt;
  // Première collaboration de chaque expert avec l'organisation, tous produits confondus.
  const first = new Map<string, { at: Date; product: string }>();
  for (const p of projects) for (const e of p.experts) if (engaged(e.status) && (!first.has(e.practitionerId) || when(e) < first.get(e.practitionerId)!.at)) first.set(e.practitionerId, { at: when(e), product: p.productId ?? NONE });
  const seen = new Map<string, Set<string>>(), before = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, key: string, id: string) => m.set(key, (m.get(key) ?? new Set()).add(id));
  const toAttach: { kind: "project" | "event"; id: string; title: string }[] = [];
  let withProduct = 0, engagedDossiers = 0;
  for (const p of projects) {
    const key = p.productId ?? NONE;
    const row = rows.get(key) ?? rows.get(NONE)!;
    let inYear = false;
    for (const e of p.experts) {
      const y = yearOf(when(e));
      if (engaged(e.status) && y === year) { inYear = true; row.cents += e.feeCents ?? 0; add(seen, key, e.practitionerId); }
      if (engaged(e.status) && y === year - 1) add(before, key, e.practitionerId);
      // Réponses aux sollicitations de l'année : acceptée (expert engagé) ou déclinée.
      if (y === year && e.status === "DECLINE") row.declined++;
      if (y === year && engaged(e.status)) row.accepted++;
    }
    if (!inYear) continue;
    row.dossiers++;
    engagedDossiers++;
    if (p.productId) withProduct++;
    else toAttach.push({ kind: "project", id: p.id, title: p.title });
  }
  for (const [key, row] of rows) {
    row.experts = seen.get(key)?.size ?? 0;
    row.previousExperts = before.get(key)?.size ?? 0;
    row.recruited = [...(seen.get(key) ?? [])].filter((id) => first.get(id)?.product === key && yearOf(first.get(id)!.at) === year).length;
  }
  for (const e of events) {
    const key = e.productId ?? e.project?.productId ?? NONE;
    const row = rows.get(key) ?? rows.get(NONE)!;
    row.events++;
    row.registrations += e._count.registrations;
    if (key === NONE) toAttach.push({ kind: "event", id: e.id, title: e.title });
  }
  const none = rows.get(NONE)!;
  return {
    products,
    rows: [...rows.values()].filter((r) => r.id !== null).sort((a, b) => b.recruited - a.recruited || b.experts - a.experts || b.registrations - a.registrations || a.name.localeCompare(b.name, "fr")),
    none,
    // Part des dossiers engagés de l'année rattachés à un produit (null : aucun dossier engagé).
    coverage: engagedDossiers > 0 ? withProduct / engagedDossiers : null,
    unassigned: engagedDossiers - withProduct,
    toAttach: toAttach.slice(0, 60),
  };
}
