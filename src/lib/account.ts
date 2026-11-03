import "server-only";
import { db } from "@/lib/db";
import { SIGNED_STATUSES } from "@/lib/projects";
import { pointedPastEvents } from "@/lib/checkin";
import { isAbsent } from "@/lib/indicators";

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
          // Liens d'intérêts déclarés et notes d'honoraires établies (données de l'émetteur figées dans la note).
          declaredInterests: { select: { organization: true, nature: true, startYear: true, endYear: true, createdAt: true } },
          feeNotes: { select: { number: true, issuedAt: true, amountCents: true, vatBp: true, totalCents: true, data: true, organization: { select: { name: true } } }, orderBy: { issuedAt: "asc" } },
          projectLinks: { include: { project: { select: { title: true, typeId: true, status: true, organization: { select: { name: true } } } }, messages: { select: { body: true, createdAt: true, authorId: true } } } },
          applications: { include: { openCall: { select: { title: true, organization: { select: { name: true } }, event: { select: { title: true, startsAt: true } } } } } },
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
  const [links, past] = await Promise.all([
    // Conventions : signées seulement (une collaboration non signée n'a pas de convention à conserver).
    db.projectExpert.count({ where: { practitioner: { userId }, status: { in: SIGNED_STATUSES } } }),
    // Les inscriptions à venir non déclarées sont annulées à la suppression : seules comptent celles passées ou déclarées.
    db.registration.findMany({ where: { userId, benefits: { some: {} }, OR: [{ declared: true }, { event: { startsAt: { lte: new Date() } } }] }, select: { eventId: true, declared: true, checkedInAt: true } }),
  ]);
  // Un absent au pointage n'a pas consommé ses hospitalités : rien à déclarer, rien à conserver (sauf si déjà déclaré).
  const pointed = await pointedPastEvents(past.map((r) => r.eventId));
  const regs = past.filter((r) => r.declared || !isAbsent(r, pointed.has(r.eventId))).length;
  // Notes d'honoraires établies : pièces comptables des organisations, conservées telles qu'émises.
  const feeNotes = await db.feeNote.count({ where: { practitioner: { userId } } });
  return { conventions: links, hospitalities: regs, feeNotes, keep: links + regs > 0 };
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
 * Suppression du compte par anonymisation : connexion impossible, profil retiré, données personnelles effacées
 * (dont coordonnées de facturation : IBAN, adresse, SIRET, TVA, et liens d'intérêts déclarés).
 * Restent, si le compte en a, les éléments liés aux conventions et aux hospitalités déclarées (nom, profession,
 * RPPS, ville, structure de facturation), que les organisations doivent conserver ; les notes d'honoraires déjà
 * établies gardent les données figées à leur émission.
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
          db.declaredInterest.deleteMany({ where: { practitionerId: p.id } }),
          db.practitionerStructure.deleteMany({ where: { practitionerId: p.id, ...(keep ? { isPayee: false } : {}) } }),
          db.application.deleteMany({ where: { practitionerId: p.id, status: "pending" } }),
          db.projectExpert.updateMany({ where: { practitionerId: p.id, status: "ATT_EXPERTS" }, data: { status: "DECLINE", respondedAt: now, responseNote: "Compte supprimé" } }),
          db.practitionerProfile.update({
            where: { id: p.id },
            data: {
              listed: false, listedAt: null, bio: null, hospital: null, subspecialty: null, languages: [], interventionTypes: [], dayRateCents: null,
              orcid: null, orcidVerified: false, orcidSyncedAt: null, visibility: {}, responseDays: null,
              // Coordonnées de facturation : effacées (celles d'une note déjà établie y restent figées).
              iban: null, billingAddress: null, siret: null, vatNumber: null, vatRegime: "franchise",
              ...(keep ? {} : { rpps: null, rppsVerified: false, rppsCheckedAt: null, rppsCheckNote: null, city: null, specialty: null }),
            },
          }),
        ]
      : []),
    db.user.update({
      where: { id: userId },
      data: {
        email: `supprime-${userId}@kolbase.invalid`,
        passwordHash: null, totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [], unsubscribeToken: null, phone: null, notifyPrefs: {}, emailVerifiedAt: null, followsSeenAt: null,
        ...(keep ? {} : { firstName: "Compte", lastName: "supprimé" }),
      },
    }),
  ]);
  return { kept: keep };
}
