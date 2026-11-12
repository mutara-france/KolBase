import { inflateRawSync } from "node:zlib";
import { attr, element, elements } from "@/lib/xml";

/**
 * Lecture d'un tableau déposé par une organisation (export CSV ou Excel d'un site public) : lignes de cellules en
 * texte, sans dépendance. Module pur, testé. Plafonds : un fichier Excel est une archive compressée, sa taille
 * décompressée est bornée avant toute lecture.
 */

/** Nombre maximal de lignes lues (au-delà, le fichier est à filtrer avant l'export). */
export const MAX_ROWS = 300_000;
/** Taille maximale d'une feuille Excel décompressée. */
const MAX_INFLATED = 200 * 1024 * 1024;

export class TabularError extends Error {}

/** CSV : séparateur deviné sur la première ligne (« ; », « , » ou tabulation), guillemets doublés, retours à la ligne dans un champ. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const head = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const sep = [";", "\t", ","].map((s) => [s, head.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS) throw new TabularError("rows");
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (src[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") endRow();
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

/** Fichiers d'une archive ZIP (répertoire central), décompressés à la demande. */
function zipEntries(bytes: Uint8Array) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin (commentaire d'archive éventuel).
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new TabularError("format");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new TabularError("format");
    const method = buf.readUInt16LE(at + 10), packed = buf.readUInt32LE(at + 20), size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    entries.set(name, () => {
      if (size > MAX_INFLATED) throw new TabularError("rows");
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + packed);
      if (method === 0) return data;
      if (method !== 8) throw new TabularError("format");
      return inflateRawSync(data, { maxOutputLength: MAX_INFLATED });
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const unescapeXml = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-fA-F]+);/g, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : e === "amp" ? "&" : String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))));
/** Texte d'un élément <si> ou <is> : ses <t> mis bout à bout (texte enrichi compris). */
const richText = (xml: string) => [...elements(xml, "t")].map((t) => unescapeXml(t.body)).join("");
/** Colonne d'une référence de cellule (« A1 » → 0, « AB12 » → 27). */
const columnOf = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
/** Nombre maximal de colonnes lues (une référence de cellule fantaisiste ne fait pas grossir la ligne). */
const MAX_COLUMNS = 500;

/** Première feuille d'un classeur Excel (.xlsx) : cellules en texte (nombres tels qu'écrits dans le fichier). */
export function readXlsx(bytes: Uint8Array): string[][] {
  const zip = zipEntries(bytes);
  const read = (name: string) => zip.get(name)?.().toString("utf8") ?? null;
  const shared = [...elements(read("xl/sharedStrings.xml") ?? "", "si")].map((si) => richText(si.body));
  const sheetName = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  const sheet = sheetName ? read(sheetName) : null;
  if (!sheet) throw new TabularError("format");
  const rows: string[][] = [];
  for (const r of elements(sheet, "row")) {
    const row: string[] = [];
    for (const c of elements(r.body, "c")) {
      const ref = attr(c.attrs, "r");
      const type = attr(c.attrs, "t");
      const v = element(c.body, "v")?.body ?? "";
      const value = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? richText(c.body) : unescapeXml(v);
      const col = ref && /^[A-Z]{1,3}\d+$/.test(ref) ? columnOf(ref) : row.length;
      if (col >= MAX_COLUMNS) continue;
      while (row.length < col) row.push("");
      row[col] = value;
    }
    if (row.some((x) => x !== "")) rows.push(row);
    if (rows.length > MAX_ROWS) throw new TabularError("rows");
  }
  return rows;
}

/** Tableau d'un fichier déposé, selon son contenu : archive ZIP (Excel) ou texte (CSV, UTF-8 ou Windows-1252). */
export function readTable(bytes: Uint8Array): string[][] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  // Ancien format Excel binaire (.xls) : à enregistrer en .xlsx ou en CSV.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new TabularError("format");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return parseCsv(text);
}
