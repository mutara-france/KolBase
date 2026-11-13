import "server-only";
import { db } from "@/lib/db";
import { loyalty, personKey, type Loyalty } from "@/lib/intelligence";

/**
 * KolBase Intelligence : lecture du portefeuille d'experts et des produits de l'organisation. Deux sources seulement :
 * ses propres dossiers et événements, et la base publique Transparence Santé tenue par l'équipe KolBase (lib/market-data).
 * Aucune donnée d'une autre organisation cliente n'est lue.
 */

const yearOf = (d: Date) => d.getUTCFullYear();
const bounds = (year: number) => ({ gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) });

export type PortfolioExpert = {
  id: string; name: string; specialty: string | null; loyalty: Loyalty; cents: number; previousCents: number; engagements: number; firstYear: number;
  /** Liens publics de cet expert avec d'autres entreprises, sur l'année regardée (base publique). */
  shared: { competitor: string; cents: number; count: number }[];
};

/**
 * Portefeuille d'experts sur une année : experts engagés (proposition acceptée, date de leur accord : même définition
 * que les statistiques), leur ancienneté dans le portefeuille, et ceux que d'autres entreprises déclarent aussi dans
 * la base publique (`market` : import lu et entreprises de l'organisation, écartées ; null sans base chargée).
 * Rapprochement par RPPS, à défaut par nom et prénom.
 */
export async function portfolio(orgId: string, year: number, market: { importId: string; keys: readonly string[] } | null) {
  const links = await db.projectExpert.findMany({
    // Experts engagés : proposition acceptée (même définition que isEngaged, lib/projects).
    where: { project: { organizationId: orgId }, status: { notIn: ["ATT_EXPERTS", "DECLINE"] } },
    select: {
      feeCents: true, respondedAt: true, createdAt: true, practitionerId: true,
      practitioner: { select: { rpps: true, specialty: true, user: { select: { firstName: true, lastName: true } } } },
    },
  });
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
  // Déclarations publiques de l'année pour ces experts, par entreprise : rapprochées par RPPS et par nom.
  const all = [...experts.values()];
  const publicLinks = market && all.length > 0
    ? await db.$queryRaw<{ nameKey: string; rpps: string | null; company: string; cents: unknown; lines: unknown }[]>`
        SELECT "nameKey", "rpps", MIN("company") AS company, SUM(CASE WHEN "kind" <> 'convention' THEN "amountCents"::numeric ELSE 0 END) AS cents, COUNT(*) AS lines
        FROM "MarketLink" WHERE "importId" = ${market.importId} AND "year" = ${year} AND NOT ("companyKey" = ANY(${[...market.keys]}::text[]))
          AND ("nameKey" = ANY(${all.map((e) => personKey(e.name))}::text[]) OR "rpps" = ANY(${all.flatMap((e) => (e.rpps ? [e.rpps] : []))}::text[]))
        GROUP BY "nameKey", "rpps", "companyKey"`
    : [];
  const byKey = new Map<string, typeof publicLinks>();
  for (const l of publicLinks) {
    for (const key of [l.rpps ? `id:${l.rpps}` : null, `nom:${l.nameKey}`]) {
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), l]);
    }
  }
  const rows: PortfolioExpert[] = [];
  for (const [id, e] of experts) {
    const place = loyalty([...e.years], year);
    if (!place) continue;
    // Par RPPS quand le fichier le publie ; sinon par nom (une même ligne n'est comptée qu'une fois).
    const found = new Set([...(e.rpps ? byKey.get(`id:${e.rpps}`) ?? [] : []), ...(byKey.get(`nom:${personKey(e.name)}`) ?? [])]);
    const shared = new Map<string, { competitor: string; cents: number; count: number }>();
    for (const l of found) {
      const s = shared.get(l.company) ?? { competitor: l.company, cents: 0, count: 0 };
      s.cents += Number(l.cents ?? 0);
      s.count += Number(l.lines ?? 0);
      shared.set(l.company, s);
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
