"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { ORG_NOT_VERIFIED, isVerifiedOrg, requireMembership } from "@/lib/orgs";
import { parseParisDateTime } from "@/lib/events";
import { collabType, SOURCING_ROLES } from "@/lib/projects";
import { eurToCents, str, unitsOrNull, UNITS_INVALID } from "@/lib/form";
import { notifyApplication, notifyNotRetained, notifySolicitations } from "@/lib/notifications";

export type ActionState = { error?: string; ok?: string } | undefined;

export async function createOpenCall(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, SOURCING_ROLES);
  if (!isVerifiedOrg(org)) return { error: ORG_NOT_VERIFIED };
  const title = str(form, "title");
  const typeId = str(form, "typeId");
  if (!title) return { error: "Le titre est obligatoire." };
  if (!collabType(typeId)) return { error: "Type de collaboration invalide." };
  const min = eurToCents(str(form, "budgetMin"));
  const max = eurToCents(str(form, "budgetMax"));
  if (min != null && max != null && min > max) return { error: "Le budget minimum dépasse le maximum." };
  const deadlineRaw = str(form, "deadline");
  const deadline = deadlineRaw ? parseParisDateTime(`${deadlineRaw}T23:59`) : null;
  if (deadlineRaw && (!deadline || deadline < new Date())) return { error: "Date limite invalide ou passée." };
  const call = await db.openCall.create({
    data: {
      organizationId: orgId,
      title,
      typeId,
      specialty: str(form, "specialty") || null,
      description: str(form, "description") || null,
      budgetMinCents: min,
      budgetMaxCents: max,
      deadline,
      createdById: user.id,
    },
  });
  await audit(user.id, "opencall.create", "OpenCall", call.id);
  redirect(`/organisations/${orgId}/opportunites/${call.id}`);
}

export async function setOpenCallStatus(form: FormData) {
  const orgId = str(form, "orgId");
  const callId = str(form, "callId");
  const { user, org } = await requireMembership(orgId, SOURCING_ROLES);
  const status = str(form, "status") === "closed" ? "closed" : "open";
  if (status === "open" && !isVerifiedOrg(org)) return;
  const { count } = await db.openCall.updateMany({ where: { id: callId, organizationId: orgId }, data: { status } });
  if (!count) return;
  await audit(user.id, `opencall.${status}`, "OpenCall", callId);
  revalidatePath(`/organisations/${orgId}/opportunites/${callId}`);
}

export async function applyToCall(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.practitioner?.listed) return { error: "Référencez-vous comme expert pour candidater." };
  const callId = str(form, "callId");
  const call = await db.openCall.findUnique({ where: { id: callId }, include: { organization: true } });
  if (!call || call.status !== "open" || !isVerifiedOrg(call.organization)) return { error: "Cet appel n'est plus ouvert." };
  if (call.deadline && call.deadline < new Date()) return { error: "La date limite est dépassée." };
  const message = str(form, "message");
  if (message.length < 20) return { error: "Présentez votre candidature en quelques lignes (20 caractères minimum)." };
  const existing = await db.application.findUnique({ where: { openCallId_practitionerId: { openCallId: callId, practitionerId: user.practitioner.id } } });
  if (existing) return { error: "Vous avez déjà candidaté." };
  const app = await db.application.create({ data: { openCallId: callId, practitionerId: user.practitioner.id, message } });
  await audit(user.id, "application.create", "Application", app.id, { callId });
  notifyApplication(callId, user.practitioner.id);
  revalidatePath(`/opportunites/${callId}`);
  return { ok: "Candidature envoyée." };
}

export async function withdrawApplication(form: FormData) {
  const user = await requireUser();
  const callId = str(form, "callId");
  if (!user.practitioner) return;
  const app = await db.application.findUnique({ where: { openCallId_practitionerId: { openCallId: callId, practitionerId: user.practitioner.id } } });
  if (app && app.status === "pending") {
    await db.application.delete({ where: { id: app.id } });
    await audit(user.id, "application.withdraw", "Application", app.id, { callId });
  }
  revalidatePath(`/opportunites/${callId}`);
}

export async function rejectApplication(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, SOURCING_ROLES);
  const appId = str(form, "applicationId");
  const app = await db.application.findFirst({ where: { id: appId, openCall: { organizationId: orgId }, status: "pending" }, include: { openCall: { include: { organization: { select: { name: true } } } }, practitioner: { select: { userId: true } } } });
  if (!app) return;
  await db.application.update({ where: { id: app.id }, data: { status: "rejected" } });
  await audit(user.id, "application.reject", "Application", app.id);
  notifyNotRetained(app.practitioner.userId, app.openCall.title, app.openCall.organization.name);
  revalidatePath(`/organisations/${orgId}/opportunites/${app.openCallId}`);
}

/**
 * Retenir un candidat : ouvre un dossier et adresse à l'expert une proposition d'honoraires.
 * Le dossier ne passe en accord de principe qu'une fois cette proposition acceptée par l'expert.
 */
export async function retainApplication(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, SOURCING_ROLES);
  if (!isVerifiedOrg(org)) return { error: ORG_NOT_VERIFIED };
  const appId = str(form, "applicationId");
  const app = await db.application.findFirst({
    where: { id: appId, openCall: { organizationId: orgId } },
    include: { openCall: true, practitioner: true },
  });
  if (!app) return { error: "Candidature introuvable." };
  if (app.status !== "pending") return { error: "Cette candidature a déjà été traitée." };
  const fee = eurToCents(str(form, "fee"));
  if (fee === null) return { error: "Indiquez les honoraires convenus." };
  const parsedUnits = unitsOrNull(str(form, "units"));
  if (parsedUnits === undefined) return { error: UNITS_INVALID };
  const units = parsedUnits ?? 1;

  // La candidature est « réservée » avant toute création : un double envoi ne crée pas deux dossiers.
  const project = await db.$transaction(async (tx) => {
    const { count } = await tx.application.updateMany({ where: { id: app.id, status: "pending" }, data: { status: "retained" } });
    if (count === 0) return null;
    const created = await tx.project.create({
      data: {
        organizationId: orgId,
        title: app.openCall.title,
        typeId: app.openCall.typeId,
        therapeuticArea: app.openCall.specialty,
        description: app.openCall.description,
        origin: "Opportunité",
        status: "ATT_EXPERTS",
        createdById: user.id,
        experts: { create: { practitionerId: app.practitionerId, status: "ATT_EXPERTS", feeCents: fee, days: units } },
      },
      include: { experts: true },
    });
    if (app.message) {
      await tx.message.create({
        data: { projectId: created.id, projectExpertId: created.experts[0].id, authorId: app.practitioner.userId, body: app.message, createdAt: app.createdAt },
      });
    }
    await tx.application.update({ where: { id: app.id }, data: { projectId: created.id } });
    return created;
  });
  if (!project) return { error: "Cette candidature a déjà été traitée." };
  await audit(user.id, "application.retain", "Application", app.id, { projectId: project.id });
  await audit(user.id, "project.create", "Project", project.id, { from: "opencall", callId: app.openCallId });
  notifySolicitations(project.id, "honoraires");
  redirect(`/organisations/${orgId}/dossiers/${project.id}`);
}
