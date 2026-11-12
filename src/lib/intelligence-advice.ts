import { normName } from "@/lib/intelligence";

/**
 * KolBase Intelligence : recommandations tirées des chiffres de l'organisation — portefeuille d'experts, produits,
 * concurrents suivis, fichiers importés. Module pur, testé. Chaque recommandation dit le constat chiffré, ce qu'il
 * est proposé de faire, et où : des règles lisibles, pas une boîte noire. Seuils regroupés ci-dessous.
 */

export const ADVICE_RULES = {
  /** Part des honoraires portée par les trois premiers experts au-delà de laquelle le panel est dit concentré. */
  concentration: 0.6,
  /** Nombre d'experts engagés à partir duquel la concentration et l'absence de nouveaux experts ont un sens. */
  minPanel: 5,
  /** Hausse des montants déclarés par un concurrent, d'une année sur l'autre, jugée notable. */
  competitorRise: 0.3,
  /** Taux d'acceptation des sollicitations d'un produit en dessous duquel on s'interroge (sur au moins `minAnswers` réponses). */
  lowAcceptance: 0.5,
  minAnswers: 4,
  /** Part des dossiers de l'année rattachés à un produit en dessous de laquelle la lecture par produit est fragile. */
  coverage: 0.7,
  /** Âge (jours) du dernier import Transparence Santé au-delà duquel un nouvel export est conseillé (base mise à jour deux fois par an). */
  importAge: 200,
} as const;

export type AdviceTab = "portefeuille" | "produits" | "concurrents" | "sources" | "opportunites";
/** Priorité : 1 à traiter d'abord, 2 à regarder, 3 pour aller plus loin ; « ok » : un point fort à reproduire. */
export type Advice = { key: string; level: 1 | 2 | 3; tone: "danger" | "warn" | "info" | "ok"; title: string; detail: string; vars: Record<string, string | number>; tab: AdviceTab };

export type AdviceInput = {
  year: number;
  portfolio: {
    active: number; total: number;
    loyalty: { nouveau: number; fidele: number; dormant: number };
    experts: { name: string; loyalty: string; cents: number; previousCents: number; shared: { competitor: string; cents: number }[] }[];
  };
  competitors: { name: string; lines: number; year: { cents: number; lines: number }; previousCents: number; purposes: { label: string }[] }[];
  products: {
    count: number; coverage: number | null; unassigned: number;
    rows: { name: string; archived: boolean; recruited: number; experts: number; previousExperts: number; accepted: number; declined: number }[];
  };
  /** Dernier fichier Transparence Santé importé (null : aucun). */
  lastImportAt: Date | null;
  now?: Date;
};

const pct = (x: number) => Math.round(x * 100);
const names = (list: readonly string[], n = 3) => (list.length > n ? `${list.slice(0, n).join(", ")}…` : list.join(", "));

export function advise(input: AdviceInput): Advice[] {
  const { year, portfolio: p, competitors, products, lastImportAt, now = new Date() } = input;
  const R = ADVICE_RULES;
  const out: Advice[] = [];
  const active = p.experts.filter((e) => e.loyalty !== "dormant");

  // 1. Experts de vos concurrents avant d'être les vôtres : déclarés davantage par un concurrent suivi que payés par vous.
  const outbid = active.filter((e) => e.shared.some((s) => s.cents > e.cents));
  if (outbid.length > 0) {
    const worst = outbid.flatMap((e) => e.shared.filter((s) => s.cents > e.cents).map((s) => s.competitor));
    const main = [...new Set(worst)].sort((a, b) => worst.filter((x) => x === b).length - worst.filter((x) => x === a).length)[0];
    out.push({
      key: "experts-partages", level: 1, tone: "danger", tab: "portefeuille",
      title: outbid.length > 1 ? "{n} de vos experts reçoivent davantage d'un concurrent que de vous" : "Un de vos experts reçoit davantage d'un concurrent que de vous",
      detail: "{names} : les montants que {competitor} déclare pour eux en {year} dépassent vos honoraires. Sécurisez la relation (contrat-cadre, projet dans l'année) avant qu'elle ne bascule.",
      vars: { n: outbid.length, names: names(outbid.map((e) => e.name)), competitor: main, year },
    });
  }

  // 2. Experts dormants : engagés l'an dernier, plus cette année ; les plus importants d'abord.
  const dormant = p.experts.filter((e) => e.loyalty === "dormant").sort((a, b) => b.previousCents - a.previousCents);
  if (dormant.length > 0) {
    const kept = p.loyalty.fidele + p.loyalty.dormant > 0 ? p.loyalty.fidele / (p.loyalty.fidele + p.loyalty.dormant) : 1;
    out.push({
      key: "dormants", level: kept < 0.5 ? 1 : 2, tone: kept < 0.5 ? "danger" : "warn", tab: "portefeuille",
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
      key: "concentration", level: 2, tone: "warn", tab: "portefeuille",
      title: "Trois experts concentrent {share} % de vos honoraires",
      detail: "{names} portent l'essentiel de vos collaborations de {year}. Un panel plus large protège vos projets d'une indisponibilité ou d'un lien d'intérêts trop marqué.",
      vars: { share: pct(share), names: names(top3.map((e) => e.name)), year },
    });

  // 4. Aucun nouvel expert cette année.
  if (p.active >= R.minPanel && p.loyalty.nouveau === 0)
    out.push({
      key: "sans-nouveaux", level: 2, tone: "warn", tab: "opportunites",
      title: "Aucun nouvel expert en {year}",
      detail: "Vos {n} experts engagés collaboraient déjà avec vous. Une opportunité publiée ou une recherche dans l'annuaire renouvelle le panel.",
      vars: { year, n: p.active },
    });

  // 5. Produits : rattachement, produit qui recrute, produit que les experts déclinent, produit sans expert.
  const live = products.rows.filter((r) => !r.archived);
  if (products.count === 0 && p.active > 0)
    out.push({ key: "sans-produits", level: 3, tone: "info", tab: "produits", title: "Décrivez vos produits pour savoir lesquels recrutent", detail: "Ajoutez vos produits ou gammes, puis rattachez-y vos dossiers et vos événements : experts recrutés, honoraires et inscrits se lisent alors produit par produit.", vars: {} });
  if (products.count > 0 && products.unassigned > 0 && (products.coverage ?? 0) < R.coverage)
    out.push({
      key: "produits-a-rattacher", level: 2, tone: "warn", tab: "produits",
      title: products.unassigned > 1 ? "{n} dossiers de {year} ne sont rattachés à aucun produit" : "Un dossier de {year} n'est rattaché à aucun produit",
      detail: "Seuls {coverage} % de vos dossiers de l'année ont un produit : la lecture par produit reste partielle tant qu'ils ne sont pas rattachés.",
      vars: { n: products.unassigned, year, coverage: pct(products.coverage ?? 0) },
    });
  for (const r of live) {
    const answered = r.accepted + r.declined;
    if (answered >= R.minAnswers && r.accepted / answered < R.lowAcceptance)
      out.push({
        key: `produit-decline:${normName(r.name)}`, level: 2, tone: "warn", tab: "produits",
        title: "Les experts déclinent souvent {product}",
        detail: "{accepted} acceptations pour {answered} réponses en {year} ({rate} %). Revoyez l'objet proposé, le format ou les honoraires face aux repères de marché.",
        vars: { product: r.name, accepted: r.accepted, answered, rate: pct(r.accepted / answered), year },
      });
    if (r.experts === 0 && r.previousExperts > 0)
      out.push({
        key: `produit-sans-expert:${normName(r.name)}`, level: 2, tone: "warn", tab: "produits",
        title: "{product} n'a engagé aucun expert en {year}",
        detail: "{n} experts y collaboraient en {previous}. Si le produit reste prioritaire, relancez-les ; sinon, archivez-le.",
        vars: { product: r.name, year, previous: year - 1, n: r.previousExperts },
      });
  }
  const best = live.slice().sort((a, b) => b.recruited - a.recruited)[0];
  if (best && best.recruited >= 2)
    out.push({
      key: "produit-qui-recrute", level: 3, tone: "ok", tab: "produits",
      title: "{product} est le produit qui recrute le plus",
      detail: "{n} nouveaux experts en {year} sont entrés dans votre panel par ce produit. Regardez ce qui a fonctionné (format, sujet, intervenants) pour le reproduire ailleurs.",
      vars: { product: best.name, n: best.recruited, year },
    });

  // 6. Concurrents : hausse notable des montants déclarés.
  for (const c of competitors) {
    if (c.previousCents > 0 && c.year.lines >= 5 && c.year.cents >= c.previousCents * (1 + R.competitorRise))
      out.push({
        key: `concurrent-hausse:${normName(c.name)}`, level: 2, tone: "warn", tab: "concurrents",
        title: "{name} déclare {rise} % de plus qu'en {previous}",
        detail: c.purposes[0] ? "Premier objet déclaré en {year} : {purpose}. Voyez quels bénéficiaires sont aussi dans votre portefeuille." : "Voyez quels bénéficiaires sont aussi dans votre portefeuille.",
        vars: { name: c.name, rise: pct(c.year.cents / c.previousCents - 1), previous: year - 1, year, purpose: c.purposes[0]?.label ?? "" },
      });
  }

  // 7. Sources : concurrents à suivre, fichier à renouveler.
  if (competitors.length === 0)
    out.push({ key: "sans-concurrents", level: 3, tone: "info", tab: "concurrents", title: "Suivez vos concurrents", detail: "Ajoutez vos principaux concurrents : leurs déclarations publiques, les experts que vous partagez et les publications qui les citent apparaissent alors ici.", vars: {} });
  else if (!lastImportAt)
    out.push({ key: "sans-import", level: 3, tone: "info", tab: "sources", title: "Importez un fichier Transparence Santé", detail: "Vous suivez {n} concurrents, sans aucune déclaration importée : exportez-les du site public et déposez le fichier.", vars: { n: competitors.length } });
  else if (now.getTime() - lastImportAt.getTime() > R.importAge * 86400e3)
    out.push({ key: "import-ancien", level: 3, tone: "info", tab: "sources", title: "Vos données Transparence Santé ont plus de six mois", detail: "La base publique est mise à jour deux fois par an : un nouvel export met à jour les montants de vos concurrents et vos experts partagés.", vars: {} });

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
