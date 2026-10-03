"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { collabType, PROJECT_ROLES, PROJECT_VIEW_ROLES, TRANSITIONS, type TransitionKey } from "@/lib/projects";
import type { ProjectStatus } from "@/generated/prisma/client";

export type ActionState = { error?: string; ok?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const eurToCents = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return v && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export async function createProject(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const title = str(form, "title");
  const typeId = str(form, "typeId");
  if (!title) return { error: "Le titre est obligatoire." };
  if (!collabType(typeId)) return { error: "Type de collaboration invalide." };

  const expertIds = [...new Set(form.getAll("expertId").map(String).filter(Boolean))];
  if (expertIds.length === 0) return { error: "Sélectionnez au moins un expert." };
  const listed = await db.practitionerProfile.findMany({ where: { id: { in: expertIds }, listed: true }, select: { id: true } });
  if (listed.length !== expertIds.length) return { error: "Un des experts sélectionnés n'est plus référencé." };

  const experts = [];
  for (const id of expertIds) {
    const fee = eurToCents(str(form, `fee_${id}`));
    const units = Number(str(form, `units_${id}`).replace(",", ".")) || null;
    if (fee === null) return { error: "Indiquez des honoraires pour chaque expert (0 si bénévole)." };
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

/** Réponse du praticien à une sollicitation. */
export async function respondToSolicitation(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const linkId = str(form, "linkId");
  const answer = str(form, "answer");
  const link = await db.projectExpert.findFirst({ where: { id: linkId, practitioner: { userId: user.id } }, include: { project: true } });
  if (!link) return { error: "Sollicitation introuvable." };
  if (link.status !== "ATT_EXPERTS") return { error: "Vous avez déjà répondu." };
  if (link.project.status === "DECLINE") return { error: "Ce dossier a été abandonné par l'organisation." };
  if (!["accept", "decline"].includes(answer)) return { error: "Réponse invalide." };
  const status: ProjectStatus = answer === "accept" ? "ACCORD" : "DECLINE";
  await db.projectExpert.update({ where: { id: link.id }, data: { status, responseNote: str(form, "note") || null, respondedAt: new Date() } });
  if (str(form, "note")) {
    await db.message.create({ data: { projectId: link.projectId, projectExpertId: link.id, authorId: user.id, body: str(form, "note") } });
  }
  await syncProjectFromExperts(link.projectId);
  await audit(user.id, answer === "accept" ? "solicitation.accept" : "solicitation.decline", "ProjectExpert", link.id, { projectId: link.projectId });
  revalidatePath(`/sollicitations/${link.id}`);
  return { ok: answer === "accept" ? "Accord de principe envoyé. L'organisation va préparer la convention." : "Sollicitation déclinée." };
}

/** Message dans le fil organisation ↔ expert. Accessible aux deux parties. */
export async function postMessage(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const linkId = str(form, "linkId");
  const body = str(form, "body");
  if (!body) return { error: "Message vide." };
  if (body.length > 5000) return { error: "Message trop long." };
  const link = await db.projectExpert.findUnique({ where: { id: linkId }, include: { project: true, practitioner: true } });
  if (!link) return { error: "Fil introuvable." };
  const isExpert = link.practitioner.userId === user.id;
  const isOrg = user.memberships.some((m) => m.organizationId === link.project.organizationId && PROJECT_VIEW_ROLES.includes(m.role));
  if (!isExpert && !isOrg) return { error: "Accès refusé." };
  await db.message.create({ data: { projectId: link.projectId, projectExpertId: link.id, authorId: user.id, body } });
  revalidatePath(`/sollicitations/${link.id}`);
  revalidatePath(`/organisations/${link.project.organizationId}/dossiers/${link.projectId}`);
  return { ok: "Message envoyé." };
}

/** Fait avancer le dossier dans le circuit réglementaire. */
export async function advanceProject(form: FormData) {
  const orgId = str(form, "orgId");
  const projectId = str(form, "projectId");
  const key = str(form, "transition") as TransitionKey;
  const t = TRANSITIONS[key];
  if (!t) return;
  const { user } = await requireMembership(orgId, t.roles === "compliance" ? COMPLIANCE_ROLES : PROJECT_ROLES);
  const project = await db.project.findFirst({ where: { id: projectId, organizationId: orgId } });
  if (!project || !(t.from as readonly string[]).includes(project.status)) return;

  const note = str(form, "note");
  await db.project.update({
    where: { id: projectId },
    data: {
      status: t.to,
      ...(key === "block" || key === "validate" ? { complianceNote: note || null } : {}),
      ...(key === "ordre" ? { ordreRef: note || null } : {}),
    },
  });
  // Les experts ayant donné leur accord suivent le statut du dossier.
  await db.projectExpert.updateMany({ where: { projectId, status: { notIn: ["DECLINE", "ATT_EXPERTS"] } }, data: { status: t.to } });
  if (key === "abandon") await db.projectExpert.updateMany({ where: { projectId, status: "ATT_EXPERTS" }, data: { status: "DECLINE" } });
  await audit(user.id, `project.${key}`, "Project", projectId, { from: project.status, to: t.to, note: note || undefined });
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
}
