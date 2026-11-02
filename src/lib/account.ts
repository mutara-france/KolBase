import "server-only";
import { db } from "@/lib/db";

/** Données personnelles d'un compte, au format JSON (droit d'accès et de portabilité, art. 15 et 20 RGPD). */
export async function exportAccount(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true, phone: true, locale: true, notifyPrefs: true, emailVerifiedAt: true, createdAt: true, updatedAt: true,
      practitioner: {
        include: {
          publications: true,
          structures: true,
          projectLinks: { include: { project: { select: { title: true, typeId: true, status: true, organization: { select: { name: true } } } }, messages: { select: { body: true, createdAt: true, authorId: true } } } },
          applications: { include: { openCall: { select: { title: true, organization: { select: { name: true } } } } } },
          speakerApplications: { include: { event: { select: { title: true, startsAt: true, organization: { select: { name: true } } } } } },
        },
      },
      memberships: { select: { role: true, createdAt: true, organization: { select: { name: true, kind: true } } } },
      registrations: { include: { event: { select: { title: true, startsAt: true, organization: { select: { name: true } } } }, benefits: { include: { benefit: { select: { label: true } } } } } },
      follows: { select: { createdAt: true, practitioner: { select: { id: true } }, organization: { select: { name: true } } } },
      sessions: { select: { createdAt: true, expiresAt: true, userAgent: true } },
      auditLogs: { select: { action: true, entityType: true, entityId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 },
    },
  });
  return { exporte: new Date().toISOString(), source: "KolBase", compte: user };
}

/** Le compte a-t-il des données à conserver au titre des obligations « anti-cadeaux » et Transparence Santé ? */
export async function retentionReasons(userId: string) {
  const [links, regs] = await Promise.all([
    db.projectExpert.count({ where: { practitioner: { userId }, status: { notIn: ["ATT_EXPERTS", "DECLINE"] } } }),
    // Les inscriptions à venir non déclarées sont annulées à la suppression : seules comptent celles passées ou déclarées.
    db.registration.count({ where: { userId, benefits: { some: {} }, OR: [{ declared: true }, { event: { startsAt: { lte: new Date() } } }] } }),
  ]);
  return { conventions: links, hospitalities: regs, keep: links + regs > 0 };
}

/** Organisations dont l'utilisateur est le seul administrateur alors que d'autres membres restent. */
export async function soleAdminOrgs(userId: string) {
  const admin = await db.membership.findMany({ where: { userId, role: "ADMIN" }, include: { organization: { select: { id: true, name: true } } } });
  const blocking: string[] = [];
  for (const m of admin) {
    const [admins, others] = await Promise.all([
      db.membership.count({ where: { organizationId: m.organizationId, role: "ADMIN" } }),
      db.membership.count({ where: { organizationId: m.organizationId, NOT: { userId } } }),
    ]);
    if (admins <= 1 && others > 0) blocking.push(m.organization.name);
  }
  return blocking;
}

/**
 * Suppression du compte par anonymisation : connexion impossible, profil retiré, données personnelles effacées.
 * Restent, si le compte en a, les éléments liés aux conventions et aux hospitalités déclarées (nom, profession,
 * RPPS, ville, structure de facturation), que les organisations doivent conserver.
 */
export async function anonymizeAccount(userId: string) {
  const { keep } = await retentionReasons(userId);
  const p = await db.practitionerProfile.findUnique({ where: { userId } });
  const now = new Date();
  await db.$transaction([
    db.session.deleteMany({ where: { userId } }),
    db.authToken.deleteMany({ where: { userId } }),
    db.follow.deleteMany({ where: { userId } }),
    db.membership.deleteMany({ where: { userId } }),
    // Inscriptions à venir sans avantage déclaré : annulées.
    db.registration.deleteMany({ where: { userId, declared: false, event: { startsAt: { gt: now } } } }),
    ...(p
      ? [
          db.publication.deleteMany({ where: { practitionerId: p.id } }),
          db.practitionerStructure.deleteMany({ where: { practitionerId: p.id, ...(keep ? { isPayee: false } : {}) } }),
          db.application.deleteMany({ where: { practitionerId: p.id, status: "pending" } }),
          db.speakerApplication.deleteMany({ where: { practitionerId: p.id, status: "pending" } }),
          db.projectExpert.updateMany({ where: { practitionerId: p.id, status: "ATT_EXPERTS" }, data: { status: "DECLINE", respondedAt: now, responseNote: "Compte supprimé" } }),
          db.practitionerProfile.update({
            where: { id: p.id },
            data: {
              listed: false, listedAt: null, bio: null, hospital: null, subspecialty: null, languages: [], interventionTypes: [], dayRateCents: null,
              orcid: null, orcidVerified: false, orcidSyncedAt: null, visibility: {}, responseDays: null,
              ...(keep ? {} : { rpps: null, rppsVerified: false, rppsCheckedAt: null, rppsCheckNote: null, city: null, specialty: null }),
            },
          }),
        ]
      : []),
    db.user.update({
      where: { id: userId },
      data: {
        email: `supprime-${userId}@kolbase.invalid`,
        passwordHash: null, phone: null, notifyPrefs: {}, emailVerifiedAt: null, followsSeenAt: null,
        ...(keep ? {} : { firstName: "Compte", lastName: "supprimé" }),
      },
    }),
  ]);
  return { kept: keep };
}
