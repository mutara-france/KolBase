import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { median, namedBy, peersOf, rankOf, shareTable, type CompanyYear, type SplitRow } from "@/lib/market";
import { toProtect, toRecruit, type Candidate, type ExpertLine } from "@/lib/market-advice";

/**
 * KolBase Intelligence : lecture de la base publique Transparence Santé (dernier import prêt) pour comparer une
 * organisation au marché, à ses équivalentes et aux organisations qu'elle a choisies. Données publiques seulement ;
 * de l'organisation cliente, seules servent les écritures de son nom et la liste de celles qu'elle compare.
 * Montants : avantages et rémunérations (le montant d'une convention, repris par ses rémunérations, n'est pas
 * additionné). Sommes calculées en numeric (centimes).
 */

const num = (v: unknown) => Number(v ?? 0);
/** Montants versés : avantages et rémunérations. */
const PAID = Prisma.sql`SUM(CASE WHEN "kind" <> 'convention' THEN "amountCents"::numeric ELSE 0 END)`;

export const currentImport = () => db.marketImport.findFirst({ where: { status: "pret" }, orderBy: { createdAt: "desc" } });

type Agg = CompanyYear & { year: number };
type MarketCache = { importId: string; companies: Promise<Agg[]>; splits: Map<string, Promise<SplitRow[]>> };
// Un import ne change plus une fois prêt : ses agrégats de marché sont gardés en mémoire jusqu'à l'import suivant
// (sur globalThis : un cache par module serait dédoublé d'un lot de pages à l'autre).
const store = globalThis as typeof globalThis & { __kolbaseMarket?: MarketCache };
function cacheFor(importId: string): MarketCache {
  if (store.__kolbaseMarket?.importId !== importId) {
    const companies = db.$queryRaw<{ key: string; name: string; sector: string | null; year: number; cents: unknown; lines: unknown; people: unknown }[]>`
      SELECT "companyKey" AS key, MIN("company") AS name, MIN("sector") AS sector, "year", ${PAID} AS cents, COUNT(*) AS lines, COUNT(DISTINCT "personKey") AS people
      FROM "MarketLink" WHERE "importId" = ${importId} GROUP BY 1, 4`.then((rows) => rows.map((r) => ({ key: r.key, name: r.name, sector: r.sector, year: r.year, cents: num(r.cents), lines: num(r.lines), people: num(r.people) })));
    store.__kolbaseMarket = { importId, companies, splits: new Map() };
    // Lecture en échec : rien n'est gardé, la prochaine page réessaie.
    companies.catch(() => { if (store.__kolbaseMarket?.importId === importId) store.__kolbaseMarket = undefined; });
  }
  return store.__kolbaseMarket!;
}

const AXIS = { purpose: Prisma.sql`"purpose"`, region: Prisma.sql`"region"` } as const;
type Axis = keyof typeof AXIS;
/** Répartition des liens d'une année par motif ou par région, pour un ensemble d'entreprises (null : tout le marché). */
function split(importId: string, year: number, axis: Axis, keys: readonly string[] | null): Promise<SplitRow[]> {
  const run = () => db.$queryRaw<{ label: string | null; cents: unknown; lines: unknown }[]>`
    SELECT ${AXIS[axis]} AS label, ${PAID} AS cents, COUNT(*) AS lines FROM "MarketLink"
    WHERE "importId" = ${importId} AND "year" = ${year} ${keys ? Prisma.sql`AND "companyKey" = ANY(${[...keys]}::text[])` : Prisma.empty} GROUP BY 1`
    .then((rows) => rows.map((r) => ({ label: r.label ?? "Non précisé", cents: num(r.cents), lines: num(r.lines) })));
  if (keys) return keys.length ? run() : Promise.resolve([]);
  const cache = cacheFor(importId), id = `${axis}:${year}`;
  if (!cache.splits.has(id)) cache.splits.set(id, run());
  return cache.splits.get(id)!;
}

const merge = (key: string, name: string, rows: readonly CompanyYear[]): CompanyYear => ({
  key, name, sector: [...rows].sort((a, b) => b.cents - a.cents || b.lines - a.lines)[0]?.sector ?? null,
  cents: rows.reduce((s, r) => s + r.cents, 0), lines: rows.reduce((s, r) => s + r.lines, 0), people: rows.reduce((s, r) => s + r.people, 0),
});

export type Compared = { id: string; name: string; aliases: string[]; entities: string[]; year: CompanyYear; previousCents: number };

/**
 * Comparaison d'une organisation sur une année : elle-même (toutes ses entités reconnues dans la base), le marché,
 * ses équivalentes (lib/market, peersOf) et les organisations qu'elle a choisies ; évolution sur cinq ans ;
 * répartition par motif et par région ; experts à protéger et à recruter. null : aucune base publique chargée.
 */
export async function comparison(org: { id: string; name: string }, asked: number | null) {
  const imp = await currentImport();
  if (!imp) return null;
  const [all, profile, chosen] = await Promise.all([
    cacheFor(imp.id).companies,
    db.marketProfile.findUnique({ where: { organizationId: org.id } }),
    db.competitor.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
  ]);
  const names = profile?.names.length ? profile.names : [org.name];
  const years = [...new Set(all.map((a) => a.year))].sort((a, b) => a - b);
  // Année demandée, même sans donnée publique (chiffres à zéro) ; à défaut la dernière année de la base.
  const year = asked ?? years.at(-1) ?? new Date().getUTCFullYear();
  // Entreprises de la base (toutes années) : nom et clé ; celles de l'organisation, celles de chaque organisation choisie.
  const labels = new Map(all.map((a) => [a.key, a.name]));
  const keysOf = (list: readonly string[]) => [...labels].filter(([, name]) => namedBy(name, list)).map(([key]) => key);
  const mineKeys = keysOf(names), mine = new Set(mineKeys);
  const of = (y: number) => all.filter((a) => a.year === y);
  const now = of(year), before = of(year - 1);
  const sumOf = (rows: readonly Agg[], keys: ReadonlySet<string>) => rows.filter((r) => keys.has(r.key));
  const others = now.filter((r) => !mine.has(r.key));
  // Bénéficiaires distincts de l'organisation, toutes entités confondues (une personne déclarée par deux entités compte une fois).
  const peopleByYear = mineKeys.length
    ? await db.$queryRaw<{ year: number; people: unknown }[]>`SELECT "year", COUNT(DISTINCT "personKey") AS people FROM "MarketLink" WHERE "importId" = ${imp.id} AND "companyKey" = ANY(${mineKeys}::text[]) GROUP BY 1`
    : [];
  const myPeople = (y: number) => num(peopleByYear.find((p) => p.year === y)?.people);
  const me = { ...merge("moi", org.name, sumOf(now, mine)), people: myPeople(year) };
  const mePrev = merge("moi", org.name, sumOf(before, mine));
  const { peers, sector, by } = peersOf(me, others);
  const peerKeys = new Set(peers.map((p) => p.key));
  const compared: Compared[] = chosen.map((c) => {
    const keys = new Set(keysOf([c.name, ...c.aliases]).filter((k) => !mine.has(k)));
    return { id: c.id, name: c.name, aliases: c.aliases, entities: [...keys].map((k) => labels.get(k)!).sort((a, b) => a.localeCompare(b, "fr")), year: merge(c.id, c.name, sumOf(now, keys)), previousCents: merge(c.id, c.name, sumOf(before, keys)).cents };
  });
  const comparedKeys = [...new Set([...peerKeys, ...chosen.flatMap((c) => keysOf([c.name, ...c.aliases]))])].filter((k) => !mine.has(k));
  const marketCents = (rows: readonly Agg[]) => rows.reduce((s, r) => s + r.cents, 0);
  const med = (rows: readonly CompanyYear[], f: (c: CompanyYear) => number) => median(rows.filter((r) => r.lines > 0).map(f));
  const perExpert = (c: CompanyYear) => (c.people > 0 ? c.cents / c.people : 0);
  // Évolution : cinq dernières années ; les équivalentes restent celles de l'année regardée.
  const trend = years.filter((y) => y <= year).slice(-5).map((y) => {
    const rows = of(y);
    return { year: y, me: merge("moi", org.name, sumOf(rows, mine)).cents, peers: med(sumOf(rows, peerKeys), (c) => c.cents) ?? 0, market: med(rows, (c) => c.cents) ?? 0, total: marketCents(rows) };
  });
  const [purposeMe, purposePeers, purposeMarket, regionMe, regionPeers, regionMarket, experts] = await Promise.all([
    split(imp.id, year, "purpose", mineKeys), split(imp.id, year, "purpose", [...peerKeys]), split(imp.id, year, "purpose", null),
    split(imp.id, year, "region", mineKeys), split(imp.id, year, "region", [...peerKeys]), split(imp.id, year, "region", null),
    marketExperts(imp.id, year, mineKeys, comparedKeys),
  ]);
  return {
    import: imp, year, years, names, found: mineKeys.length > 0, keys: mineKeys,
    entities: mineKeys.map((k) => labels.get(k)!).sort((a, b) => a.localeCompare(b, "fr")),
    me, previousCents: mePrev.cents, rank: rankOf(me.cents, others.map((c) => c.cents)),
    // Entreprises actives dans l'année ; l'organisation, toutes entités confondues, compte pour une.
    market: { companies: others.filter((r) => r.lines > 0).length + (me.lines > 0 ? 1 : 0), cents: marketCents(now), previousCents: marketCents(before), median: { cents: med(now, (c) => c.cents), people: med(now, (c) => c.people), perExpert: med(now, perExpert) } },
    peers: { list: [...peers].sort((a, b) => b.cents - a.cents || b.lines - a.lines), sector, by, median: { cents: med(peers, (c) => c.cents), people: med(peers, (c) => c.people), perExpert: med(peers, perExpert) } },
    compared, trend,
    purposes: shareTable(purposeMe, purposePeers, purposeMarket), regions: shareTable(regionMe, regionPeers, regionMarket),
    experts,
    /** Entreprises de la base, les plus actives d'abord : proposées à la saisie d'une organisation à comparer. */
    suggestions: [...new Map([...now].sort((a, b) => b.cents - a.cents || b.lines - a.lines).map((c) => [c.key, c.name])).values()].slice(0, 400),
  };
}

/**
 * Experts de l'organisation dans la base publique sur une année (ce que d'autres entreprises déclarent aussi pour
 * eux, cette année et la précédente), et professionnels actifs sur deux ans sans aucun lien déclaré avec elle.
 */
async function marketExperts(importId: string, year: number, mineKeys: readonly string[], comparedKeys: readonly string[]) {
  const mine = [...mineKeys], compared = [...comparedKeys];
  const [own, shared, candidates] = await Promise.all([
    mine.length === 0 ? [] : db.$queryRaw<{ key: string; name: string; city: string | null; cents: unknown; lines: unknown }[]>`
      SELECT "personKey" AS key, MIN("personName") AS name, MIN("city") AS city, ${PAID} AS cents, COUNT(*) AS lines
      FROM "MarketLink" WHERE "importId" = ${importId} AND "year" = ${year} AND "companyKey" = ANY(${mine}::text[]) GROUP BY 1`,
    mine.length === 0 ? [] : db.$queryRaw<{ key: string; ckey: string; company: string; year: number; cents: unknown; lines: unknown }[]>`
      SELECT "personKey" AS key, "companyKey" AS ckey, MIN("company") AS company, "year", ${PAID} AS cents, COUNT(*) AS lines
      FROM "MarketLink" WHERE "importId" = ${importId} AND "year" IN (${year}, ${year - 1}) AND NOT ("companyKey" = ANY(${mine}::text[]))
        AND "personKey" IN (SELECT "personKey" FROM "MarketLink" WHERE "importId" = ${importId} AND "year" = ${year} AND "companyKey" = ANY(${mine}::text[]))
      GROUP BY 1, 2, 4`,
    // Candidats : conventions et rémunérations (un avantage seul — un repas — ne fait pas un expert), professionnels
    // de santé, sans aucun lien déclaré avec l'organisation, toutes années confondues.
    db.$queryRaw<{ key: string; name: string; city: string | null; region: string | null; companies: unknown; compared: unknown; cents: unknown; lines: unknown; recent: unknown; purpose: string | null }[]>`
      SELECT "personKey" AS key, MIN("personName") AS name, MIN("city") AS city, MIN("region") AS region,
        COUNT(DISTINCT "companyKey") AS companies, COUNT(DISTINCT CASE WHEN "companyKey" = ANY(${compared}::text[]) THEN "companyKey" END) AS compared,
        ${PAID} AS cents, COUNT(*) AS lines, COUNT(*) FILTER (WHERE "year" = ${year}) AS recent, MODE() WITHIN GROUP (ORDER BY "purpose") AS purpose
      FROM "MarketLink" WHERE "importId" = ${importId} AND "year" IN (${year}, ${year - 1}) AND "kind" <> 'avantage'
        AND ("category" IS NULL OR lower("category") LIKE 'profession%')
        AND "personKey" NOT IN (SELECT "personKey" FROM "MarketLink" WHERE "importId" = ${importId} AND "companyKey" = ANY(${mine}::text[]))
      GROUP BY 1 ORDER BY 6 DESC, 5 DESC, 8 DESC, 1 LIMIT 150`,
  ]);
  const isCompared = new Set(compared);
  const lines: ExpertLine[] = own.map((e) => {
    const rows = shared.filter((s) => s.key === e.key);
    const current = rows.filter((s) => s.year === year);
    return {
      key: e.key, name: e.name, city: e.city, cents: num(e.cents), lines: num(e.lines),
      othersCents: current.reduce((s, r) => s + num(r.cents), 0), othersLines: current.reduce((s, r) => s + num(r.lines), 0),
      othersPrevCents: rows.filter((s) => s.year === year - 1).reduce((s, r) => s + num(r.cents), 0),
      others: current.map((r) => ({ company: r.company, cents: num(r.cents), lines: num(r.lines), compared: isCompared.has(r.ckey) })).sort((a, b) => b.cents - a.cents || b.lines - a.lines),
    };
  }).sort((a, b) => b.cents - a.cents || b.lines - a.lines || a.name.localeCompare(b.name, "fr"));
  const total = lines.reduce((s, e) => s + e.cents, 0);
  const pool: Candidate[] = candidates.map((c) => ({ key: c.key, name: c.name, city: c.city, region: c.region, companies: num(c.companies), compared: num(c.compared), cents: num(c.cents), lines: num(c.lines), recent: num(c.recent), purpose: c.purpose }));
  return {
    own: lines, protect: toProtect(lines), recruit: toRecruit(pool),
    /** Bénéficiaires que l'organisation est seule à déclarer cette année. */
    exclusive: lines.filter((e) => e.others.length === 0).length,
    /** Part des montants portée par les cinq premiers bénéficiaires (null sans montant). */
    top5Share: total > 0 ? lines.slice(0, 5).reduce((s, e) => s + e.cents, 0) / total : null,
  };
}
