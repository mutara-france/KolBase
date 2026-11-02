/**
 * Retire toutes les données de démonstration (avant l'ouverture au public).
 * - Organisations dont l'identifiant commence par « demo- » ou dont tous les membres sont des comptes fictifs,
 *   et tout ce qui leur appartient (événements, dossiers, appels, devis, mandats, invitations, membres).
 * - Comptes en @demo.kolbase.local (praticiens fictifs) et leurs données.
 * Les comptes réels (DEMO_ADMIN_EMAILS, par exemple) sont conservés : ils perdent seulement leur accès aux organisations de démo.
 *
 * Usage : npm run db:purge-demo                 → aperçu, rien n'est supprimé
 *         npm run db:purge-demo -- --confirmer  → suppression
 * Pensez à mettre SEED_DEMO=0 dans Render avant, sinon le déploiement suivant recharge la démo.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const confirm = process.argv.includes("--confirmer");

async function main() {
  const users = (await db.user.findMany({ where: { email: { endsWith: "@demo.kolbase.local" } }, select: { id: true } })).map((u) => u.id);
  // Organisations de démo, et celles créées pendant la démo dont tous les membres sont des comptes fictifs.
  const orgs = (
    await db.organization.findMany({
      where: { OR: [{ id: { startsWith: "demo-" } }, { members: { some: { userId: { in: users } }, every: { userId: { in: users } } } }] },
      select: { id: true },
    })
  ).map((o) => o.id);
  const pracs = (await db.practitionerProfile.findMany({ where: { userId: { in: users } }, select: { id: true } })).map((p) => p.id);
  const inUsers = { in: users };
  const inOrgs = { in: orgs };
  const inPracs = { in: pracs };

  console.log(`Démo : ${orgs.length} organisations, ${users.length} comptes fictifs (${pracs.length} praticiens).`);
  if (!confirm) {
    console.log("Aperçu seulement : relancez avec --confirmer pour supprimer.");
    return;
  }

  const steps = await db.$transaction([
    db.auditLog.deleteMany({ where: { OR: [{ actorId: inUsers }, { entityId: { startsWith: "demo-" } }] } }),
    db.quote.deleteMany({ where: { OR: [{ supplierId: inOrgs }, { rfq: { organizationId: inOrgs } }] } }),
    db.rfqSupplier.deleteMany({ where: { OR: [{ supplierId: inOrgs }, { rfq: { organizationId: inOrgs } }] } }),
    db.rfq.deleteMany({ where: { OR: [{ organizationId: inOrgs }, { event: { organizationId: inOrgs } }] } }),
    db.registration.deleteMany({ where: { OR: [{ userId: inUsers }, { event: { organizationId: inOrgs } }] } }),
    db.speakerApplication.deleteMany({ where: { OR: [{ practitionerId: inPracs }, { event: { organizationId: inOrgs } }] } }),
    db.application.deleteMany({ where: { OR: [{ practitionerId: inPracs }, { openCall: { organizationId: inOrgs } }] } }),
    db.message.deleteMany({ where: { OR: [{ authorId: inUsers }, { project: { organizationId: inOrgs } }] } }),
    db.projectExpert.deleteMany({ where: { OR: [{ practitionerId: inPracs }, { project: { organizationId: inOrgs } }] } }),
    db.event.updateMany({ where: { agencyId: inOrgs }, data: { agencyId: null } }),
    db.event.deleteMany({ where: { organizationId: inOrgs } }),
    db.project.deleteMany({ where: { organizationId: inOrgs } }),
    db.openCall.deleteMany({ where: { organizationId: inOrgs } }),
    db.mandate.deleteMany({ where: { OR: [{ mandatorId: inOrgs }, { agencyId: inOrgs }] } }),
    db.invitation.deleteMany({ where: { OR: [{ organizationId: inOrgs }, { invitedById: inUsers }, { acceptedById: inUsers }] } }),
    db.membership.deleteMany({ where: { OR: [{ organizationId: inOrgs }, { userId: inUsers }] } }),
    db.organization.deleteMany({ where: { id: inOrgs } }),
    // Profils, publications, structures, sessions, suivis et jetons suivent (suppression en cascade).
    db.user.deleteMany({ where: { id: inUsers } }),
  ]);
  console.log(`Supprimé : ${steps.at(-2)?.count ?? 0} organisations, ${steps.at(-1)?.count ?? 0} comptes, ${steps[4].count} inscriptions, ${steps[11].count} dossiers.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
