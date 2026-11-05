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
import { missingSignedConventions } from "@/lib/project-documents";
import { eurToCents, str, unitsOrNull, UNITS_INVALID } from "@/lib/form";
import { notifyCompliance, notifyCounterAccepted, notifyExpertAnswer, notifyExpertCounter, notifyExpertNotice, notifyMessage, notifyNewProposal, notifySolicitations } from "@/lib/notifications";
import { signatureEnabled } from "@/lib/yousign";
import { engagementBlock, engagementGate } from "@/lib/billing";
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
    const fee = eurToCents(str(form, `fee_${id}`));
    const units = unitsOrNull(str(form, `units_${id}`));
    if (fee === null) return { error: t("Indiquez des honoraires pour chaque expert (0 si bénévole).") };
    if (units === undefined) return { error: UNITS_INVALID };
    experts.push({ practitionerId: id, feeCents: fee, days: units });
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
      createdById: user.id,
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
  // Un dossier au-delà des seuils d'autorisation ne peut pas passer par la déclaration simple ;
  // la voie « hors France » est réservée aux dossiers dont tous les experts exercent à l'étranger.
  const regime = projectRegime(complianceSettings(project.organization.complianceSettings), collabType(project.typeId)?.unit ?? "", project.experts.map((e) => ({ ...e, country: e.practitioner.country })))?.regime;
  if (key === "declaration" && (regime === "autorisation" || regime === "hors_france")) return;
  if (key === "ordre" && regime === "hors_france") return;
  if (key === "hors_france" && regime !== "hors_france") return;

  const note = str(form, "note");
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
  await db.project.update({
    where: { id: projectId },
    data: {
      status: t.to,
      ...(key === "block" || key === "validate" ? { complianceNote: note || null } : {}),
      ...(key === "abandon" ? { abandonNote: note } : {}),
      ...(key === "ordre" ? { ordreRef: note || null } : {}),
      ...(attest ? { signatureAttestedAt: new Date(), signatureAttestedById: user.id } : {}),
    },
  });
  // Les experts ayant donné leur accord suivent le statut du dossier.
  await db.projectExpert.updateMany({ where: { projectId, status: { notIn: ["DECLINE", "ATT_EXPERTS"] } }, data: { status: t.to } });
  if (key === "abandon") await db.projectExpert.updateMany({ where: { projectId, status: "ATT_EXPERTS" }, data: { status: "DECLINE" } });
  // Dossier signé (conventions déposées ou attestées) ou abandonné : plus aucune signature électronique en attente.
  if (key === "signed" || key === "abandon") await closeOpenSignatures({ projectId }, key === "signed" ? "dossier passé « Signé »" : "dossier abandonné");
  await audit(user.id, `project.${key}`, "Project", projectId, { from: project.status, to: t.to, note: note || undefined, ...(attest ? { attestation: "convention signée conservée hors KolBase" } : {}), ...(selfValidated ? { selfValidated: true } : {}) });
  // Proposition déclinée avec un motif : il rejoint les échanges avec l'expert (qui le lit dans sa sollicitation).
  if (key === "decline_proposal" && note && engagedIds[0]) await db.message.create({ data: { projectId, projectExpertId: engagedIds[0], authorId: user.id, body: note } });
  if (key === "submit" || key === "validate" || key === "block") notifyCompliance(projectId, key, user.id);
  for (const n of expertNotices(key, signatureEnabled())) {
    const ids = n.who === "engages" ? engagedIds : n.who === "sollicites" ? waitingIds : [...engagedIds, ...waitingIds];
    if (ids.length) notifyExpertNotice(ids, n.notice, key === "abandon" || key === "decline_proposal" ? note : null);
  }
  if (key === "accept_proposal" || key === "decline_proposal") revalidatePath("/propositions");
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  // Reprise après blocage ou retour en arrière : on arrive sur la modification du dossier.
  if (key === "revise" || key === "back_to_accord") {
    await syncProjectFromExperts(projectId);
    redirect(`/organisations/${orgId}/dossiers/${projectId}?modifier=1#modifier`);
  }
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
  const data = { title, therapeuticArea: str(form, "therapeuticArea") || null, description: str(form, "description") || null };
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => (project[k] ?? null) !== data[k]);
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
  const fee = eurToCents(str(form, "fee"));
  const units = unitsOrNull(str(form, "units"));
  if (fee === null) return { error: t("Indiquez des honoraires (0 si bénévole).") };
  if (units === undefined) return { error: UNITS_INVALID };
  const next = { feeCents: fee, days: units };
  if (!termsChanged(link, next)) return { ok: t("Conditions inchangées.") };
  await db.projectExpert.update({
    where: { id: link.id },
    // Honoraires changés : l'ancien montant est rappelé à l'expert (« 1 500 € → 1 800 € HT »).
    data: { ...next, status: "ATT_EXPERTS", respondedAt: null, responseNote: null, desiredFeeCents: null, previousFeeCents: link.feeCents !== fee ? link.feeCents : null },
  });
  await syncProjectFromExperts(projectId);
  await audit(user.id, "project.terms", "ProjectExpert", link.id, { projectId, from: { feeCents: link.feeCents, days: link.days }, to: next, previousStatus: link.status });
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
  const fee = eurToCents(str(form, "fee"));
  const units = unitsOrNull(str(form, "units"));
  if (fee === null) return { error: t("Indiquez des honoraires (0 si bénévole).") };
  if (units === undefined) return { error: UNITS_INVALID };
  const link = await db.projectExpert.create({ data: { projectId, practitionerId, feeCents: fee, days: units } });
  const message = str(form, "message");
  if (message) await db.message.create({ data: { projectId, projectExpertId: link.id, authorId: user.id, body: message } });
  await audit(user.id, "project.add_expert", "ProjectExpert", link.id, { projectId, feeCents: fee, days: units });
  notifySolicitations(projectId, "sollicitation", [link.id]);
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  return { ok: t("Expert ajouté : la sollicitation lui est envoyée.") };
}
