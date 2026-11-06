"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { str } from "@/lib/form";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventScope } from "@/lib/events";
import { attended, eventEnded } from "@/lib/event-followup";
import { sendEventFollowUps, sendEventReminders } from "@/lib/notifications";
import { getT } from "@/lib/i18n/server";

export type FormState = { error?: string; ok?: string } | undefined;

async function managedEvent(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const event = await db.event.findFirst({ where: { id: str(form, "eventId"), organizationId: orgId, internal: false, ...eventScope(user, roles) } });
  return { orgId, user, event };
}

/** Rappel envoyé tout de suite aux inscrits qui ne l'ont pas encore reçu (sinon : automatiquement la veille). */
export async function sendRemindersNow(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const { orgId, user, event } = await managedEvent(form);
  if (!event) return { error: t("Événement introuvable.") };
  if (event.startsAt <= new Date()) return { error: t("L'événement a commencé : le rappel n'a plus lieu d'être.") };
  const n = await sendEventReminders(event.id);
  await audit(user.id, "event.reminders", "Event", event.id, { sent: n });
  revalidatePath(`/organisations/${orgId}/evenements/${event.id}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  return n ? { ok: t("Rappel envoyé à {n} inscrit{v}.", { n, v: n > 1 ? "s" : "" }) } : { ok: t("Tous les inscrits ont déjà reçu le rappel.") };
}

/** Remerciement, attestation et questionnaire envoyés tout de suite (sinon : automatiquement après l'événement). */
export async function sendFollowUpsNow(_: FormState, form: FormData): Promise<FormState> {
  const { t } = await getT();
  const { orgId, user, event } = await managedEvent(form);
  if (!event) return { error: t("Événement introuvable.") };
  if (!eventEnded(event)) return { error: t("L'envoi se fait une fois l'événement terminé.") };
  const n = await sendEventFollowUps(event.id);
  await audit(user.id, "event.followups", "Event", event.id, { sent: n });
  revalidatePath(`/organisations/${orgId}/evenements/${event.id}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
  return n ? { ok: t("Envoyé à {n} participant{v}.", { n, v: n > 1 ? "s" : "" }) } : { ok: t("Tous les participants l'ont déjà reçu.") };
}

const rating = (form: FormData, key: string, required: boolean) => {
  const raw = str(form, key);
  if (!raw) return required ? NaN : null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : NaN;
};

/** Réponse au questionnaire de satisfaction (une par inscription, après la fin de l'événement). */
export async function submitSurvey(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const { t } = await getT();
  const reg = await db.registration.findFirst({ where: { eventId: str(form, "eventId"), userId: user.id }, include: { event: true, survey: { select: { id: true } } } });
  if (!reg) return { error: t("Inscription introuvable.") };
  if (!eventEnded(reg.event)) return { error: t("Le questionnaire ouvre à la fin de l'événement.") };
  if (!(await attended(reg))) return { error: t("Le questionnaire est réservé aux participants dont la présence a été enregistrée à l'accueil.") };
  if (reg.survey) return { ok: t("Merci, votre avis est déjà enregistré.") };
  const overall = rating(form, "overall", true);
  const content = rating(form, "content", false);
  const logistics = rating(form, "logistics", false);
  if ([overall, content, logistics].some((x) => Number.isNaN(x))) return { error: t("Choisissez une note de 1 à 5.") };
  await db.surveyResponse.create({
    data: { registrationId: reg.id, eventId: reg.eventId, overall: overall as number, content, logistics, comment: str(form, "comment").slice(0, 2000) || null },
  });
  revalidatePath(`/evenements/${reg.eventId}/avis`);
  revalidatePath(`/organisations/${reg.event.organizationId}/evenements/${reg.eventId}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${reg.event.organizationId}/dossiers`, "layout");
  return { ok: t("Merci : votre avis est transmis à l'organisateur, sans votre nom.") };
}
