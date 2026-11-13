import "server-only";
import { db } from "@/lib/db";
import { errorText } from "@/lib/redact";
import { CsvStream, GOOGLE_DRIVE, GOOGLE_SHEETS, marketColumns, parseMarketRow, sourceDownload, type MarketColumns, type MarketRow } from "@/lib/market";

/**
 * Mise à jour de la base publique Transparence Santé : téléchargement du fichier CSV partagé par lien (Google Drive
 * ou Google Sheets), lu au fil de l'eau et rangé par lots. Les organisations continuent de lire l'import précédent
 * jusqu'à la fin ; il n'est effacé qu'une fois le nouveau prêt. Un import en échec ne laisse aucune ligne.
 */

// Tests de bout en bout : faux Google local (GOOGLE_FILES_URL). En service, seules les adresses de Google sont lues.
const DRIVE = process.env.GOOGLE_FILES_URL ?? GOOGLE_DRIVE;
const SHEETS = process.env.GOOGLE_FILES_URL ?? GOOGLE_SHEETS;
const MAX_BYTES = 400 * 1024 * 1024;
const MAX_ROWS = 3_000_000;
const BATCH = 2000;
/** Durée au-delà de laquelle un import « en cours » est tenu pour interrompu (redémarrage du service pendant la lecture). */
export const IMPORT_STALE_MS = 30 * 60_000;

/** Hôtes vers lesquels Google redirige un téléchargement ; rien d'autre n'est suivi. */
const allowed = (url: URL) => url.origin === new URL(DRIVE).origin || url.origin === new URL(SHEETS).origin || (url.protocol === "https:" && /(^|\.)(google\.com|googleusercontent\.com)$/.test(url.hostname));

async function open(address: string): Promise<Response> {
  let url = new URL(address);
  for (let hop = 0; hop < 6; hop++) {
    if (!allowed(url)) break;
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15 * 60_000), headers: { "User-Agent": "KolBase-base-publique/1.0 (+https://kolbase.io)" } });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (next) { url = new URL(next, url); continue; }
    if (res.status === 404) throw new Error("fichier introuvable : vérifiez le lien");
    if (!res.ok) throw new Error(`Google a répondu ${res.status} : vérifiez que le fichier est partagé à « Tous les utilisateurs disposant du lien »`);
    // Fichier non partagé : Google renvoie sa page de connexion (HTML) au lieu du fichier.
    if ((res.headers.get("content-type") ?? "").includes("text/html")) throw new Error("Google n'a pas donné le fichier : partagez-le à « Tous les utilisateurs disposant du lien », en lecture");
    return res;
  }
  throw new Error("adresse de téléchargement refusée");
}

export async function runMarketImport(importId: string) {
  const imp = await db.marketImport.findUnique({ where: { id: importId } });
  if (imp?.status !== "en_cours") return;
  try {
    const address = sourceDownload(imp.sourceUrl, DRIVE, SHEETS);
    if (!address) throw new Error("lien refusé : collez le lien de partage d'un fichier Google Drive ou d'une feuille Google Sheets");
    const res = await open(address);
    if (!res.body) throw new Error("fichier vide");
    const csv = new CsvStream(), decoder = new TextDecoder("utf-8");
    const lastYear = new Date().getUTCFullYear();
    let columns: MarketColumns | null = null, rows = 0, kept = 0, bytes = 0, firstYear = 0, endYear = 0;
    const companies = new Set<string>(), people = new Set<string>();
    let batch: MarketRow[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await db.marketLink.createMany({ data: batch.map((r) => ({ ...r, importId })) });
      batch = [];
      // Avancement visible sur la page d'administration pendant la lecture.
      await db.marketImport.update({ where: { id: importId }, data: { rows, kept } });
    };
    const take = async (lines: string[][]) => {
      for (const line of lines) {
        if (!columns) {
          const found = marketColumns(line);
          if (found.missing.length) throw new Error(`colonnes introuvables : ${found.missing.join(", ")}. En-têtes lus : ${line.slice(0, 60).join(", ").slice(0, 900)}`);
          columns = found.columns;
          continue;
        }
        if (++rows > MAX_ROWS) throw new Error("fichier trop long (plus de trois millions de lignes)");
        const row = parseMarketRow(line, columns, lastYear);
        if (!row) continue;
        kept++;
        companies.add(row.companyKey);
        people.add(row.personKey);
        firstYear = firstYear ? Math.min(firstYear, row.year) : row.year;
        endYear = Math.max(endYear, row.year);
        batch.push(row);
        if (batch.length >= BATCH) await flush();
      }
    };
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("fichier trop lourd (plus de 400 Mo)");
      await take(csv.push(decoder.decode(value, { stream: true })));
    }
    await take(csv.push(decoder.decode()));
    await take(csv.end());
    await flush();
    if (kept === 0) throw new Error(rows === 0 ? "le fichier ne contient aucune ligne" : `${rows} lignes lues, aucune lisible (entreprise, type de lien, date, bénéficiaire)`);
    // Statistiques de la table recalculées avant la première lecture : sans elles, juste après un chargement en
    // masse, PostgreSQL choisit un plan désastreux pour les requêtes de comparaison (plus d'une minute au lieu de 5 ms).
    await db.$executeRaw`ANALYZE "MarketLink"`;
    await db.marketImport.update({ where: { id: importId }, data: { status: "pret", rows, kept, companies: companies.size, people: people.size, firstYear, lastYear: endYear, finishedAt: new Date() } });
    // Le nouvel import est lu dès maintenant : les lignes des précédents ne servent plus (leur trace reste).
    await db.marketLink.deleteMany({ where: { importId: { not: importId } } });
  } catch (e) {
    await db.marketLink.deleteMany({ where: { importId } }).catch(() => undefined);
    await db.marketImport.update({ where: { id: importId }, data: { status: "echec", error: errorText(e).slice(0, 1200), finishedAt: new Date() } }).catch(() => undefined);
  }
}
