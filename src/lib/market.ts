import { amountCents, cellDate, linkKind, normName, personKey, type LinkKind } from "@/lib/intelligence";

/**
 * KolBase Intelligence : base publique Transparence Santé tenue par l'équipe KolBase. Lecture du fichier (lien Google,
 * CSV lu au fil de l'eau) et comparaison d'une organisation au marché, à des organisations équivalentes et à celles
 * qu'elle choisit. Module pur, testé. Données publiques seulement : rien d'une organisation cliente n'y entre.
 */

const GOOGLE_ID = /^[A-Za-z0-9_-]{20,80}$/;
export const GOOGLE_DRIVE = "https://drive.usercontent.google.com";
export const GOOGLE_SHEETS = "https://docs.google.com";
/**
 * Lien de partage d'un fichier CSV sur Google Drive, ou d'une feuille Google Sheets → adresse de téléchargement du
 * CSV ; null pour toute autre adresse (l'import ne lit que chez Google : aucune adresse libre n'est suivie).
 */
export function sourceDownload(link: string, drive: string = GOOGLE_DRIVE, sheets: string = GOOGLE_SHEETS): string | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "docs.google.com") {
    const id = /^\/spreadsheets\/d\/([^/]+)/.exec(url.pathname)?.[1];
    const gid = /gid=(\d{1,12})/.exec(url.search + url.hash)?.[1];
    return id && GOOGLE_ID.test(id) ? `${sheets}/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}` : null;
  }
  if (url.hostname === "drive.google.com" || url.hostname === "drive.usercontent.google.com") {
    const id = /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get("id");
    return id && GOOGLE_ID.test(id) ? `${drive}/download?id=${id}&export=download&confirm=t` : null;
  }
  return null;
}

/** Longueur gardée d'une cellule : au-delà, la suite est ignorée (un fichier mal formé ne remplit pas la mémoire). */
const MAX_CELL = 2000;
/**
 * Lecteur CSV au fil de l'eau : le fichier (plusieurs dizaines de Mo) arrive par morceaux et n'est jamais tenu en
 * entier en mémoire. Séparateur deviné sur la première ligne (point-virgule, tabulation ou virgule) ; cellules entre
 * guillemets, guillemets doublés et retours à la ligne dans une cellule reconnus, y compris à cheval sur deux morceaux.
 */
export class CsvStream {
  private head = "";
  private delimiter = "";
  private cell = "";
  private row: string[] = [];
  private quoted = false;
  private closing = false;

  /** Lignes complètes lues dans ce morceau. */
  push(chunk: string): string[][] {
    if (this.delimiter) return this.read(chunk);
    this.head += chunk;
    const nl = this.head.indexOf("\n");
    if (nl < 0 && this.head.length < 65_536) return [];
    const first = nl < 0 ? this.head : this.head.slice(0, nl);
    const count = (d: string) => first.split(d).length;
    this.delimiter = [";", "\t", ","].sort((a, b) => count(b) - count(a))[0];
    const text = this.head.replace(/^﻿/, "");
    this.head = "";
    return this.read(text);
  }

  /** Fin du fichier : dernière ligne, même sans retour à la ligne final. */
  end(): string[][] {
    const out = this.delimiter || !this.head ? [] : this.push("\n");
    if (this.cell || this.row.length) {
      this.row.push(this.cell);
      out.push(this.row);
    }
    this.row = [];
    this.cell = "";
    this.quoted = this.closing = false;
    return out;
  }

  private read(text: string): string[][] {
    const out: string[][] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (this.closing) {
        // Guillemet lu dans une cellule entre guillemets : doublé, c'est un guillemet ; sinon la cellule se ferme.
        this.closing = false;
        if (ch === '"') { this.add(ch); continue; }
        this.quoted = false;
      }
      if (this.quoted) {
        if (ch === '"') this.closing = true;
        else this.add(ch);
      } else if (ch === '"' && this.cell === "") this.quoted = true;
      else if (ch === this.delimiter) { this.row.push(this.cell); this.cell = ""; }
      else if (ch === "\n") {
        this.row.push(this.cell);
        this.cell = "";
        if (this.row.length > 1 || this.row[0] !== "") out.push(this.row);
        this.row = [];
      } else if (ch !== "\r") this.add(ch);
    }
    return out;
  }

  private add(ch: string) {
    if (this.cell.length < MAX_CELL) this.cell += ch;
  }
}

export const MARKET_FIELDS = ["company", "kind", "date", "lastName", "firstName", "amount", "sector", "purpose", "rpps", "category", "city", "postal", "dept", "region"] as const;
export type MarketField = (typeof MARKET_FIELDS)[number];
/**
 * En-têtes de l'export officiel (transparence.sante.gouv.fr), comparés sans casse, accents ni ponctuation ; pour
 * chaque champ, le premier libellé présent est retenu. Le premier de chaque liste est celui de l'export actuel.
 */
const HEADERS: Record<MarketField, string[]> = {
  company: ["raison sociale", "denomination sociale", "entreprise"],
  kind: ["lien interet", "type de lien", "ligne type"],
  date: ["date", "date signature", "date debut"],
  lastName: ["identite", "nom", "benef nom"],
  firstName: ["prenom", "benef prenom"],
  amount: ["montant", "montant ttc"],
  sector: ["secteur activite", "secteur"],
  purpose: ["motif lien interet", "motif", "objet"],
  rpps: ["beneficiaire identifiant", "rpps"],
  category: ["beneficiaire categorie", "categorie"],
  city: ["ville sanscedex", "ville"],
  postal: ["code postal"],
  dept: ["dep code"],
  region: ["reg name", "region"],
};
/** Sans elles, une ligne ne dit pas qui déclare quoi, quand, pour qui. */
const REQUIRED: MarketField[] = ["company", "kind", "date", "lastName"];
export type MarketColumns = Partial<Record<MarketField, number>>;
/** Colonnes reconnues dans la ligne d'en-tête ; `missing` : libellés officiels des colonnes indispensables absentes. */
export function marketColumns(headers: readonly string[]): { columns: MarketColumns; missing: string[] } {
  const norm = headers.map(normName);
  const columns: MarketColumns = {};
  for (const field of MARKET_FIELDS) {
    const at = HEADERS[field].map((h) => norm.indexOf(h)).find((i) => i >= 0);
    if (at !== undefined) columns[field] = at;
  }
  return { columns, missing: REQUIRED.filter((f) => columns[f] === undefined).map((f) => HEADERS[f][0].replaceAll(" ", "_")) };
}

/** Valeurs qui disent « rien » dans l'export. */
const BLANK = new Set(["", "null", "nr", "non renseigne", "non renseignee"]);
/** Première année publiée par la base Transparence Santé. */
const FIRST_YEAR = 2012;

export type MarketRow = {
  companyKey: string; company: string; sector: string | null; kind: LinkKind; year: number; amountCents: number; purpose: string | null;
  personKey: string; nameKey: string; personName: string; rpps: string | null; category: string | null; city: string | null; region: string | null;
};
/**
 * Ligne du fichier → lien publié ; null si elle n'a ni entreprise, ni type de lien reconnu, ni date entre 2012 et
 * `lastYear`, ni bénéficiaire. Une convention sans montant compte pour zéro. Bénéficiaire reconnu d'une entreprise à
 * l'autre par son nom, son prénom (ordre indifférent : l'export les inverse parfois) et son département — le
 * département écarte les homonymes ; son identifiant dans le fichier est propre à chaque déclarant et ne sert pas.
 */
export function parseMarketRow(row: readonly string[], c: MarketColumns, lastYear: number): MarketRow | null {
  const cell = (f: MarketField) => (c[f] === undefined ? "" : (row[c[f]!] ?? "").trim());
  const text = (f: MarketField, max: number) => (BLANK.has(normName(cell(f))) ? null : cell(f).slice(0, max));
  const company = cell("company").slice(0, 200), companyKey = normName(company);
  const kind = linkKind(cell("kind"));
  const year = cellDate(cell("date"))?.getUTCFullYear() ?? 0;
  const personName = [cell("lastName"), cell("firstName")].filter(Boolean).join(" ").slice(0, 200), nameKey = personKey(personName);
  if (!companyKey || !kind || year < FIRST_YEAR || year > lastYear || !nameKey) return null;
  const postal = cell("postal").replace(/\s/g, "");
  // Département : celui du fichier, à défaut les premiers chiffres du code postal (trois outre-mer).
  const dept = (cell("dept") || (/^\d{5}$/.test(postal) ? postal.slice(0, postal.startsWith("97") ? 3 : 2) : "")).slice(0, 3).toUpperCase();
  return {
    companyKey, company, sector: text("sector", 120), kind, year, amountCents: amountCents(cell("amount")) ?? 0, purpose: text("purpose", 200),
    personKey: `${nameKey}|${dept}`, nameKey, personName, rpps: cell("rpps").replace(/\s/g, "").slice(0, 40) || null, category: text("category", 120), city: text("city", 120), region: text("region", 120),
  };
}

/** Entreprise de la base dont le nom contient, en mots entiers, l'une des écritures données (trois caractères au moins). */
export function namedBy(company: string, names: readonly string[]) {
  const hay = ` ${normName(company)} `;
  return names.some((n) => normName(n).length >= 3 && hay.includes(` ${normName(n)} `));
}

/** Chiffres d'une entreprise (ou d'un groupe d'entités) sur une année : montants versés (avantages et rémunérations), liens, bénéficiaires. */
export type CompanyYear = { key: string; name: string; sector: string | null; cents: number; lines: number; people: number };

export const median = (xs: readonly number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b), mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export const PEER_RULES = {
  /** Taille proche : entre la moitié et le double de celle de l'organisation. */
  ratio: 2,
  /** Nombre d'organisations en dessous duquel la comparaison est élargie (au secteur entier, puis aux plus proches). */
  min: 5,
} as const;
const vague = (sector: string | null) => !sector || ["autre", "autres", "divers"].includes(normName(sector));
/**
 * Organisations équivalentes : même secteur d'activité quand il est renseigné et assez fourni, et taille proche
 * (montants versés dans l'année entre la moitié et le double ; à défaut de montants, nombre de liens). S'il y en a
 * moins de cinq, les cinq de taille la plus proche. `sector` : secteur retenu (null : tous secteurs).
 */
export function peersOf(me: Pick<CompanyYear, "sector" | "cents" | "lines">, others: readonly CompanyYear[]): { peers: CompanyYear[]; sector: string | null; by: "montants" | "liens" } {
  const by = me.cents > 0 ? "montants" : "liens";
  const size = (c: Pick<CompanyYear, "cents" | "lines">) => (by === "montants" ? c.cents : c.lines);
  const mine = size(me);
  if (mine <= 0) return { peers: [], sector: null, by };
  const sized = others.filter((c) => size(c) > 0);
  const same = vague(me.sector) ? [] : sized.filter((c) => c.sector === me.sector);
  const pool = same.length >= PEER_RULES.min ? same : sized;
  const near = pool.filter((c) => size(c) >= mine / PEER_RULES.ratio && size(c) <= mine * PEER_RULES.ratio);
  const gap = (c: CompanyYear) => Math.abs(Math.log(size(c) / mine));
  const peers = near.length >= PEER_RULES.min ? near : [...pool].sort((a, b) => gap(a) - gap(b) || a.name.localeCompare(b.name, "fr")).slice(0, PEER_RULES.min);
  return { peers, sector: pool === same ? me.sector : null, by };
}

/** Rang d'une valeur parmi d'autres (1 : la plus élevée) ; null si elle est nulle. */
export const rankOf = (value: number, others: readonly number[]) => (value > 0 ? 1 + others.filter((x) => x > value).length : null);

export type SplitRow = { label: string; cents: number; lines: number };
export type Share = { label: string; me: number; peers: number; market: number };
/**
 * Répartition comparée (par motif, par région) : part de chaque libellé chez l'organisation, chez ses équivalentes et
 * sur le marché. En montants quand l'organisation en déclare ; sinon en nombre de liens. Les `top` premiers libellés
 * de l'organisation et des équivalentes, classés par l'écart le plus fort.
 */
export function shareTable(me: readonly SplitRow[], peers: readonly SplitRow[], market: readonly SplitRow[], top = 6): { by: "montants" | "liens"; rows: Share[] } {
  const by = me.reduce((s, r) => s + r.cents, 0) > 0 ? "montants" : "liens";
  const value = (r: SplitRow) => (by === "montants" ? r.cents : r.lines);
  const parts = (rows: readonly SplitRow[]) => {
    const total = rows.reduce((s, r) => s + value(r), 0);
    return new Map(rows.map((r) => [r.label, total > 0 ? value(r) / total : 0]));
  };
  const m = parts(me), p = parts(peers), k = parts(market);
  const rows = [...new Set([...m.keys(), ...p.keys()])].map((label) => ({ label, me: m.get(label) ?? 0, peers: p.get(label) ?? 0, market: k.get(label) ?? 0 }));
  return { by, rows: rows.filter((r) => r.me > 0 || r.peers >= 0.02).sort((a, b) => Math.max(b.me, b.peers) - Math.max(a.me, a.peers) || a.label.localeCompare(b.label, "fr")).slice(0, top) };
}
