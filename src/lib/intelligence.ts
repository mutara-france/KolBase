/**
 * KolBase Intelligence : règles communes de lecture (noms, montants, dates, types de lien), de rapprochement des
 * personnes et des organisations par leur nom, et de lecture du portefeuille d'experts de l'organisation.
 * Module pur, testé. Les données d'une autre organisation cliente de KolBase n'y entrent jamais.
 */

/** Nom comparé sans casse, accents ni ponctuation (« Dentalys Implants S.A.S. » → « dentalys implants s a s »). */
export const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const LINK_KINDS = ["convention", "remuneration", "avantage"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
/** Type de lien d'une ligne (« Convention », « Rémunération », « Avantage », ou leur initiale). */
export function linkKind(v: string): LinkKind | null {
  const n = normName(v);
  return n.startsWith("conv") || n === "c" ? "convention" : n.startsWith("rem") || n === "r" ? "remuneration" : n.startsWith("avan") || n === "a" ? "avantage" : null;
}

/** Montant d'une cellule (« 1 234,56 », « 1234.56 », « 150 € ») en centimes ; null si illisible ou démesuré. */
export function amountCents(v: string): number | null {
  const s = v.replace(/[\s  €]/g, "").replace(",", ".");
  const n = Number(s);
  return s && Number.isFinite(n) && n >= 0 && n <= 20_000_000 ? Math.round(n * 100) : null;
}
/** Date d'une cellule : « 2025-03-14 », « 14/03/2025 », ou numéro de série Excel ; midi UTC, null si illisible. */
export function cellDate(v: string): Date | null {
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  const ymd = iso ? [iso[1], iso[2], iso[3]] : fr ? [fr[3], fr[2].padStart(2, "0"), fr[1].padStart(2, "0")] : null;
  if (ymd) {
    const d = new Date(`${ymd.join("-")}T12:00:00Z`);
    // Jour inexistant (31 février) : JavaScript le reporterait au mois suivant.
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd.join("-") || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100 ? null : d;
  }
  // Excel : jours depuis le 30 décembre 1899 (2000 → 36526, 2100 → 73051).
  const serial = /^\d{5}(\.\d+)?$/.test(s) ? Number(s) : 0;
  return serial >= 36526 && serial <= 73051 ? new Date(Date.UTC(1899, 11, 30, 12) + Math.floor(serial) * 86400000) : null;
}

/** Écritures d'une organisation (nom, marques, filiales) : saisies séparées par des virgules ou des retours à la ligne. */
export const parseAliases = (v: string) => [...new Set(v.split(/[,;\n]/).map((x) => x.trim().slice(0, 120)).filter((x) => normName(x).length >= 3))].slice(0, 12);
/** Clé de rapprochement d'une personne par son nom (ordre des mots indifférent : « DURAND Claire » = « Claire Durand »). */
export const personKey = (name: string) => normName(name).split(" ").filter(Boolean).sort().join(" ");

export type Loyalty = "nouveau" | "fidele" | "revenu" | "dormant";
export const LOYALTY_LABEL: Record<Loyalty, string> = { nouveau: "Nouveaux", fidele: "Fidèles", revenu: "De retour", dormant: "Dormants" };
/**
 * Place d'un expert dans le portefeuille de l'année : nouveau (première collaboration), fidèle (aussi engagé l'année
 * précédente), de retour (engagé auparavant, pas l'année précédente), dormant (engagé l'année précédente, plus cette
 * année). null : sans lien avec l'année regardée.
 */
export function loyalty(years: readonly number[], year: number): Loyalty | null {
  const now = years.includes(year), last = years.includes(year - 1), before = years.some((y) => y < year - 1);
  return now ? (last ? "fidele" : before ? "revenu" : "nouveau") : last ? "dormant" : null;
}
