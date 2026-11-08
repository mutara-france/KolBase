"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { mailEnabled } from "@/lib/mail";
import { audit, requireUser } from "@/lib/auth";
import { isVerifiedOrg, notVerified, requireMembership } from "@/lib/orgs";
import { parseParisDateTime } from "@/lib/events";
import { collabType, recruitmentOpen, SOURCING_ROLES } from "@/lib/projects";
import { eurToCents, str } from "@/lib/form";
import { readFeeFields } from "@/lib/fee-fields";
import { notifyApplication, notifyApplicationSent, notifyNotRetained, notifySolicitations } from "@/lib/notifications";
import { engagementGate } from "@/lib/billing";
import type { GateLink } from "@/lib/billing-plans";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string; fix?: GateLink } | undefined;

/**
 * Opportunité : pour une collaboration (board, étude, rédaction…) ou pour intervenir à un événement
 * de l'organisation (formation, symposium…). Dans les deux cas, la personne retenue ouvre un dossier.
 */
export async function createOpenCall(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, SOURCING_ROLES);
  if (!isVerifiedOrg(org)) return { error: t(notVerified(org)) };
  const gate = await engagementGate(orgId, "appel");
  if (gate) return gate;
  const title = str(form, "title");
  const typeId = str(form, "typeId");
  if (!title) return { error: t("Le titre est obligatoire.") };
  if (!collabType(typeId)) return { error: t("Type de collaboration invalide.") };
  const eventId = str(form, "eventId") || null;
  const event = eventId ? await db.event.findFirst({ where: { id: eventId, organizationId: orgId } }) : null;
  if (eventId && !event) return { error: t("Événement introuvable.") };
  if (event && event.startsAt < new Date()) return { error: t("Cet événement est déjà passé.") };
  const slotsRaw = str(form, "slots");
  const slots = slotsRaw ? Number(slotsRaw) : null;
  if (slots != null && (!Number.isInteger(slots) || slots < 1 || slots > 50)) return { error: t("Nombre de places invalide (1 à 50).") };
  const min = eurToCents(str(form, "budgetMin"));
  const max = eurToCents(str(form, "budgetMax"));
  if (min != null && max != null && min > max) return { error: t("Le budget minimum dépasse le maximum.") };
  const deadlineRaw = str(form, "deadline");
  const deadline = deadlineRaw ? parseParisDateTime(`${deadlineRaw}T23:59`) : null;
  if (deadlineRaw && (!deadline || deadline < new Date())) return { error: t("Date limite invalide ou passée.") };
  if (deadline && event && deadline > event.startsAt) return { error: t("La date limite doit précéder l'événement.") };
  const call = await db.openCall.create({
    data: {
      organizationId: orgId,
      title,
      typeId,
      eventId: event?.id ?? null,
      slots,
      specialty: str(form, "specialty") || null,
      description: str(form, "description") || null,
      budgetMinCents: min,
      budgetMaxCents: max,
      deadline,
      createdById: user.id,
    },
  });
  await audit(user.id, "opencall.create", "OpenCall", call.id, event ? { eventId: event.id } : undefined);
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
  const { t } = await getT();
  if (!user.practitioner?.listed) return { error: t("Référencez-vous comme expert pour candidater.") };
  const callId = str(form, "callId");
  const call = await db.openCall.findUnique({ where: { id: callId }, include: { organization: true, event: true, _count: { select: { applications: { where: { status: "retained" } } } } } });
  if (!call || call.status !== "open" || !isVerifiedOrg(call.organization)) return { error: t("Cette opportunité n'est plus ouverte.") };
  if ((call.deadline && call.deadline < new Date()) || (call.event && call.event.startsAt < new Date())) return { error: t("La date limite est dépassée.") };
  if (call.slots && call._count.applications >= call.slots) return { error: t("Toutes les places sont pourvues.") };
  const message = str(form, "message");
  if (message.length < 20) return { error: t("Présentez votre candidature en quelques lignes (20 caractères minimum).") };
  const existing = await db.application.findUnique({ where: { openCallId_practitionerId: { openCallId: callId, practitionerId: user.practitioner.id } } });
  if (existing) return { error: t("Vous avez déjà candidaté.") };
  const app = await db.application.create({ data: { openCallId: callId, practitionerId: user.practitioner.id, message } });
  await audit(user.id, "application.create", "Application", app.id, { callId });
  notifyApplication(callId, user.practitioner.id);
  notifyApplicationSent(app.id);
  revalidatePath(`/opportunites/${callId}`);
  return { ok: mailEnabled() ? t("Candidature envoyée. Un e-mail de confirmation vous est envoyé.") : t("Candidature envoyée. Vous la suivez dans « Mes candidatures ».") };
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
  revalidatePath("/interventions");
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
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const { user, org } = await requireMembership(orgId, SOURCING_ROLES);
  if (!isVerifiedOrg(org)) return { error: t(notVerified(org)) };
  const appId = str(form, "applicationId");
  const app = await db.application.findFirst({
    where: { id: appId, openCall: { organizationId: orgId } },
    include: { openCall: { include: { event: true } }, practitioner: { include: { user: { select: { lastName: true } } } } },
  });
  if (!app) return { error: t("Candidature introuvable.") };
  if (app.status !== "pending") return { error: t("Cette candidature a déjà été traitée.") };
  const read = await readFeeFields(form, orgId);
  if ("error" in read) return { error: t(read.error === "Indiquez des honoraires (0 si bénévole)." ? "Indiquez les honoraires convenus." : read.error) };
  const terms = { ...read.data, days: read.data.days ?? 1 };
  const { feeCents: fee, days: units } = terms;

  const call = app.openCall;
  const ev = call.event;
  // Plusieurs personnes retenues (places, événement) : un dossier par personne, à son nom.
  const title = ev ? `${ev.title} : intervention du Dr ${app.practitioner.user.lastName}` : call.slots && call.slots > 1 ? `${call.title} : Dr ${app.practitioner.user.lastName}` : call.title;

  // Opportunité publiée depuis l'événement d'un dossier qui recrute encore : l'expert retenu rejoint ce dossier
  // (onglet Experts). Dossier déjà soumis à la conformité, ou événement hors dossier : un dossier à son nom.
  const host = ev?.projectId ? await db.project.findFirst({ where: { id: ev.projectId, organizationId: orgId }, select: { id: true, status: true } }) : null;
  const joinHost = !!host && recruitmentOpen(host.status);
  if (joinHost && (await db.projectExpert.findUnique({ where: { projectId_practitionerId: { projectId: host.id, practitionerId: app.practitionerId } } })))
    return { error: t("Cet expert est déjà sollicité dans le dossier de l'événement.") };

  // La candidature est « réservée » avant toute création (verrou sur l'appel) : un double envoi ne crée pas deux
  // dossiers, et deux décisions simultanées ne dépassent pas le nombre de places.
  const project = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "OpenCall" WHERE id = ${call.id} FOR UPDATE`;
    if (call.slots && (await tx.application.count({ where: { openCallId: call.id, status: "retained" } })) >= call.slots) return "full" as const;
    const { count } = await tx.application.updateMany({ where: { id: app.id, status: "pending" }, data: { status: "retained" } });
    if (count === 0) return null;
    if (joinHost) {
      const link = await tx.projectExpert.create({ data: { projectId: host.id, practitionerId: app.practitionerId, status: "ATT_EXPERTS", ...terms } });
      if (app.message) await tx.message.create({ data: { projectId: host.id, projectExpertId: link.id, authorId: app.practitioner.userId, body: app.message, createdAt: app.createdAt } });
      await tx.application.update({ where: { id: app.id }, data: { projectId: host.id } });
      return { id: host.id, linkId: link.id, joined: true };
    }
    const created = await tx.project.create({
      data: {
        organizationId: orgId,
        title,
        typeId: call.typeId,
        therapeuticArea: call.specialty ?? ev?.therapeuticArea ?? null,
        description: call.description ?? ev?.description ?? null,
        origin: ev ? `Opportunité : ${ev.title}` : "Opportunité",
        status: "ATT_EXPERTS",
        createdById: user.id,
        // Qui retient le candidat devient responsable du dossier.
        leads: { create: { userId: user.id } },
        experts: { create: { practitionerId: app.practitionerId, status: "ATT_EXPERTS", ...terms } },
      },
      include: { experts: true },
    });
    if (app.message) {
      await tx.message.create({
        data: { projectId: created.id, projectExpertId: created.experts[0].id, authorId: app.practitioner.userId, body: app.message, createdAt: app.createdAt },
      });
    }
    await tx.application.update({ where: { id: app.id }, data: { projectId: created.id } });
    return { id: created.id, linkId: created.experts[0].id, joined: false };
  });
  if (project === "full") return { error: t("Toutes les places sont déjà pourvues.") };
  if (!project) return { error: t("Cette candidature a déjà été traitée.") };
  await audit(user.id, "application.retain", "Application", app.id, { projectId: project.id });
  if (project.joined) await audit(user.id, "project.add_expert", "ProjectExpert", project.linkId, { projectId: project.id, feeCents: fee, days: units, from: "opencall", callId: app.openCallId });
  else await audit(user.id, "project.create", "Project", project.id, { from: "opencall", callId: app.openCallId });
  notifySolicitations(project.id, "honoraires", [project.linkId]);
  redirect(`/organisations/${orgId}/dossiers/${project.id}${project.joined ? "?onglet=experts" : ""}`);
}
