import type { Advice } from "@/lib/intelligence-advice";
import type { Share } from "@/lib/market";

/**
 * KolBase Intelligence : moteur de recommandation tiré de la base publique Transparence Santé — experts à protéger,
 * experts à recruter, où mettre le budget, points forts. Module pur, testé. Chaque recommandation dit le constat
 * chiffré et ce qu'il est proposé de faire : des règles lisibles, pas une boîte noire. Seuils regroupés ci-dessous.
 */

export const MARKET_RULES = {
  /** Hausse, d'une année sur l'autre, des montants versés à un expert par d'autres entreprises, jugée notable. */
  courted: 0.3,
  /** Écart (en points de part) avec les organisations équivalentes au-delà duquel une répartition est signalée. */
  shareGap: 0.15,
  /** Part d'une région chez les équivalentes à partir de laquelle une absence y est signalée. */
  regionShare: 0.1,
  /** Part des montants portée par les cinq premiers bénéficiaires au-delà de laquelle le budget est dit concentré. */
  concentration: 0.6,
  /** Nombre de bénéficiaires à partir duquel la concentration a un sens. */
  minPeople: 10,
  /** Écart de croissance avec le marché (en points) jugé notable. */
  growthGap: 0.1,
  /** Rapport au montant moyen par bénéficiaire des équivalentes au-delà (ou en deçà de l'inverse) duquel on s'interroge. */
  perExpert: 2,
  /** Part d'experts exclusifs (déclarés par aucune autre entreprise) à partir de laquelle c'est un point fort. */
  exclusive: 0.5,
} as const;

/** Expert de l'organisation dans la base publique, et ce que d'autres entreprises déclarent pour lui. */
export type ExpertLine = {
  key: string; name: string; city: string | null; cents: number; lines: number;
  othersCents: number; othersLines: number; othersPrevCents: number;
  /** Autres entreprises qui le déclarent cette année ; `compared` : équivalente ou choisie pour la comparaison. */
  others: { company: string; cents: number; lines: number; compared: boolean }[];
};
export type ProtectReason = "depasse" | "hausse" | "compare";
export type Protected = ExpertLine & { reason: ProtectReason };
/**
 * Experts à protéger : ceux que d'autres entreprises déclarent aussi, et qui risquent de basculer — une autre
 * entreprise verse plus que l'organisation (« depasse »), les montants des autres progressent nettement (« hausse »),
 * ou une organisation à laquelle elle se compare le déclare (« compare »). Les plus exposés d'abord.
 */
export function toProtect(experts: readonly ExpertLine[]): Protected[] {
  const weight: Record<ProtectReason, number> = { depasse: 0, hausse: 1, compare: 2 };
  const out: Protected[] = [];
  for (const e of experts) {
    if (e.others.length === 0) continue;
    const more = e.cents > 0 || e.othersCents > 0 ? e.othersCents > e.cents : e.othersLines > e.lines;
    const rising = e.othersPrevCents > 0 && e.othersCents >= e.othersPrevCents * (1 + MARKET_RULES.courted);
    const reason: ProtectReason | null = more ? "depasse" : rising ? "hausse" : e.others.some((o) => o.compared) ? "compare" : null;
    if (reason) out.push({ ...e, reason });
  }
  return out.sort((a, b) => weight[a.reason] - weight[b.reason] || b.othersCents - a.othersCents || b.cents - a.cents || a.name.localeCompare(b.name, "fr"));
}

/** Professionnel actif sur le marché (conventions, rémunérations) sur deux ans, sans lien déclaré avec l'organisation. */
export type Candidate = {
  key: string; name: string; city: string | null; region: string | null;
  /** Entreprises qui le déclarent, dont celles auxquelles l'organisation se compare. */
  companies: number; compared: number; cents: number; lines: number;
  /** Liens datés de l'année regardée (les autres sont de l'année précédente). */
  recent: number; purpose: string | null;
};
/**
 * Experts à recruter, classés : d'abord ceux qu'engagent les organisations auxquelles on se compare, puis ceux que
 * plusieurs entreprises engagent, encore actifs cette année. Note lisible, pas un secret : 3 points par organisation
 * comparée, 2 par entreprise (cinq au plus), 2 si actif cette année, jusqu'à 2 selon le nombre de liens.
 */
export function toRecruit(candidates: readonly Candidate[], n = 15): (Candidate & { score: number })[] {
  return candidates
    .map((c) => ({ ...c, score: 3 * c.compared + 2 * Math.min(c.companies, 5) + (c.recent > 0 ? 2 : 0) + Math.min(c.lines, 10) / 5 }))
    .sort((a, b) => b.score - a.score || b.cents - a.cents || a.name.localeCompare(b.name, "fr"))
    .slice(0, n);
}

export type MarketAdviceInput = {
  year: number;
  /** L'organisation est reconnue dans la base publique (sous son nom ou une écriture qu'elle a indiquée). */
  found: boolean;
  me: { cents: number; prevCents: number; people: number; rank: number | null; top5Share: number | null; exclusive: number };
  /** Marché : toutes les entreprises de la base, l'organisation comprise. */
  market: { cents: number; prevCents: number; companies: number };
  /** Organisations équivalentes : médianes de l'année. */
  peers: { count: number; cents: number | null; people: number | null; perExpert: number | null };
  purposes: { by: "montants" | "liens"; rows: Share[] };
  regions: { by: "montants" | "liens"; rows: Share[] };
  protect: readonly Protected[];
  recruit: readonly Candidate[];
};

const pct = (x: number) => Math.round(x * 100);
const names = (list: readonly string[], n = 3) => (list.length > n ? `${list.slice(0, n).join(", ")}…` : list.join(", "));

export function marketAdvice(input: MarketAdviceInput): Advice[] {
  const { year, me, market, peers, protect, recruit } = input;
  const R = MARKET_RULES;
  const out: Advice[] = [];

  if (!input.found) {
    out.push({ key: "introuvable", level: 1, tone: "info", tab: "organisations", family: "reglage", title: "Votre organisation n'est pas reconnue dans la base publique", detail: "Indiquez sous quel nom elle déclare ses liens d'intérêts (raison sociale, filiales) : la comparaison au marché en dépend.", vars: {} });
  }

  // Experts à protéger : les plus exposés d'abord (une autre entreprise verse plus, ou ses montants progressent).
  const exposed = protect.filter((e) => e.reason !== "compare");
  if (exposed.length > 0) {
    const rivals = exposed.flatMap((e) => e.others.slice(0, 1).map((o) => o.company));
    const main = [...new Set(rivals)].sort((a, b) => rivals.filter((x) => x === b).length - rivals.filter((x) => x === a).length)[0];
    out.push({
      key: "a-proteger", level: 1, tone: "danger", tab: "experts", family: "proteger",
      title: exposed.length > 1 ? "{n} de vos experts sont très sollicités par d'autres entreprises" : "Un de vos experts est très sollicité par d'autres entreprises",
      detail: "{names} : d'autres entreprises déclarent pour eux plus que vous en {year}, ou nettement plus qu'en {previous} — {company} en tête. Proposez-leur un projet dans l'année avant que la relation ne bascule.",
      vars: { n: exposed.length, names: names(exposed.map((e) => e.name)), year, previous: year - 1, company: main ?? "" },
    });
  } else if (protect.length > 0)
    out.push({
      key: "a-surveiller", level: 2, tone: "warn", tab: "experts", family: "proteger",
      title: protect.length > 1 ? "{n} de vos experts travaillent aussi avec des organisations auxquelles vous vous comparez" : "Un de vos experts travaille aussi avec une organisation à laquelle vous vous comparez",
      detail: "{names}. Vous restez leur premier partenaire déclaré : gardez le rythme des collaborations.",
      vars: { n: protect.length, names: names(protect.map((e) => e.name)) },
    });

  // Experts à recruter : actifs chez les organisations comparées, sans lien déclaré avec l'organisation.
  const wanted = recruit.filter((c) => c.compared > 0);
  const pool = wanted.length > 0 ? wanted : recruit.filter((c) => c.companies >= 2);
  if (pool.length > 0)
    out.push({
      key: "a-recruter", level: 2, tone: "info", tab: "experts", family: "recruter",
      title: wanted.length > 0 ? (pool.length > 1 ? "{n} experts engagés par vos comparables n'ont aucun lien avec vous" : "Un expert engagé par vos comparables n'a aucun lien avec vous") : (pool.length > 1 ? "{n} experts engagés par plusieurs entreprises n'ont aucun lien avec vous" : "Un expert engagé par plusieurs entreprises n'a aucun lien avec vous"),
      detail: "À approcher d'abord : {names}. Conventions et rémunérations déclarées en {previous} et {year}, sans aucune déclaration de votre part.",
      vars: { n: pool.length, names: names(pool.map((c) => c.name)), year, previous: year - 1 },
    });

  if (input.found && me.cents > 0) {
    // Budget : place sur le marché (croissance comparée à celle du marché, hors effet d'une année incomplète).
    if (me.prevCents > 0 && market.prevCents > 0) {
      const mine = me.cents / me.prevCents - 1, theirs = market.cents / market.prevCents - 1;
      const vars = { mine: `${mine >= 0 ? "+" : "−"}${Math.abs(pct(mine))}`, theirs: `${theirs >= 0 ? "+" : "−"}${Math.abs(pct(theirs))}`, year, previous: year - 1 };
      if (mine <= theirs - R.growthGap)
        out.push({ key: "part-recule", level: 1, tone: "danger", tab: "comparaison", family: "budget", title: "Vous perdez du terrain : {mine} % quand le marché fait {theirs} %", detail: "Montants versés aux professionnels entre {previous} et {year}. À budget constant, votre part de voix auprès des experts recule : voyez ci-dessous où vos équivalentes investissent davantage.", vars });
      else if (mine >= theirs + R.growthGap)
        out.push({ key: "part-progresse", level: 3, tone: "ok", tab: "comparaison", family: "force", title: "Vous gagnez du terrain : {mine} % quand le marché fait {theirs} %", detail: "Montants versés aux professionnels entre {previous} et {year} : votre présence auprès des experts progresse plus vite que celle du marché.", vars });
    }
    // Budget : motif sous-investi ou sur-investi face aux équivalentes.
    if (peers.count > 0 && input.purposes.by === "montants") {
      const gaps = input.purposes.rows.map((r) => ({ ...r, gap: r.me - r.peers })).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
      const under = gaps.find((g) => g.gap <= -R.shareGap), over = gaps.find((g) => g.gap >= R.shareGap);
      if (under)
        out.push({ key: "motif-sous-investi", level: 2, tone: "warn", tab: "comparaison", family: "budget", title: "« {label} » : {me} % de votre budget, {peers} % chez vos équivalentes", detail: "C'est l'écart le plus fort en votre défaveur en {year}. Si ce type de collaboration compte pour vous, c'est là qu'un euro de plus vous rapproche le plus de vos équivalentes.", vars: { label: under.label, me: pct(under.me), peers: pct(under.peers), year } });
      if (over)
        out.push({ key: "motif-sur-investi", level: 3, tone: "info", tab: "comparaison", family: "budget", title: "« {label} » pèse {me} % de votre budget, contre {peers} % chez vos équivalentes", detail: "Un choix assumé, ou une habitude ? C'est le poste où vous vous écartez le plus de vos équivalentes en {year}.", vars: { label: over.label, me: pct(over.me), peers: pct(over.peers), year } });
    }
    // Budget : région où les équivalentes sont présentes et l'organisation presque absente.
    const region = peers.count > 0 ? input.regions.rows.filter((r) => r.peers >= R.regionShare && r.me < r.peers / 2).sort((a, b) => b.peers - b.me - (a.peers - a.me))[0] : undefined;
    if (region)
      out.push({ key: "region-absente", level: 2, tone: "warn", tab: "comparaison", family: "budget", title: "{label} : {peers} % de l'activité de vos équivalentes, {me} % de la vôtre", detail: "Vous y êtes peu présent auprès des professionnels en {year}. Un événement ou deux experts locaux suffisent souvent à ouvrir une région.", vars: { label: region.label, me: pct(region.me), peers: pct(region.peers), year } });
    // Budget : concentration sur quelques bénéficiaires.
    if (me.people >= R.minPeople && me.top5Share !== null && me.top5Share >= R.concentration)
      out.push({ key: "budget-concentre", level: 2, tone: "warn", tab: "experts", family: "budget", title: "Cinq bénéficiaires reçoivent {share} % de vos montants", detail: "Sur {n} bénéficiaires déclarés en {year}. Un budget mieux réparti vous protège du départ d'un seul expert et élargit votre présence.", vars: { share: pct(me.top5Share), n: me.people, year } });
    // Budget : montant moyen par bénéficiaire très éloigné de celui des équivalentes.
    const perExpert = me.people > 0 ? me.cents / me.people : 0;
    if (peers.perExpert && perExpert > 0 && (perExpert >= peers.perExpert * R.perExpert || perExpert <= peers.perExpert / R.perExpert)) {
      const high = perExpert > peers.perExpert;
      out.push({
        key: high ? "moyenne-haute" : "moyenne-basse", level: 3, tone: "info", tab: "comparaison", family: "budget",
        title: high ? "Vous versez en moyenne {ratio} fois plus par bénéficiaire que vos équivalentes" : "Vous versez en moyenne {ratio} fois moins par bénéficiaire que vos équivalentes",
        detail: high ? "Peu d'experts, fortement engagés : une relation solide, mais un panel étroit. Élargir coûte moins que d'approfondir encore." : "Beaucoup de bénéficiaires, peu engagés chacun : choisissez ceux avec qui construire une vraie collaboration.",
        vars: { ratio: (high ? perExpert / peers.perExpert : peers.perExpert / perExpert).toFixed(1).replace(".", ",") },
      });
    }
    // Points forts : rang, experts exclusifs.
    if (me.rank !== null && market.companies >= 8 && me.rank <= Math.max(3, Math.ceil(market.companies / 10)))
      out.push({ key: "rang", level: 3, tone: "ok", tab: "comparaison", family: "force", title: "Rang {rank} sur {n} entreprises pour les montants versés", detail: "Parmi les entreprises qui déclarent des liens avec ces professionnels en {year}.", vars: { rank: me.rank, n: market.companies, year } });
    if (me.people >= R.minPeople && me.exclusive / me.people >= R.exclusive)
      out.push({ key: "exclusifs", level: 3, tone: "ok", tab: "experts", family: "force", title: "{share} % de vos experts ne sont déclarés par aucune autre entreprise", detail: "{n} bénéficiaires sur {total} en {year} : un panel qui vous est propre, difficile à copier.", vars: { share: pct(me.exclusive / me.people), n: me.exclusive, total: me.people, year } });
  }
  return out.sort((a, b) => a.level - b.level);
}
