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
const BATCH = 1000;
/** Durée au-delà de laquelle un import « en cours » est tenu pour interrompu, quoi qu'il arrive. */
const IMPORT_STALE_MS = 30 * 60_000;
/**
 * Import « en cours » qui ne se terminera pas : lancé avant le démarrage de ce serveur (la lecture se fait dans le
 * serveur ; un redémarrage l'interrompt), ou depuis trop longtemps. La page le dit aussitôt, et une nouvelle mise à
 * jour peut être lancée sans attendre.
 */
export const importInterrupted = (imp: { status: string; createdAt: Date }, now = Date.now()) =>
  imp.status === "en_cours" && (imp.createdAt.getTime() < now - process.uptime() * 1000 || now - imp.createdAt.getTime() > IMPORT_STALE_MS);

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
    let columns: MarketColumns | null = null, rows = 0, kept = 0, bytes = 0;
    let batch: MarketRow[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      // Une seule requête, au texte constant : les valeurs voyagent en tableaux (une colonne par tableau). Avec
      // createMany, chaque lot — une requête au texte différent — restait en mémoire (environ 10 Mo par lot de
      // 2 000 lignes) : la lecture du fichier réel a épuisé la mémoire du serveur.
      const col = <K extends keyof MarketRow>(k: K) => batch.map((r) => r[k]);
      await db.$executeRaw`
        INSERT INTO "MarketLink" ("id", "importId", "companyKey", "company", "sector", "kind", "year", "amountCents", "purpose", "personKey", "nameKey", "personName", "rpps", "category", "city", "region")
        SELECT gen_random_uuid()::text, ${importId}, t.company_key, t.company, t.sector, t.kind::"PublicLinkKind", t.year, t.amount, t.purpose, t.person_key, t.name_key, t.person_name, t.rpps, t.category, t.city, t.region
        FROM unnest(${col("companyKey")}::text[], ${col("company")}::text[], ${col("sector")}::text[], ${col("kind")}::text[], ${col("year")}::int[], ${col("amountCents")}::int[], ${col("purpose")}::text[], ${col("personKey")}::text[], ${col("nameKey")}::text[], ${col("personName")}::text[], ${col("rpps")}::text[], ${col("category")}::text[], ${col("city")}::text[], ${col("region")}::text[])
          AS t(company_key, company, sector, kind, year, amount, purpose, person_key, name_key, person_name, rpps, category, city, region)`;
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
    // Entreprises, bénéficiaires et années comptés par la base : rien n'est accumulé en mémoire pendant la lecture.
    const [sum] = await db.$queryRaw<{ companies: number; people: number; first: number; last: number }[]>`
      SELECT COUNT(DISTINCT "companyKey")::int AS companies, COUNT(DISTINCT "personKey")::int AS people, MIN("year")::int AS first, MAX("year")::int AS last FROM "MarketLink" WHERE "importId" = ${importId}`;
    await db.marketImport.update({ where: { id: importId }, data: { status: "pret", rows, kept, companies: sum.companies, people: sum.people, firstYear: sum.first, lastYear: sum.last, finishedAt: new Date() } });
    // Le nouvel import est lu dès maintenant : les lignes des précédents ne servent plus (leur trace reste).
    await db.marketLink.deleteMany({ where: { importId: { not: importId } } });
  } catch (e) {
    await db.marketLink.deleteMany({ where: { importId } }).catch(() => undefined);
    await db.marketImport.update({ where: { id: importId }, data: { status: "echec", error: errorText(e).slice(0, 1200), finishedAt: new Date() } }).catch(() => undefined);
  }
}
