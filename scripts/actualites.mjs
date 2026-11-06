// Actualités rédigées dans le dépôt (scripts/actualites/*.md) : exécuté à chaque déploiement, pose chacune une seule
// fois, en brouillon, pour qu'elle soit relue et publiée depuis /admin. La pose est inscrite au journal (« news.seed ») :
// une actualité supprimée ou renommée depuis l'administration ne revient pas au déploiement suivant.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.join(here, "actualites");
const COVER_TYPES = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** En-tête « clé: valeur » entre deux lignes « --- », puis le texte au format des actualités (lib/article-format). */
function read(file) {
  const text = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file} : en-tête « --- » manquant`);
  const meta = Object.fromEntries(m[1].split("\n").filter((l) => l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]));
  const a = { ...meta, body: m[2].trim() };
  // Mêmes limites que le formulaire de l'administration (news-actions.ts).
  if (!a.slug || !a.title || !a.excerpt || !a.body || !a.category) throw new Error(`${file} : slug, title, category, excerpt et texte sont obligatoires`);
  if (a.title.length > 160 || a.excerpt.length > 400 || a.body.length > 40000) throw new Error(`${file} : titre, chapô ou texte trop long`);
  if (a.cover) {
    const type = COVER_TYPES[path.extname(a.cover).toLowerCase()];
    const data = fs.readFileSync(path.join(here, "..", "public", a.cover));
    if (!type || data.length > 1.5 * 1024 * 1024) throw new Error(`${file} : image PNG, JPEG ou WebP de 1,5 Mo au plus`);
    a.coverData = data;
    a.coverType = type;
  }
  return a;
}

const articles = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map(read);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
for (const a of articles) {
  const { rows: seeded } = await client.query(`SELECT 1 FROM "AuditLog" WHERE action = 'news.seed' AND data->>'slug' = $1 LIMIT 1`, [a.slug]);
  if (seeded.length) continue;
  const { rows: taken } = await client.query(`SELECT 1 FROM "Article" WHERE slug = $1`, [a.slug]);
  if (taken.length) {
    console.log(`Actualité non posée, adresse déjà prise : ${a.slug}`);
    continue;
  }
  const id = crypto.randomUUID();
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO "Article" (id, slug, title, category, excerpt, body, "coverData", "coverType", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [id, a.slug, a.title, a.category, a.excerpt, a.body, a.coverData ?? null, a.coverType ?? null],
  );
  await client.query(`INSERT INTO "AuditLog" (id, action, "entityType", "entityId", data) VALUES ($1, 'news.seed', 'Article', $2, $3)`, [crypto.randomUUID(), id, { slug: a.slug }]);
  await client.query("COMMIT");
  console.log(`Actualité posée en brouillon : ${a.slug}`);
}
await client.end();
