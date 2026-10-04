// Marque la migration initiale comme appliquée sur une base créée avant
// l'introduction des migrations (via « prisma db push »). Sans effet sinon.
import { execSync } from "node:child_process";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS has_migrations,
          to_regclass('public."User"') IS NOT NULL AS has_tables`,
);
await client.end();

if (!rows[0].has_migrations && rows[0].has_tables) {
  console.log("Base existante sans historique de migrations : baseline de 0_init.");
  execSync("npx prisma migrate resolve --applied 0_init", { stdio: "inherit" });
} else {
  console.log("Baseline inutile.");
}
