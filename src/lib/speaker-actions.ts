"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, parseParisDateTime } from "@/lib/events";
import { collabType, PROJECT_ROLES, PROJECT_VIEW_ROLES } from "@/lib/projects";

export type ActionState = { error?: string; ok?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const eurToCents = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return v && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const SPEAKER_ROLES = [...new Set([...EVENT_MANAGER_ROLES, ...PROJECT_ROLES])];

/** Ouvre (ou met à jour) l'appel à intervenants d'un événement de l'organisation. */
export async function openSpeakerCall(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const eventId = str(form, "eventId");
  const event = await db.event.findFirst({ where: { id: eventId, organizationId: orgId } });
  if (!event) return { error: "Choisissez un événement." };
  if (event.startsAt < new Date()) return { error: "Cet événement est déjà passé." };
  const slots = Number(str(form, "slots"));
  if (!Number.isInteger(slots) || slots < 1 || slots > 50) return { error: "Nombre de places invalide." };
  const min = eurToCents(str(form, "budgetMin"));
  const max = eurToCents(str(form, "budgetMax"));
  if (min != null && max != null && min > max) return { error: "Le minimum dépasse le maximum." };
  const deadlineRaw = str(form, "deadline");
  const deadline = deadlineRaw ? parseParisDateTime(`${deadlineRaw}T23:59`) : null;
  if (deadlineRaw && (!deadline || deadline < new Date() || deadline > event.startsAt)) return { error: "Date de clôture invalide (à venir, avant l'événement)." };
  await db.event.update({
    where: { id: eventId },
    data: { speakerCallOpen: true, speakerSlots: slots, speakerDeadline: deadline, speakerBudgetMinCents: min, speakerBudgetMaxCents: max, speakerProfile: str(form, "profile") || null },
  });
  await audit(user.id, "speakercall.open", "Event", eventId, { slots });
  revalidatePath(`/organisations/${orgId}/intervenants`);
  return { ok: "Appel publié. Les experts référencés le voient dans « Mes interventions »." };
}

export async function setSpeakerCallOpen(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const eventId = str(form, "eventId");
  const open = str(form, "open") === "1";
  await db.event.updateMany({ where: { id: eventId, organizationId: orgId }, data: { speakerCallOpen: open } });
  await audit(user.id, open ? "speakercall.reopen" : "speakercall.close", "Event", eventId);
  revalidatePath(`/organisations/${orgId}/intervenants`);
}

export async function applyAsSpeaker(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p?.listed) return { error: "Référencez-vous comme expert pour candidater." };
  const eventId = str(form, "eventId");
  const event = await db.event.findUnique({ where: { id: eventId }, include: { speakerApplications: { where: { status: "retained" }, select: { id: true } } } });
  if (!event || !event.speakerCallOpen || !event.publishedAt) return { error: "Cet appel n'est plus ouvert." };
  if ((event.speakerDeadline && event.speakerDeadline < new Date()) || event.startsAt < new Date()) return { error: "La date limite est dépassée." };
  if (event.speakerSlots && event.speakerApplications.length >= event.speakerSlots) return { error: "Toutes les places sont pourvues." };
  const message = str(form, "message");
  if (message.length < 20) return { error: "Décrivez ce que vous proposez de présenter (20 caractères minimum)." };
  const existing = await db.speakerApplication.findUnique({ where: { eventId_practitionerId: { eventId, practitionerId: p.id } } });
  if (existing) return { error: "Vous avez déjà candidaté." };
  const app = await db.speakerApplication.create({ data: { eventId, practitionerId: p.id, message } });
  await audit(user.id, "speaker.apply", "SpeakerApplication", app.id, { eventId });
  revalidatePath("/interventions");
  return { ok: "Candidature envoyée." };
}

export async function withdrawSpeaker(form: FormData) {
  const user = await requireUser();
  if (!user.practitioner) return;
  const eventId = str(form, "eventId");
  const app = await db.speakerApplication.findUnique({ where: { eventId_practitionerId: { eventId, practitionerId: user.practitioner.id } } });
  if (app?.status === "pending") {
    await db.speakerApplication.delete({ where: { id: app.id } });
    await audit(user.id, "speaker.withdraw", "SpeakerApplication", app.id, { eventId });
  }
  revalidatePath("/interventions");
}

export async function rejectSpeaker(form: FormData) {
  const orgId = str(form, "orgId");
  const { user } = await requireMembership(orgId, SPEAKER_ROLES);
  const app = await db.speakerApplication.findFirst({ where: { id: str(form, "applicationId"), event: { organizationId: orgId }, status: "pending" } });
  if (!app) return;
  await db.speakerApplication.update({ where: { id: app.id }, data: { status: "rejected" } });
  await audit(user.id, "speaker.reject", "SpeakerApplication", app.id);
  revalidatePath(`/organisations/${orgId}/intervenants`);
}

/** Retenir un intervenant ouvre le dossier de collaboration correspondant (accord de principe). */
export async function retainSpeaker(_: ActionState, form: FormData): Promise<ActionState> {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, SPEAKER_ROLES);
  const app = await db.speakerApplication.findFirst({
    where: { id: str(form, "applicationId"), event: { organizationId: orgId } },
    include: { event: { include: { speakerApplications: { where: { status: "retained" }, select: { id: true } } } }, practitioner: { include: { user: true } } },
  });
  if (!app) return { error: "Candidature introuvable." };
  if (app.status !== "pending") return { error: "Cette candidature a déjà été traitée." };
  const ev = app.event;
  if (ev.speakerSlots && ev.speakerApplications.length >= ev.speakerSlots) return { error: "Toutes les places sont déjà pourvues." };
  const fee = eurToCents(str(form, "fee"));
  if (fee === null) return { error: "Indiquez les honoraires convenus." };
  const typeId = collabType(ev.typeId) ? ev.typeId : "pleniere";

  const project = await db.project.create({
    data: {
      organizationId: orgId,
      title: `${ev.title} — intervention du Dr ${app.practitioner.user.lastName}`,
      typeId,
      therapeuticArea: ev.therapeuticArea,
      description: ev.description,
      origin: "Appel à intervenants",
      status: "ACCORD",
      createdById: user.id,
      experts: { create: { practitionerId: app.practitionerId, status: "ACCORD", feeCents: fee, days: 1, respondedAt: new Date() } },
    },
    include: { experts: true },
  });
  if (app.message) {
    await db.message.create({
      data: { projectId: project.id, projectExpertId: project.experts[0].id, authorId: app.practitioner.userId, body: app.message, createdAt: app.createdAt },
    });
  }
  await db.speakerApplication.update({ where: { id: app.id }, data: { status: "retained", projectId: project.id } });
  await audit(user.id, "speaker.retain", "SpeakerApplication", app.id, { projectId: project.id });
  await audit(user.id, "project.create", "Project", project.id, { from: "speakercall", eventId: ev.id });
  if (roles.some((r) => PROJECT_VIEW_ROLES.includes(r))) redirect(`/organisations/${orgId}/dossiers/${project.id}`);
  revalidatePath(`/organisations/${orgId}/intervenants`);
  return { ok: "Intervenant retenu : le dossier de collaboration est ouvert pour l'équipe projets." };
}
