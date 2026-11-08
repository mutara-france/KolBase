/**
 * Groupes et aiguillage (module pur) : un praticien propose un projet à un groupe (plusieurs entités dans le monde) ;
 * la proposition va à l'entité qui couvre son pays (et la marque concernée), puis au canal du sujet, chez son
 * responsable, avec un délai de réponse.
 */

export const TOPICS = [
  { id: "formation", label: "Formation et enseignement" },
  { id: "recherche", label: "Recherche clinique et études" },
  { id: "innovation", label: "Innovation, idée de produit" },
  { id: "partenariat", label: "Partenariat scientifique (société savante, congrès)" },
  { id: "communication", label: "Communication, événements, contenus" },
  { id: "autre", label: "Autre sujet" },
] as const;
export type Topic = (typeof TOPICS)[number]["id"];
export const isTopic = (v: string): v is Topic => TOPICS.some((x) => x.id === v);
export const topicLabel = (v: string | null | undefined) => TOPICS.find((x) => x.id === v)?.label ?? "Autre sujet";

/** Sujet proposé par défaut selon la catégorie du type de collaboration. */
export function defaultTopic(category: string): Topic {
  const c = category.toLowerCase();
  if (c.includes("enseignement") || c.includes("formation")) return "formation";
  if (c.includes("recherche") || c.includes("essai")) return "recherche";
  if (c.includes("contenu") || c.includes("communication")) return "communication";
  return "autre";
}

/** Conditions par défaut d'une idée de produit soumise sans accord de confidentialité. */
export const DEFAULT_IP_POLICY =
  "Ne partagez pas d'information confidentielle ni d'invention brevetable non protégée : l'organisation n'est tenue à aucune confidentialité avant la signature d'un accord. Vous pouvez demander cet accord avant de détailler votre idée.";

export const DEFAULT_RESPONSE_DAYS = 10;
export const MAX_RESPONSE_DAYS = 60;

type Entity = { id: string; coveredCountries: string[]; brands: string[] };
const same = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" }) === 0;

/**
 * Entité d'un groupe qui reçoit la proposition : celle de la marque (si l'expert en indique une et que des entités
 * en déclarent), puis celle qui couvre le pays de l'expert ; à défaut, le siège (sans pays déclaré), sinon la première.
 */
export function pickEntity<T extends Entity>(entities: T[], o: { country: string; brand?: string | null }): T | null {
  if (!entities.length) return null;
  let pool = entities;
  if (o.brand && entities.some((e) => e.brands.length)) {
    const byBrand = entities.filter((e) => e.brands.some((b) => same(b, o.brand!)));
    if (byBrand.length) pool = byBrand;
  }
  return pool.find((e) => e.coveredCountries.includes(o.country)) ?? pool.find((e) => e.coveredCountries.length === 0) ?? pool[0];
}

/** Canal d'un sujet ; à défaut, le canal « Autre sujet » ; sinon aucun (l'équipe Projets reçoit). */
export function pickChannel<T extends { topic: string }>(channels: T[], topic: string): T | null {
  return channels.find((c) => c.topic === topic) ?? channels.find((c) => c.topic === "autre") ?? null;
}

/** Réponse attendue : la date de réception plus le délai du canal (jours calendaires). */
export const responseDue = (from: Date, days: number) => new Date(from.getTime() + days * 86400e3);

/** Pays couverts saisis (codes ISO séparés par des virgules ou des espaces), sans doublon, dans la liste connue. */
export function parseCountries(raw: string, known: (code: string) => boolean) {
  return [...new Set(raw.toUpperCase().split(/[\s,;]+/).filter((c) => /^[A-Z]{2}$/.test(c) && known(c) && c !== "XX"))];
}

/** Marques saisies (séparées par des virgules), sans doublon, 20 au plus. */
export function parseBrands(raw: string) {
  const out: string[] = [];
  for (const b of raw.split(/[,;\n]/).map((x) => x.trim().slice(0, 60)).filter(Boolean)) if (!out.some((x) => same(x, b))) out.push(b);
  return out.slice(0, 20);
}
