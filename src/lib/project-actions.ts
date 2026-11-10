"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { isVerifiedOrg, notVerified, requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { collabType, expertNotices, PROJECT_ROLES, projectEditable, RECRUITING_STATUSES, recruitmentOpen, SOURCING_ROLES, PROJECT_VIEW_ROLES, termsChanged, TRANSITIONS, type TransitionKey } from "@/lib/projects";
import { storageEnabled } from "@/lib/storage";
import { fourEyes, projectAuthors } from "@/lib/four-eyes";
import type { ProjectStatus } from "@/generated/prisma/client";
import { complianceSettings, projectRegime } from "@/lib/compliance";
import { missingCumulAuthorizations, missingSignedConventions } from "@/lib/project-documents";
import { frameworkPeriodError, frameworkStart } from "@/lib/expert-costs";
import { dayOrNull, eurToCents, str } from "@/lib/form";
import { readFeeFields } from "@/lib/fee-fields";
import { hoursOf } from "@/lib/fees";
import { notifyCompliance, notifyCounterAccepted, notifyExpertAnswer, notifyExpertCounter, notifyExpertNotice, notifyMessage, notifyNewProposal, notifyProjectLead, notifySolicitations } from "@/lib/notifications";
import { signatureEnabled } from "@/lib/yousign";
import { engagementBlock, engagementGate } from "@/lib/billing";
import { freezeBilling } from "@/lib/expert-billing";
import { plannedDate } from "@/lib/deadlines";
import type { GateLink } from "@/lib/billing-plans";
import { getT } from "@/lib/i18n/server";
import { closeOpenSignatures } from "@/lib/signature";
import { hasMemberRole } from "@/lib/org-roles";

export type ActionState = { error?: string; ok?: string; fix?: GateLink } | undefined;

export async function createProject(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, SOURCING_ROLES);
  if (!isVerifiedOrg(org)) return { error: t(notVerified(org)) };
  const gate = await engagementGate(orgId, "sollicitation");
  if (gate) return gate;
  const title = str(form, "title");
  const typeId = str(form, "typeId");
  if (!title) return { error: t("Le titre est obligatoire.") };
  if (!collabType(typeId)) return { error: t("Type de collaboration invalide.") };

  const expertIds = [...new Set(form.getAll("expertId").map(String).filter(Boolean))];
  if (expertIds.length === 0) return { error: t("Sélectionnez au moins un expert.") };
  const listed = await db.practitionerProfile.findMany({ where: { id: { in: expertIds }, listed: true }, select: { id: true } });
  if (listed.length !== expertIds.length) return { error: t("Un des experts sélectionnés n'est plus référencé.") };

  const experts = [];
  for (const id of expertIds) {
    const read = await readFeeFields(form, orgId, `_${id}`);
    if ("error" in read) return { error: t(read.error === "Indiquez des honoraires (0 si bénévole)." ? "Indiquez des honoraires pour chaque expert (0 si bénévole)." : read.error) };
    experts.push({ practitionerId: id, ...read.data });
  }

  const message = str(form, "message");
  const project = await db.project.create({
    data: {
      organizationId: orgId,
      title,
      typeId,
      therapeuticArea: str(form, "therapeuticArea") || null,
      description: str(form, "description") || null,
      origin: "Sollicitation directe",
      plannedAt: dayOrNull(str(form, "plannedAt")) ?? null,
      createdById: user.id,
      leads: { create: { userId: user.id } },
      experts: { create: experts },
    },
    include: { experts: true },
  });
  if (message) {
    await db.message.createMany({
      data: project.experts.map((e) => ({ projectId: project.id, projectExpertId: e.id, authorId: user.id, body: message })),
    });
  }
  await audit(user.id, "project.create", "Project", project.id, { experts: expertIds.length });
  notifySolicitations(project.id);
  redirect(`/organisations/${orgId}/dossiers/${project.id}`);
}

/** Recalcule le statut du dossier à partir des réponses des experts (phase de sollicitation). */
async function syncProjectFromExperts(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: { experts: true } });
  if (!project || !["ATT_EXPERTS", "ACCORD"].includes(project.status)) return;
  const statuses = project.experts.map((e) => e.status);
  let next: ProjectStatus = project.status;
  if (statuses.every((s) => s === "DECLINE")) next = "DECLINE";
  else if (statuses.some((s) => s === "ACCORD")) next = "ACCORD";
  else next = "ATT_EXPERTS";
  if (next !== project.status) await db.project.update({ where: { id: projectId }, data: { status: next } });
}

/**
 * Réponse du praticien à une sollicitation : accepter (accord de principe), proposer d'autres honoraires (la
 * sollicitation reste ouverte, l'organisation accepte ce montant ou renvoie une proposition) ou décliner.
 */
export async function respondToSolicitation(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const linkId = str(form, "linkId");
  const answer = str(form, "answer");
  const { t } = await getT();
  const link = await db.projectExpert.findFirst({ where: { id: linkId, practitioner: { userId: user.id } }, include: { project: true } });
  if (!link) return { error: t("Sollicitation introuvable.") };
  if (link.status !== "ATT_EXPERTS") return { error: t("Vous avez déjà répondu.") };
  if (link.project.status === "DECLINE") return { error: t("Ce dossier a été abandonné par l'organisation.") };
  if (!recruitmentOpen(link.project.status)) return { error: t("Le recrutement de ce dossier est clos : l'organisation doit vous solliciter de nouveau.") };
  if (!["accept", "counter", "decline"].includes(answer)) return { error: t("Réponse invalide.") };
  // Autres honoraires : obligatoires pour « Proposer d'autres honoraires », sans objet pour accepter ou décliner.
  const desiredRaw = str(form, "desiredFee");
  if (answer !== "counter" && desiredRaw)
    return { error: t("Vous avez indiqué d'autres honoraires : choisissez « Proposer d'autres honoraires », ou videz le montant pour accepter ou décliner.") };
  if (answer === "counter") return counterOffer(link, desiredRaw, str(form, "note"), user.id);
  const status: ProjectStatus = answer === "accept" ? "ACCORD" : "DECLINE";
  // Réponse prise en compte seulement si la sollicitation est toujours ouverte (double envoi, dossier avancé entre-temps).
  // Accepter vaut pour les honoraires proposés : une contre-proposition antérieure de l'expert tombe.
  const { count } = await db.projectExpert.updateMany({
    where: { id: link.id, status: "ATT_EXPERTS", project: { status: { in: RECRUITING_STATUSES } } },
    data: { status, responseNote: str(form, "note") || null, respondedAt: new Date(), desiredFeeCents: null },
  });
  if (count === 0) return { error: t("Vous avez déjà répondu.") };
  if (str(form, "note")) {
    await db.message.create({ data: { projectId: link.projectId, projectExpertId: link.id, authorId: user.id, body: str(form, "note") } });
  }
  await syncProjectFromExperts(link.projectId);
  // Candidature retenue puis honoraires refusés : la place d'intervenant (ou la candidature) est libérée.
  if (status === "DECLINE") {
    await db.application.updateMany({ where: { projectId: link.projectId, practitionerId: link.practitionerId, status: "retained" }, data: { status: "declined" } });
  }
  await audit(user.id, answer === "accept" ? "solicitation.accept" : "solicitation.decline", "ProjectExpert", link.id, { projectId: link.projectId });
  notifyExpertAnswer(link.id, answer === "accept");
  revalidatePath(`/sollicitations/${link.id}`);
  return { ok: answer === "accept" ? t("Accord de principe envoyé. L'organisation va préparer la convention.") : t("Sollicitation déclinée.") };
}

/** Contre-proposition de l'expert : la sollicitation reste ouverte (le dossier ne passe pas en « Décliné »). */
async function counterOffer(link: { id: string; projectId: string; feeCents: number | null }, raw: string, note: string, userId: string): Promise<ActionState> {
  const { t } = await getT();
  const desiredFeeCents = raw ? eurToCents(raw, { allowZero: false }) : null;
  if (!desiredFeeCents) return { error: t("Indiquez les honoraires que vous proposez (montant total HT).") };
  if (desiredFeeCents === link.feeCents) return { error: t("Ce sont les honoraires déjà proposés : choisissez « Donner mon accord de principe ».") };
  const { count } = await db.projectExpert.updateMany({
    where: { id: link.id, status: "ATT_EXPERTS", project: { status: { in: RECRUITING_STATUSES } } },
    data: { desiredFeeCents, responseNote: note || null, respondedAt: new Date() },
  });
  if (count === 0) return { error: t("Vous avez déjà répondu.") };
  if (note) await db.message.create({ data: { projectId: link.projectId, projectExpertId: link.id, authorId: userId, body: note } });
  await audit(userId, "solicitation.counter", "ProjectExpert", link.id, { projectId: link.projectId, feeCents: link.feeCents, desiredFeeCents });
  notifyExpertCounter(link.id);
  revalidatePath(`/sollicitations/${link.id}`);
  return { ok: t("Proposition envoyée : la sollicitation reste ouverte. L'organisation peut accepter ces honoraires ou vous renvoyer une proposition.") };
}

/** L'organisation accepte les honoraires proposés par l'expert : ils deviennent les honoraires du dossier, l'expert est engagé. */
export async function acceptCounterOffer(form: FormData) {
  const orgId = str(form, "orgId");
  const projectId = str(form, "projectId");
  const { user, project } = await editableProject(orgId, projectId);
  if (!project) return;
  const link = await db.projectExpert.findFirst({ where: { id: str(form, "linkId"), projectId, status: "ATT_EXPERTS", desiredFeeCents: { not: null } } });
  if (!link?.desiredFeeCents) return;
  const { count } = await db.projectExpert.updateMany({
    where: { id: link.id, status: "ATT_EXPERTS", desiredFeeCents: link.desiredFeeCents },
    data: { feeCents: link.desiredFeeCents, previousFeeCents: link.feeCents, desiredFeeCents: null, status: "ACCORD", respondedAt: new Date() },
  });
  if (!count) return;
  await syncProjectFromExperts(projectId);
  await audit(user.id, "project.accept_counter", "ProjectExpert", link.id, { projectId, from: link.feeCents, to: link.desiredFeeCents });
  notifyCounterAccepted(link.id);
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
}

/** Message dans le fil organisation ↔ expert. Accessible aux deux parties. */
export async function postMessage(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const linkId = str(form, "linkId");
  const body = str(form, "body");
  const { t } = await getT();
  if (!body) return { error: t("Message vide.") };
  if (body.length > 5000) return { error: t("Message trop long.") };
  const link = await db.projectExpert.findUnique({ where: { id: linkId }, include: { project: true, practitioner: true } });
  if (!link) return { error: t("Fil introuvable.") };
  const isExpert = link.practitioner.userId === user.id;
  const isOrg = hasMemberRole(user, link.project.organizationId, PROJECT_VIEW_ROLES);
  if (!isExpert && !isOrg) return { error: t("Accès refusé.") };
  await db.message.create({ data: { projectId: link.projectId, projectExpertId: link.id, authorId: user.id, body } });
  notifyMessage(link.id, user.id);
  revalidatePath(`/sollicitations/${link.id}`);
  revalidatePath(`/organisations/${link.project.organizationId}/dossiers/${link.projectId}`);
  return { ok: t("Message envoyé.") };
}

/** Fait avancer le dossier dans le circuit réglementaire. */
export async function advanceProject(form: FormData) {
  const orgId = str(form, "orgId");
  const projectId = str(form, "projectId");
  const key = str(form, "transition") as TransitionKey;
  const t = TRANSITIONS[key];
  if (!t) return;
  const { user } = await requireMembership(orgId, t.roles === "compliance" ? COMPLIANCE_ROLES : PROJECT_ROLES);
  const project = await db.project.findFirst({ where: { id: projectId, organizationId: orgId }, include: { experts: { include: { practitioner: { select: { country: true } } } }, organization: { select: { complianceSettings: true } } } });
  if (!project || !(t.from as readonly string[]).includes(project.status)) return;
  // Convention signée : chaque expert engagé doit avoir une convention signée déposée ou une signature électronique
  // achevée. Sans stockage de documents, seule une attestation explicite (nominative, datée) en tient lieu.
  let attest = false;
  if (key === "signed" && (await missingSignedConventions(projectId)).length > 0) {
    if (storageEnabled() || form.get("attest") !== "1") return;
    attest = true;
  }
  // Déclaration ou demande d'autorisation à l'Ordre : l'autorisation de cumul de chaque expert agent public est jointe.
  // Sans stockage de documents, une attestation explicite (conservée hors KolBase) en tient lieu.
  let attestCumul = false;
  if ((key === "declaration" || key === "ordre") && (await missingCumulAuthorizations(projectId)).length > 0) {
    if (storageEnabled() || form.get("attestCumul") !== "1") return;
    attestCumul = true;
  }
  // Un dossier au-delà des seuils d'autorisation ne peut pas passer par la déclaration simple ;
  // la voie « hors France » est réservée aux dossiers dont tous les experts exercent à l'étranger.
  const regime = projectRegime(complianceSettings(project.organization.complianceSettings), collabType(project.typeId)?.unit ?? "", project.experts.map((e) => ({ ...e, country: e.practitioner.country })))?.regime;
  if (key === "declaration" && (regime === "autorisation" || regime === "hors_france")) return;
  if (key === "ordre" && regime === "hors_france") return;
  if (key === "hors_france" && regime !== "hors_france") return;

  const note = str(form, "note");
  // Soumission à la conformité : la date d'intervention (ou un événement daté) est requise, sinon ni l'échéance EPS
  // ni le délai d'examen ne peuvent être calculés ; le dossier reste en accord de principe et la page l'explique.
  if (key === "submit" && !plannedDate({ plannedAt: project.plannedAt, events: await db.event.findMany({ where: { projectId, cancelledAt: null }, select: { startsAt: true, cancelledAt: true } }) })) {
    redirect(`/organisations/${orgId}/dossiers/${projectId}?soumission=date`);
  }
  // Abandon : le motif est obligatoire (il figure dans l'historique du dossier).
  if (key === "abandon" && !note) return;
  // Accepter la proposition d'un expert l'engage : organisation validée, contrat de sous-traitance, abonnement.
  if (key === "accept_proposal" && (await engagementBlock(orgId, "proposition"))) return;
  // Retour en accord de principe : impossible si une convention est en cours de signature ou déjà signée
  // (l'expert signerait des conditions qui vont changer).
  if (key === "back_to_accord" && (await signaturesStarted(projectId))) return;
  // Validation par la conformité : contrôle à quatre yeux (pas d'auto-validation, sauf seul habilité et justification).
  let selfValidated = false;
  if (key === "validate") {
    const rule = await fourEyes(await projectAuthors(projectId), orgId, user.id, COMPLIANCE_ROLES);
    if (rule === "blocked" || (rule === "justify" && !note)) return;
    selfValidated = rule === "justify";
  }
  // Experts à prévenir, d'après leur situation avant le changement d'étape.
  const engagedIds = project.experts.filter((e) => e.status !== "DECLINE" && e.status !== "ATT_EXPERTS").map((e) => e.id);
  const waitingIds = project.experts.filter((e) => e.status === "ATT_EXPERTS").map((e) => e.id);
  const auditData = { from: project.status, to: t.to, note: note || undefined, ...(attest ? { attestation: "convention signée conservée hors KolBase" } : {}), ...(attestCumul ? { attestationCumul: "autorisation de cumul conservée hors KolBase" } : {}), ...(selfValidated ? { selfValidated: true } : {}) };
  // Changement d'étape, experts qui le suivent et trace d'audit : tout ou rien (un état sans trace, ou l'inverse, fausserait l'historique).
  await db.$transaction(async (tx) => {
  await tx.project.update({
    where: { id: projectId },
    data: {
      status: t.to,
      ...(key === "block" || key === "validate" ? { complianceNote: note || null } : {}),
      ...(key === "abandon" ? { abandonNote: note } : {}),
      // Démarche EPS : date (et référence) de la déclaration, date de la demande à l'Ordre — preuve du respect des délais.
      ...(key === "ordre" ? { ordreRef: note || null, ordreRequestedAt: new Date() } : {}),
      ...(key === "declaration" ? { epsDeclaredAt: new Date(), epsRef: note || null } : {}),
      ...(attest ? { signatureAttestedAt: new Date(), signatureAttestedById: user.id } : {}),
      // Soumission à la conformité : point de départ du délai d'examen (relance si elle est dépassée).
      ...(key === "submit" ? { submittedAt: new Date(), reviewReminderAt: null } : {}),
    },
  });
  // Les experts ayant donné leur accord suivent le statut du dossier.
  await tx.projectExpert.updateMany({ where: { projectId, status: { notIn: ["DECLINE", "ATT_EXPERTS"] } }, data: { status: t.to } });
  if (key === "abandon") await tx.projectExpert.updateMany({ where: { projectId, status: "ATT_EXPERTS" }, data: { status: "DECLINE" } });
  await tx.auditLog.create({ data: { actorId: user.id, action: `project.${key}`, entityType: "Project", entityId: projectId, data: auditData } });
  });
  // Dossier sans responsable (projet proposé par un expert) : qui, dans l'équipe Projets, le fait avancer en devient responsable.
  if (t.roles !== "compliance" && key !== "decline_proposal" && key !== "abandon") await claimIfUnassigned(projectId, user.id);
  // Soumission à la conformité : la facturation de chaque expert (nom propre ou structure) est figée.
  if (key === "submit") await freezeBilling(projectId);
  // Dossier signé (conventions déposées ou attestées) ou abandonné : plus aucune signature électronique en attente.
  if (key === "signed" || key === "abandon") await closeOpenSignatures({ projectId }, key === "signed" ? "dossier passé « Signé »" : "dossier abandonné");
  // Proposition déclinée avec un motif : il rejoint les échanges avec l'expert (qui le lit dans sa sollicitation).
  if (key === "decline_proposal" && note && engagedIds[0]) await db.message.create({ data: { projectId, projectExpertId: engagedIds[0], authorId: user.id, body: note } });
  if (key === "submit" || key === "validate" || key === "block") notifyCompliance(projectId, key, user.id);
  // Dossier validé : la conformité a examiné ses événements (lieu, date, programme, hospitalités) avec lui.
  if (key === "validate") {
    const evs = await db.event.findMany({ where: { projectId, internal: false, cancelledAt: null, OR: [{ reviewStatus: null }, { reviewStatus: { not: "approved" } }] }, select: { id: true } });
    if (evs.length) {
      await db.event.updateMany({ where: { id: { in: evs.map((e) => e.id) } }, data: { reviewStatus: "approved", reviewedAt: new Date(), reviewedById: user.id, reviewNote: null, reviewChanges: [] } });
      for (const e of evs) await audit(user.id, "event.review_approve", "Event", e.id, { withProject: projectId });
    }
  }
  for (const n of expertNotices(key, signatureEnabled())) {
    const ids = n.who === "engages" ? engagedIds : n.who === "sollicites" ? waitingIds : [...engagedIds, ...waitingIds];
    if (ids.length) notifyExpertNotice(ids, n.notice, key === "abandon" || key === "decline_proposal" ? note : null);
  }
  if (key === "accept_proposal" || key === "decline_proposal") revalidatePath("/propositions");
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  // Reprise après blocage ou retour en arrière : on arrive sur la modification du dossier.
  if (key === "revise" || key === "back_to_accord") {
    await syncProjectFromExperts(projectId);
    redirect(`/organisations/${orgId}/dossiers/${projectId}?onglet=experts&modifier=1#modifier`);
  }
}

/** Désigne la personne responsable d'un dossier qui n'en a aucun. */
async function claimIfUnassigned(projectId: string, userId: string) {
  if ((await db.projectLead.count({ where: { projectId } })) > 0) return;
  const created = await db.projectLead.create({ data: { projectId, userId }, include: { user: { select: { firstName: true, lastName: true } } } }).catch(() => null);
  if (created) await audit(userId, "project.lead_add", "Project", projectId, { userId, name: `${created.user.firstName} ${created.user.lastName}`, auto: true });
}

// ─── Responsables du dossier ───────────────────────────────────────────────

/**
 * Ajoute un responsable (un ou plusieurs par dossier) : membre Administrateur ou Projets de l'organisation. Il voit
 * le dossier dans « Mes dossiers » et reçoit ses e-mails. Toute l'équipe Projets garde l'accès au dossier.
 */
/**
 * Validation en série des dossiers sans drapeau depuis la file de la conformité : chaque dossier passe par
 * advanceProject (mêmes contrôles, dont les quatre yeux : un dossier soumis par le valideur est laissé de côté),
 * puis retour à la file avec le décompte.
 */
export async function validateProjectsInBulk(form: FormData) {
  const orgId = str(form, "orgId");
  await requireMembership(orgId, COMPLIANCE_ROLES);
  const ids = form.getAll("projectId").map(String).filter(Boolean).slice(0, 50);
  let done = 0;
  for (const projectId of ids) {
    const before = await db.project.findFirst({ where: { id: projectId, organizationId: orgId, status: "EN_VALID" }, select: { id: true } });
    if (!before) continue;
    const fd = new FormData();
    fd.set("orgId", orgId); fd.set("projectId", projectId); fd.set("transition", "validate");
    await advanceProject(fd);
    if ((await db.project.findUnique({ where: { id: projectId }, select: { status: true } }))?.status === "VALIDE") done++;
  }
  redirect(`/organisations/${orgId}/conformite?valides=${done}&sur=${ids.length}`);
}

export async function addProjectLead(form: FormData) {
  const orgId = str(form, "orgId");
  const projectId = str(form, "projectId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const userId = str(form, "userId") || user.id;
  const [project, eligible] = await Promise.all([
    db.project.findFirst({ where: { id: projectId, organizationId: orgId }, select: { id: true } }),
    db.membership.findFirst({ where: { organizationId: orgId, userId, role: { in: PROJECT_ROLES } }, select: { user: { select: { firstName: true, lastName: true } } } }),
  ]);
  if (!project || !eligible) return;
  const added = await db.projectLead.create({ data: { projectId, userId } }).then(() => true, () => false);
  if (!added) return;
  await audit(user.id, "project.lead_add", "Project", projectId, { userId, name: `${eligible.user.firstName} ${eligible.user.lastName}` });
  notifyProjectLead(projectId, userId, user.id);
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
}

/** Retire un responsable. Sans responsable, les e-mails du dossier vont à toute l'équipe Projets. */
export async function removeProjectLead(form: FormData) {
  const orgId = str(form, "orgId");
  const projectId = str(form, "projectId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const userId = str(form, "userId");
  const lead = await db.projectLead.findFirst({ where: { projectId, userId, project: { organizationId: orgId } }, include: { user: { select: { firstName: true, lastName: true } } } });
  if (!lead) return;
  await db.projectLead.deleteMany({ where: { projectId, userId } });
  await audit(user.id, "project.lead_remove", "Project", projectId, { userId, name: `${lead.user.firstName} ${lead.user.lastName}` });
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
}

/** Une convention du dossier est-elle en cours de signature, signée électroniquement ou déposée signée ? */
async function signaturesStarted(projectId: string) {
  const [sig, doc] = await Promise.all([
    db.conventionSignature.count({ where: { projectExpert: { projectId }, status: { in: ["ongoing", "done"] } } }),
    db.document.count({ where: { projectId, kind: "CONVENTION_SIGNEE" } }),
  ]);
  return sig + doc > 0;
}

// ─── Modification du dossier (avant la signature) ──────────────────────────

/** Dossier de l'organisation, modifiable par l'équipe Projets (recrutement en cours). */
async function editableProject(orgId: string, projectId: string) {
  const { t } = await getT();
  const ctx = await requireMembership(orgId, PROJECT_ROLES);
  const project = await db.project.findFirst({ where: { id: projectId, organizationId: orgId } });
  if (!project) return { ...ctx, project: null, error: t("Dossier introuvable.") };
  if (!projectEditable(project.status))
    return { ...ctx, project: null, error: t("Ce dossier n'est plus modifiable à cette étape : remettez-le d'abord en accord de principe.") };
  return { ...ctx, project, error: null };
}

/** Objet du dossier : titre, domaine, objet et déroulé. */
export async function updateProjectObject(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const projectId = str(form, "projectId");
  const { user, project, error } = await editableProject(orgId, projectId);
  if (!project) return { error: error ?? "Dossier introuvable." };
  const title = str(form, "title");
  if (!title) return { error: t("Le titre est obligatoire.") };
  const plannedAt = dayOrNull(str(form, "plannedAt"));
  if (plannedAt === undefined) return { error: t("Date d'intervention invalide.") };
  // Contrat-cadre : plusieurs prestations de même nature, jusqu'à la fin de période (douze mois au plus).
  const framework = form.get("framework") === "on";
  const periodEnd = framework ? dayOrNull(str(form, "periodEnd")) : null;
  if (periodEnd === undefined) return { error: t("Date de fin de période invalide.") };
  if (framework) {
    const err = frameworkPeriodError(frameworkStart({ plannedAt, createdAt: project.createdAt }), periodEnd);
    if (err) return { error: t(err) };
  }
  const data = { title, therapeuticArea: str(form, "therapeuticArea") || null, description: str(form, "description") || null, plannedAt, framework, periodEnd };
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => String(project[k] ?? null) !== String(data[k] ?? null));
  if (changed.length === 0) return { ok: t("Aucune modification.") };
  await db.project.update({ where: { id: projectId }, data });
  await audit(user.id, "project.edit", "Project", projectId, { fields: changed });
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  return { ok: t("Objet du dossier enregistré.") };
}

/**
 * Conditions d'un expert (unités, honoraires). Modifiées : la proposition lui est renvoyée (réponse à nouveau
 * attendue, e-mail « Nouvelle proposition »), et le statut du dossier suit les réponses des experts.
 */
export async function updateExpertTerms(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const projectId = str(form, "projectId");
  const { user, project, error } = await editableProject(orgId, projectId);
  if (!project) return { error: error ?? "Dossier introuvable." };
  const link = await db.projectExpert.findFirst({ where: { id: str(form, "linkId"), projectId } });
  if (!link) return { error: t("Expert introuvable dans ce dossier.") };
  const read = await readFeeFields(form, orgId);
  if ("error" in read) return { error: t(read.error) };
  const next = read.data;
  const fee = next.feeCents;
  if (!termsChanged(link, next)) return { ok: t("Conditions inchangées.") };
  await db.projectExpert.update({
    where: { id: link.id },
    // Honoraires changés : l'ancien montant est rappelé à l'expert (« 1 500 € → 1 800 € HT »).
    data: { ...next, status: "ATT_EXPERTS", respondedAt: null, responseNote: null, desiredFeeCents: null, previousFeeCents: link.feeCents !== fee ? link.feeCents : null },
  });
  await syncProjectFromExperts(projectId);
  await audit(user.id, "project.terms", "ProjectExpert", link.id, { projectId, from: { feeCents: link.feeCents, days: link.days, hours: hoursOf(link), hourlyCents: link.hourlyCents }, to: { feeCents: next.feeCents, days: next.days, hours: hoursOf(next), hourlyCents: next.hourlyCents }, previousStatus: link.status });
  notifyNewProposal(link.id);
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  return { ok: t("Nouvelle proposition envoyée à l'expert : sa réponse est de nouveau attendue.") };
}

/** Ajouter un expert au dossier : il reçoit la sollicitation comme les premiers experts. */
export async function addProjectExpert(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const projectId = str(form, "projectId");
  const { user, org, project, error } = await editableProject(orgId, projectId);
  if (!project) return { error: error ?? "Dossier introuvable." };
  if (!isVerifiedOrg(org)) return { error: t(notVerified(org)) };
  const gate = await engagementGate(orgId, "sollicitation", projectId);
  if (gate) return gate;
  const practitionerId = str(form, "expertId");
  const expert = await db.practitionerProfile.findFirst({ where: { id: practitionerId, listed: true }, select: { id: true } });
  if (!expert) return { error: t("Choisissez un expert référencé.") };
  if (await db.projectExpert.findUnique({ where: { projectId_practitionerId: { projectId, practitionerId } } })) return { error: t("Cet expert est déjà sollicité dans ce dossier.") };
  const read = await readFeeFields(form, orgId);
  if ("error" in read) return { error: t(read.error) };
  const { feeCents: fee, days: units } = read.data;
  const link = await db.projectExpert.create({ data: { projectId, practitionerId, ...read.data } });
  const message = str(form, "message");
  if (message) await db.message.create({ data: { projectId, projectExpertId: link.id, authorId: user.id, body: message } });
  await audit(user.id, "project.add_expert", "ProjectExpert", link.id, { projectId, feeCents: fee, days: units });
  notifySolicitations(projectId, "sollicitation", [link.id]);
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  return { ok: t("Expert ajouté : la sollicitation lui est envoyée.") };
}
