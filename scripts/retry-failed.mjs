// Migrations dont un premier passage a échoué en production puis a été corrigé. Postgres les a annulées en
// bloc (une migration s'exécute dans une transaction implicite) ; elles sont marquées « rolled back » pour que
// « prisma migrate deploy » rejoue la version corrigée. Sans effet si elles n'ont pas échoué.
import { execSync } from "node:child_process";
import pg from "pg";

const RETRY = ["20261105130000_tva_par_ligne"];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows: t } = await client.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`);
const failed = t[0].ok
  ? (await client.query(
      `SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NULL AND rolled_back_at IS NULL AND migration_name = ANY($1)`,
      [RETRY],
    )).rows.map((r) => r.migration_name)
  : [];
await client.end();

for (const name of failed) {
  console.log(`Migration ${name} en échec : marquée annulée pour être rejouée corrigée.`);
  execSync(`npx prisma migrate resolve --rolled-back ${name}`, { stdio: "inherit" });
}
if (!failed.length) console.log("Aucune migration en échec à rejouer.");
