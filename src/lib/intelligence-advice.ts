import { normName } from "@/lib/intelligence";

/**
 * KolBase Intelligence : recommandations tirées des chiffres de l'organisation elle-même — portefeuille d'experts,
 * produits (celles tirées de la base publique sont dans lib/market-advice). Module pur, testé. Chaque recommandation dit le constat chiffré, ce qu'il
 * est proposé de faire, et où : des règles lisibles, pas une boîte noire. Seuils regroupés ci-dessous.
 */

export const ADVICE_RULES = {
  /** Part des honoraires portée par les trois premiers experts au-delà de laquelle le panel est dit concentré. */
  concentration: 0.6,
  /** Nombre d'experts engagés à partir duquel la concentration et l'absence de nouveaux experts ont un sens. */
  minPanel: 5,
  /** Taux d'acceptation des sollicitations d'un produit en dessous duquel on s'interroge (sur au moins `minAnswers` réponses). */
  lowAcceptance: 0.5,
  minAnswers: 4,
  /** Part des dossiers de l'année rattachés à un produit en dessous de laquelle la lecture par produit est fragile. */
  coverage: 0.7,
} as const;

export type AdviceTab = "comparaison" | "experts" | "produits" | "organisations" | "opportunites";
/** Ce que la recommandation aide à décider. */
export type AdviceFamily = "proteger" | "recruter" | "budget" | "produits" | "force" | "reglage";
export const FAMILY_LABEL: Record<AdviceFamily, string> = { proteger: "Experts à protéger", recruter: "Experts à recruter", budget: "Budget", produits: "Produits", force: "Point fort", reglage: "Réglage" };
/** Priorité : 1 à traiter d'abord, 2 à regarder, 3 pour aller plus loin ; « ok » : un point fort à reproduire. */
export type Advice = { key: string; level: 1 | 2 | 3; tone: "danger" | "warn" | "info" | "ok"; title: string; detail: string; vars: Record<string, string | number>; tab: AdviceTab; family: AdviceFamily };

export type AdviceInput = {
  year: number;
  portfolio: {
    active: number; total: number;
    loyalty: { nouveau: number; fidele: number; dormant: number };
    experts: { name: string; loyalty: string; cents: number; previousCents: number; shared: { competitor: string; cents: number }[] }[];
  };
  products: {
    count: number; coverage: number | null; unassigned: number;
    rows: { name: string; archived: boolean; recruited: number; experts: number; previousExperts: number; accepted: number; declined: number }[];
  };
};

const pct = (x: number) => Math.round(x * 100);
const names = (list: readonly string[], n = 3) => (list.length > n ? `${list.slice(0, n).join(", ")}…` : list.join(", "));

export function advise(input: AdviceInput): Advice[] {
  const { year, portfolio: p, products } = input;
  const R = ADVICE_RULES;
  const out: Advice[] = [];
  const active = p.experts.filter((e) => e.loyalty !== "dormant");

  // 1. Experts d'une autre entreprise avant d'être les vôtres : elle déclare pour eux plus que vous ne leur versez.
  const outbid = active.filter((e) => e.shared.some((s) => s.cents > e.cents));
  if (outbid.length > 0) {
    const worst = outbid.flatMap((e) => e.shared.filter((s) => s.cents > e.cents).map((s) => s.competitor));
    const main = [...new Set(worst)].sort((a, b) => worst.filter((x) => x === b).length - worst.filter((x) => x === a).length)[0];
    out.push({
      key: "experts-partages", level: 1, tone: "danger", tab: "experts", family: "proteger",
      title: outbid.length > 1 ? "{n} de vos experts reçoivent davantage d'une autre entreprise que de vous" : "Un de vos experts reçoit davantage d'une autre entreprise que de vous",
      detail: "{names} : les montants que {competitor} déclare pour eux en {year} dépassent vos honoraires. Sécurisez la relation (contrat-cadre, projet dans l'année) avant qu'elle ne bascule.",
      vars: { n: outbid.length, names: names(outbid.map((e) => e.name)), competitor: main, year },
    });
  }

  // 2. Experts dormants : engagés l'an dernier, plus cette année ; les plus importants d'abord.
  const dormant = p.experts.filter((e) => e.loyalty === "dormant").sort((a, b) => b.previousCents - a.previousCents);
  if (dormant.length > 0) {
    const kept = p.loyalty.fidele + p.loyalty.dormant > 0 ? p.loyalty.fidele / (p.loyalty.fidele + p.loyalty.dormant) : 1;
    out.push({
      key: "dormants", level: kept < 0.5 ? 1 : 2, tone: kept < 0.5 ? "danger" : "warn", tab: "experts", family: "proteger",
      title: dormant.length > 1 ? "{n} experts engagés en {previous} n'ont aucune collaboration en {year}" : "Un expert engagé en {previous} n'a aucune collaboration en {year}",
      detail: "Vous gardez {kept} % de vos experts d'une année sur l'autre. À relancer d'abord : {names}.",
      vars: { n: dormant.length, previous: year - 1, year, kept: pct(kept), names: names(dormant.map((e) => e.name)) },
    });
  }

  // 3. Panel concentré : trois experts portent l'essentiel des honoraires.
  const top3 = active.slice().sort((a, b) => b.cents - a.cents).slice(0, 3);
  const share = p.total > 0 ? top3.reduce((s, e) => s + e.cents, 0) / p.total : 0;
  if (p.active >= R.minPanel && share >= R.concentration)
    out.push({
      key: "concentration", level: 2, tone: "warn", tab: "experts", family: "budget",
      title: "Trois experts concentrent {share} % de vos honoraires",
      detail: "{names} portent l'essentiel de vos collaborations de {year}. Un panel plus large protège vos projets d'une indisponibilité ou d'un lien d'intérêts trop marqué.",
      vars: { share: pct(share), names: names(top3.map((e) => e.name)), year },
    });

  // 4. Aucun nouvel expert cette année.
  if (p.active >= R.minPanel && p.loyalty.nouveau === 0)
    out.push({
      key: "sans-nouveaux", level: 2, tone: "warn", tab: "opportunites", family: "recruter",
      title: "Aucun nouvel expert en {year}",
      detail: "Vos {n} experts engagés collaboraient déjà avec vous. Une opportunité publiée ou une recherche dans l'annuaire renouvelle le panel.",
      vars: { year, n: p.active },
    });

  // 5. Produits : rattachement, produit qui recrute, produit que les experts déclinent, produit sans expert.
  const live = products.rows.filter((r) => !r.archived);
  if (products.count === 0 && p.active > 0)
    out.push({ key: "sans-produits", level: 3, tone: "info", tab: "produits", family: "produits", title: "Décrivez vos produits pour savoir lesquels recrutent", detail: "Ajoutez vos produits ou gammes, puis rattachez-y vos dossiers et vos événements : experts recrutés, honoraires et inscrits se lisent alors produit par produit.", vars: {} });
  if (products.count > 0 && products.unassigned > 0 && (products.coverage ?? 0) < R.coverage)
    out.push({
      key: "produits-a-rattacher", level: 2, tone: "warn", tab: "produits", family: "produits",
      title: products.unassigned > 1 ? "{n} dossiers de {year} ne sont rattachés à aucun produit" : "Un dossier de {year} n'est rattaché à aucun produit",
      detail: "Seuls {coverage} % de vos dossiers de l'année ont un produit : la lecture par produit reste partielle tant qu'ils ne sont pas rattachés.",
      vars: { n: products.unassigned, year, coverage: pct(products.coverage ?? 0) },
    });
  for (const r of live) {
    const answered = r.accepted + r.declined;
    if (answered >= R.minAnswers && r.accepted / answered < R.lowAcceptance)
      out.push({
        key: `produit-decline:${normName(r.name)}`, level: 2, tone: "warn", tab: "produits", family: "produits",
        title: "Les experts déclinent souvent {product}",
        detail: "{accepted} acceptations pour {answered} réponses en {year} ({rate} %). Revoyez l'objet proposé, le format ou les honoraires face aux repères de marché.",
        vars: { product: r.name, accepted: r.accepted, answered, rate: pct(r.accepted / answered), year },
      });
    if (r.experts === 0 && r.previousExperts > 0)
      out.push({
        key: `produit-sans-expert:${normName(r.name)}`, level: 2, tone: "warn", tab: "produits", family: "produits",
        title: "{product} n'a engagé aucun expert en {year}",
        detail: "{n} experts y collaboraient en {previous}. Si le produit reste prioritaire, relancez-les ; sinon, archivez-le.",
        vars: { product: r.name, year, previous: year - 1, n: r.previousExperts },
      });
  }
  const best = live.slice().sort((a, b) => b.recruited - a.recruited)[0];
  if (best && best.recruited >= 2)
    out.push({
      key: "produit-qui-recrute", level: 3, tone: "ok", tab: "produits", family: "force",
      title: "{product} est le produit qui recrute le plus",
      detail: "{n} nouveaux experts en {year} sont entrés dans votre panel par ce produit. Regardez ce qui a fonctionné (format, sujet, intervenants) pour le reproduire ailleurs.",
      vars: { product: best.name, n: best.recruited, year },
    });

  return out.sort((a, b) => a.level - b.level);
}

/**
 * Produit dont le nom figure, en mots entiers, dans un titre : rattachement proposé, à confirmer. Le nom le plus long
 * l'emporte (« Axis Pro » avant « Axis »). La gamme ne sert pas : trop générale (« Implants »), elle rattacherait à tort.
 */
export function suggestProduct<P extends { id: string; name: string; archivedAt: Date | null }>(title: string, products: readonly P[]): P | null {
  const hay = ` ${normName(title)} `;
  return products.filter((p) => !p.archivedAt && normName(p.name).length >= 3 && hay.includes(` ${normName(p.name)} `)).sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}
