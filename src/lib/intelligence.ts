import { createHash } from "node:crypto";

/**
 * KolBase Intelligence : règles de lecture du fichier public Transparence Santé déposé par l'organisation, de
 * rapprochement avec ses concurrents suivis et ses experts, et de lecture de son portefeuille d'experts.
 * Module pur, testé. Les données d'une autre organisation cliente de KolBase n'y entrent jamais.
 */

/** Nom comparé sans casse, accents ni ponctuation (« Dentalys Implants S.A.S. » → « dentalys implants s a s »). */
export const normName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const LINK_KINDS = ["convention", "remuneration", "avantage"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_KIND_LABEL: Record<LinkKind, string> = { convention: "Conventions", remuneration: "Rémunérations", avantage: "Avantages" };
/** Type de lien d'une ligne (« Convention », « Rémunération », « Avantage », ou leur initiale). */
export function linkKind(v: string): LinkKind | null {
  const n = normName(v);
  return n.startsWith("conv") || n === "c" ? "convention" : n.startsWith("rem") || n === "r" ? "remuneration" : n.startsWith("avan") || n === "a" ? "avantage" : null;
}

export const LINK_FIELDS = ["company", "kind", "amount", "date", "lastName", "firstName", "beneficiaryId", "category", "purpose", "ref"] as const;
export type LinkField = (typeof LINK_FIELDS)[number];
/** Colonnes sans lesquelles une ligne ne dit rien : entreprise déclarante, type de lien, montant. */
export const REQUIRED_FIELDS: LinkField[] = ["company", "kind", "amount"];
export const FIELD_LABEL: Record<LinkField, string> = {
  company: "entreprise déclarante", kind: "type de lien (convention, rémunération, avantage)", amount: "montant", date: "date",
  lastName: "nom du bénéficiaire", firstName: "prénom", beneficiaryId: "identifiant du bénéficiaire (RPPS)", category: "catégorie ou profession", purpose: "objet ou motif", ref: "identifiant de la déclaration",
};

/**
 * Colonnes reconnues dans la ligne d'en-tête, par mots-clés : l'export du site public a changé de libellés d'une
 * version à l'autre (« denomination_sociale », « Entreprise », « Montant TTC »…). Pour chaque champ, les règles sont
 * essayées dans l'ordre ; la première colonne qui en satisfait une est retenue.
 */
const RULES: Record<LinkField, ((h: string) => boolean)[]> = {
  company: [(h) => h.includes("denomination") && !h.includes("benef"), (h) => h.includes("raison sociale") && !h.includes("benef"), (h) => h === "entreprise" || h === "nom entreprise" || h === "entreprise nom"],
  kind: [(h) => h.includes("lien") && h.includes("interet") && !h.includes("motif"), (h) => h === "type" || h.includes("type de lien") || h.includes("type lien") || h === "ligne type", (h) => h === "declaration" || h.includes("type declaration")],
  amount: [(h) => h.includes("montant")],
  date: [(h) => h === "date", (h) => h.includes("date") && (h.includes("signature") || h.includes("versement")), (h) => h.includes("date") && h.includes("debut"), (h) => h.includes("date") && !h.includes("fin") && !h.includes("publication")],
  lastName: [(h) => h === "nom" || h === "identite" || h === "identite nom" || h === "benef nom" || h === "beneficiaire nom" || h === "nom beneficiaire"],
  firstName: [(h) => h.includes("prenom")],
  beneficiaryId: [(h) => h.includes("rpps"), (h) => (h.includes("identifiant") || h.includes("numero")) && (h.includes("valeur") || h.includes("benef") || h.includes("professionnel")) && !h.includes("type"), (h) => h === "n identifiant" || h === "numero identifiant" || h === "identifiant"],
  category: [(h) => h.includes("categorie") && !h.includes("code"), (h) => h.includes("profession") && !h.includes("identifiant"), (h) => h.includes("qualite")],
  purpose: [(h) => h.includes("motif") && !h.includes("autre"), (h) => h.includes("objet"), (h) => h.includes("nature")],
  ref: [(h) => h.includes("identifiant unique"), (h) => h === "declaration id" || h === "id declaration" || h === "id"],
};
export type LinkColumns = Partial<Record<LinkField, number>>;
export function detectColumns(headers: readonly string[]): { columns: LinkColumns; missing: LinkField[] } {
  const norm = headers.map(normName);
  const columns: LinkColumns = {};
  for (const field of LINK_FIELDS) {
    for (const rule of RULES[field]) {
      const i = norm.findIndex((h, at) => rule(h) && !Object.values(columns).includes(at));
      if (i >= 0) { columns[field] = i; break; }
    }
  }
  return { columns, missing: REQUIRED_FIELDS.filter((f) => columns[f] === undefined) };
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

export type ParsedLink = { company: string; kind: LinkKind; amountCents: number; date: Date | null; beneficiaryId: string | null; beneficiaryName: string | null; category: string | null; purpose: string | null; sourceKey: string };
/** Ligne du fichier → lien déclaré ; null si elle n'a ni entreprise, ni type de lien reconnu, ni montant lisible. */
export function parseLink(row: readonly string[], c: LinkColumns): ParsedLink | null {
  const cell = (f: LinkField) => (c[f] === undefined ? "" : (row[c[f]!] ?? "").trim());
  const company = cell("company").slice(0, 200);
  const kind = linkKind(cell("kind"));
  const amount = amountCents(cell("amount"));
  if (!company || !kind || amount === null) return null;
  const name = [cell("lastName"), cell("firstName")].filter(Boolean).join(" ").slice(0, 200);
  const id = cell("beneficiaryId").replace(/\s/g, "").slice(0, 40);
  const date = cellDate(cell("date"));
  // Empreinte de la ligne : la référence de la déclaration si le fichier la donne, sinon son contenu. Un même fichier
  // importé deux fois ne crée pas de doublon.
  const sourceKey = createHash("sha1").update(cell("ref") ? `ref:${cell("ref")}` : [normName(company), kind, amount, date?.toISOString().slice(0, 10) ?? "", id, normName(name), normName(cell("purpose"))].join("|")).digest("hex");
  return { company, kind, amountCents: amount, date, beneficiaryId: id || null, beneficiaryName: name || null, category: cell("category").slice(0, 120) || null, purpose: cell("purpose").slice(0, 300) || null, sourceKey };
}

/** Écritures d'un concurrent (nom, marques, filiales) : saisies séparées par des virgules ou des retours à la ligne. */
export const parseAliases = (v: string) => [...new Set(v.split(/[,;\n]/).map((x) => x.trim().slice(0, 120)).filter((x) => normName(x).length >= 3))].slice(0, 12);
/** Concurrent dont le nom ou une autre écriture figure, en mots entiers, dans le nom de l'entreprise déclarante. */
export function matchCompetitor<C extends { name: string; aliases: readonly string[] }>(company: string, competitors: readonly C[]): C | null {
  const hay = ` ${normName(company)} `;
  return competitors.find((c) => [c.name, ...c.aliases].some((a) => normName(a).length >= 3 && hay.includes(` ${normName(a)} `))) ?? null;
}

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
