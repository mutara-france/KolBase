import "server-only";
import { db } from "@/lib/db";
import { ACCOUNT_DELETED, RECRUITING_STATUSES, SIGNED_STATUSES } from "@/lib/projects";
import { pointedPastEvents } from "@/lib/checkin";
import { isAbsent } from "@/lib/indicators";
import { drPrefix } from "@/lib/professions";
import { closeOpenSignatures } from "@/lib/signature";
import { notifyExpertRemoved } from "@/lib/notifications";
import type { ProjectStatus } from "@/generated/prisma/client";

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
          projectLinks: { include: { project: { select: { title: true, typeId: true, status: true, organization: { select: { name: true } } } }, messages: { select: { body: true, createdAt: true, authorId: true } }, expenses: { select: { category: true, label: true, date: true, amountCents: true, status: true, decisionNote: true, paidAt: true } }, travel: true, missions: { select: { date: true, label: true, units: true } } } },
          applications: { include: { openCall: { select: { title: true, organization: { select: { name: true } }, event: { select: { title: true, startsAt: true } } } } } },
          // Projets proposés aux organisations, avec la réponse de chacune.
          proposals: { include: { projects: { select: { status: true, createdAt: true, organization: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } },
          photo: { select: { data: true, updatedAt: true } },
        },
      },
      photo: { select: { data: true, updatedAt: true } },
      memberships: { select: { role: true, createdAt: true, organization: { select: { name: true, kind: true } } } },
      registrations: { include: { event: { select: { title: true, startsAt: true, organization: { select: { name: true } } } }, benefits: { include: { benefit: { select: { label: true } } } }, attendances: { select: { signedAt: true, method: true, session: { select: { startsAt: true, endsAt: true } } } } } },
      abstracts: { select: { title: true, authors: true, body: true, topic: true, format: true, status: true, decisionNote: true, createdAt: true, event: { select: { title: true } } } },
      follows: { select: { createdAt: true, practitioner: { select: { id: true } }, organization: { select: { name: true } } } },
      sessions: { select: { createdAt: true, expiresAt: true, userAgent: true } },
      auditLogs: { select: { action: true, entityType: true, entityId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 },
    },
  });
  // Photos (profil praticien, ou compte sans profil) : jointes telles que KolBase les conserve (grand format JPEG),
  // lisibles dans un navigateur.
  const image = (p: { data: Uint8Array; updatedAt: Date } | null | undefined) =>
    p ? { miseAJour: p.updatedAt, image: `data:image/jpeg;base64,${Buffer.from(p.data).toString("base64")}` } : null;
  const withPhoto = user ? { ...user, photo: image(user.photo) } : user;
  const compte = withPhoto?.practitioner ? { ...withPhoto, practitioner: { ...withPhoto.practitioner, photo: image(withPhoto.practitioner.photo) } } : withPhoto;
  return { exporte: new Date().toISOString(), source: "KolBase", compte };
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
 * RPPS, ville, structures au nom desquelles elles sont facturées), que les organisations doivent conserver ; les notes d'honoraires déjà
 * établies gardent les données figées à leur émission.
 */
export async function anonymizeAccount(userId: string) {
  const { keep } = await retentionReasons(userId);
  const p = await db.practitionerProfile.findUnique({ where: { userId }, include: { user: { select: { firstName: true, lastName: true } } } });
  const now = new Date();
  // Expert : retiré des dossiers non signés où il est engagé ou sollicité, et de ses candidatures en cours ou retenues.
  const removedLinks = p
    ? await db.projectExpert.findMany({
        where: { practitionerId: p.id, status: { not: "DECLINE" }, project: { status: { notIn: [...SIGNED_STATUSES, "DECLINE"] } } },
        select: { id: true, project: { select: { id: true, organizationId: true, createdById: true, title: true } } },
      })
    : [];
  const removedApps = p
    ? await db.application.findMany({ where: { practitionerId: p.id, status: { in: ["pending", "retained"] }, projectId: null }, select: { openCall: { select: { id: true, organizationId: true, createdById: true, title: true } } } })
    : [];
  const expert = p ? `${drPrefix(p.profession)}${p.user.firstName} ${p.user.lastName}` : null;
  await db.$transaction([
    db.session.deleteMany({ where: { userId } }),
    db.authToken.deleteMany({ where: { userId } }),
    db.follow.deleteMany({ where: { userId } }),
    // Communications non retenues (soumises, refusées, retirées) : effacées ; celles au programme restent.
    db.abstract.deleteMany({ where: { userId, status: { not: "accepted" } } }),
    db.membership.deleteMany({ where: { userId } }),
    db.projectLead.deleteMany({ where: { userId } }),
    db.userPhoto.deleteMany({ where: { userId } }),
    // Inscriptions à venir sans avantage déclaré : annulées.
    db.registration.deleteMany({ where: { userId, declared: false, event: { startsAt: { gt: now } } } }),
    ...(p
      ? [
          db.publication.deleteMany({ where: { practitionerId: p.id } }),
          db.practitionerPhoto.deleteMany({ where: { practitionerId: p.id } }),
          // Propositions : les copies reçues par les organisations restent leurs dossiers (texte envoyé).
          db.expertProposal.deleteMany({ where: { practitionerId: p.id } }),
          db.declaredInterest.deleteMany({ where: { practitionerId: p.id } }),
          // Structures : gardées celles au nom desquelles une convention est facturée (ou la structure par défaut,
          // qui facture les conventions sans choix), sans leurs coordonnées bancaires et fiscales.
          db.practitionerStructure.deleteMany({ where: { practitionerId: p.id, ...(keep ? { isPayee: false, billedLinks: { none: {} } } : {}) } }),
          db.practitionerStructure.updateMany({ where: { practitionerId: p.id }, data: { iban: null, billingAddress: null, siret: null, vatNumber: null, vatRegime: "franchise" } }),
          db.application.deleteMany({ where: { practitionerId: p.id, status: "pending" } }),
          db.application.updateMany({ where: { practitionerId: p.id, status: "retained" }, data: { status: "declined" } }),
          db.projectExpert.updateMany({ where: { practitionerId: p.id, status: "ATT_EXPERTS" }, data: { status: "DECLINE", respondedAt: now, responseNote: ACCOUNT_DELETED } }),
          db.projectExpert.updateMany({ where: { id: { in: removedLinks.map((l) => l.id) } }, data: { status: "DECLINE", respondedAt: now, responseNote: ACCOUNT_DELETED } }),
          db.practitionerProfile.update({
            where: { id: p.id },
            data: {
              listed: false, listedAt: null, bio: null, hospital: null, subspecialty: null, languages: [], interventionTypes: [], dayRateCents: null,
              orcid: null, orcidVerified: false, orcidSyncedAt: null, visibility: {}, responseDays: null, photoUpdatedAt: null, photoConsentAt: null,
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
        passwordHash: null, totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [], unsubscribeToken: null, phone: null, notifyPrefs: {}, emailVerifiedAt: null, followsSeenAt: null, photoUpdatedAt: null,
        ...(keep ? {} : { firstName: "Compte", lastName: "supprimé" }),
      },
    }),
  ]);
  if (expert && (removedLinks.length || removedApps.length)) {
    const projects = [];
    for (const l of removedLinks) {
      await closeOpenSignatures({ projectExpertId: l.id }, "compte de l'expert supprimé");
      projects.push({ ...l.project, outcome: await afterExpertRemoved(l.project.id) });
    }
    notifyExpertRemoved(expert, projects, removedApps.map((a) => a.openCall));
  }
  return { kept: keep };
}

/**
 * Dossier dont un expert vient d'être retiré : il ne reste pas soumettable (ni signable) sans expert engagé.
 * Recrutement en cours : le statut suit les réponses des autres experts. Au-delà, sans plus aucun expert engagé, le
 * dossier revient en attente des experts (on peut en solliciter un autre ou l'abandonner).
 */
async function afterExpertRemoved(projectId: string): Promise<"reopened" | "closed" | null> {
  const project = await db.project.findUnique({ where: { id: projectId }, include: { experts: { select: { status: true } } } });
  if (!project) return null;
  const statuses = project.experts.map((e) => e.status);
  const engaged = statuses.some((s) => s !== "DECLINE" && s !== "ATT_EXPERTS");
  let next: ProjectStatus = project.status;
  // Proposition de l'expert encore sans réponse : elle tombe avec son compte.
  if (project.status === "ATT_IND") next = "DECLINE";
  else if ((RECRUITING_STATUSES as string[]).includes(project.status)) next = statuses.every((s) => s === "DECLINE") ? "DECLINE" : engaged ? "ACCORD" : "ATT_EXPERTS";
  else if (!engaged) next = "ATT_EXPERTS";
  if (next === project.status) return null;
  await db.project.update({ where: { id: projectId }, data: { status: next } });
  await db.auditLog.create({ data: { actorId: null, action: "project.expert_removed", entityType: "Project", entityId: projectId, data: { from: project.status, to: next } } });
  return next === "DECLINE" ? "closed" : next === "ATT_EXPERTS" ? "reopened" : null;
}
