// Logos des organisations partenaires publiées avec leur accord (Straumann, Septodont, Mega Dental).
// Exécuté à chaque déploiement : pose le logo s'il manque, sans jamais remplacer un logo déposé depuis KolBase.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const LOGOS = [
  ["straumann", "straumann.png"],
  ["septodont", "septodont.png"],
  ["megadental", "megadental.png"],
];
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "partenaires");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
for (const [id, file] of LOGOS) {
  const { rows } = await client.query(`SELECT o.id, l."organizationId" AS has_logo FROM "Organization" o LEFT JOIN "OrganizationLogo" l ON l."organizationId" = o.id WHERE o.id = $1`, [id]);
  if (rows.length === 0 || rows[0].has_logo) continue;
  const data = fs.readFileSync(path.join(dir, file));
  await client.query(`INSERT INTO "OrganizationLogo" ("organizationId", data, "contentType", "updatedAt") VALUES ($1, $2, 'image/png', now())`, [id, data]);
  await client.query(`UPDATE "Organization" SET "logoUpdatedAt" = now() WHERE id = $1`, [id]);
  console.log(`Logo posé : ${id}`);
}
await client.end();
