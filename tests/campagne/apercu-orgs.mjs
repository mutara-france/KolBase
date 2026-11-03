// Aperçu local (jamais en production) : trois organisations réelles décrites à partir d'informations publiques,
// sans leur logo ; un logo original sur l'organisation fictive Dentalys pour montrer le rendu d'un logo.
import pg from "pg";
import fs from "node:fs";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const ORGS = [
  { id: "apercu-straumann", name: "Straumann Group", sector: "Implantologie et dentisterie esthétique", hq: "Bâle, Suisse",
    areas: ["Implantologie", "Biomatériaux", "Prothèse, CFAO", "Orthodontie"],
    about: "Groupe suisse fondé en 1954 et basé à Bâle. Il conçoit, fabrique et distribue des implants dentaires, des instruments, des biomatériaux, des prothèses CFAO, des solutions numériques et des aligneurs orthodontiques." },
  { id: "apercu-septodont", name: "Septodont", sector: "Anesthésie et consommables dentaires", hq: "Saint-Maur-des-Fossés, France",
    areas: ["Anesthésie", "Endodontie", "Odontologie restauratrice"],
    about: "Entreprise familiale française fondée en 1932, basée à Saint-Maur-des-Fossés. Spécialiste de la prise en charge de la douleur dentaire (anesthésiques, aiguilles, systèmes d'injection), elle produit aussi des matériaux de restauration et d'endodontie, distribués dans plus de 150 pays." },
  { id: "apercu-megadental", name: "Mega Dental", sector: "Distribution de fournitures dentaires", hq: "France",
    areas: ["Consommables", "Équipement", "Omnipratique"],
    about: "Distributeur français de fournitures et de matériel dentaires pour les cabinets : consommables, petit équipement et matériel d'omnipratique." },
];
for (const o of ORGS) {
  await db.query(
    `INSERT INTO "Organization" (id, name, kind, sector, headquarters, areas, about, listed, verification, "verifiedAt", "updatedAt")
     VALUES ($1, $2, 'INDUSTRIEL', $3, $4, $5, $6, true, 'VERIFIED', now(), now())
     ON CONFLICT (id) DO UPDATE SET name = $2, sector = $3, headquarters = $4, areas = $5, about = $6`,
    [o.id, o.name, o.sector, o.hq, o.areas, o.about],
  );
}
const png = fs.readFileSync("/home/claude/kb-tests/apercu/dentalys-logo.png");
await db.query(`INSERT INTO "OrganizationLogo" ("organizationId", data, "contentType", "updatedAt") VALUES ('demo-org-dentalys', $1, 'image/png', now()) ON CONFLICT ("organizationId") DO UPDATE SET data = $1`, [png]);
await db.query(`UPDATE "Organization" SET "logoUpdatedAt" = now() WHERE id = 'demo-org-dentalys'`);
console.log("organisations d'aperçu prêtes");
await db.end();
