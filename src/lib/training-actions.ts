"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { str, unitsOrNull } from "@/lib/form";
import { EVENT_MANAGER_ROLES, eventEnd, eventEnded, eventScope, toParisInput } from "@/lib/events";
import { halfDays, isAssessment, isFunding, selfSignOpen, spanMinutes } from "@/lib/training";
import { getT } from "@/lib/i18n/server";

export type ActionState = { error?: string; ok?: string } | undefined;

async function managed(form: FormData) {
  const orgId = str(form, "orgId");
  const { user, roles } = await requireMembership(orgId, EVENT_MANAGER_ROLES);
  const event = await db.event.findFirst({ where: { id: str(form, "eventId"), organizationId: orgId, internal: false, ...eventScope(user, roles) }, include: { sessions: { orderBy: { startsAt: "asc" } } } });
  return { orgId, user, event };
}

const refresh = (orgId: string, eventId: string) => {
  revalidatePath(`/organisations/${orgId}/evenements/${eventId}`);
  revalidatePath(`/evenements/${eventId}`);
  // Événement rattaché à un dossier : il se gère aussi dans l'onglet « Événement » du dossier.
  revalidatePath(`/organisations/${orgId}/dossiers`, "layout");
};

/** Fiche de la formation (information du public) : objectifs, public, prérequis, durée, modalités, accès, tarif. */
export async function saveTrainingSheet(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form);
  if (!event) return { error: t("Événement introuvable.") };
  const objectives = str(form, "objectives", 3000);
  if (!objectives) return { error: t("Indiquez les objectifs de la formation (compétences visées).") };
  const hours = unitsOrNull(str(form, "hours"));
  if (hours === undefined) return { error: t("Durée invalide : indiquez un nombre d'heures.") };
  const text = (k: string, n = 2000) => str(form, k, n) || null;
  const data = {
    objectives, hours,
    audience: text("audience"), prerequisites: text("prerequisites"), methods: text("methods"), assessment: text("assessment"),
    accessDelay: text("accessDelay"), accessibility: text("accessibility"), price: text("price", 300),
    funding: form.getAll("funding").map(String).filter(isFunding),
    fundingNote: text("fundingNote", 500), dpcRef: text("dpcRef", 60), contact: text("contact", 300),
  };
  await db.trainingSheet.upsert({ where: { eventId: event.id }, create: { eventId: event.id, ...data }, update: data });
  await audit(user.id, "event.training", "Event", event.id);
  refresh(orgId, event.id);
  return { ok: t("Fiche de formation enregistrée : elle figure sur la page de l'événement.") };
}

/**
 * Demi-journées d'un événement sur un ou plusieurs jours : remplacent les précédentes (tant qu'aucune n'est émargée).
 * La durée de l'événement couvre ensuite de la première à la dernière demi-journée.
 */
export async function createHalfDays(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form);
  if (!event) return { error: t("Événement introuvable.") };
  if ((await db.attendance.count({ where: { session: { eventId: event.id } } })) > 0) return { error: t("Des demi-journées sont déjà émargées : retirez seulement celles qui ne le sont pas.") };
  const slot = (a: string, b: string, on: boolean) => (on ? ([str(form, a), str(form, b)] as [string, string]) : null);
  const list = halfDays({ firstDay: str(form, "firstDay"), days: Number(str(form, "days")), am: slot("amStart", "amEnd", form.get("am") === "on"), pm: slot("pmStart", "pmEnd", form.get("pm") === "on") });
  if (typeof list === "string") return { error: t(list) };
  const span = spanMinutes(list)!;
  // Les demi-journées commencent le jour de l'événement (sa date reste celle validée et annoncée).
  if (toParisInput(span.start).slice(0, 10) < toParisInput(event.startsAt).slice(0, 10)) return { error: t("Les demi-journées commencent le jour de l'événement ou après.") };
  // Même jour, l'événement commence avec la première demi-journée ; sa durée va jusqu'à la fin de la dernière (rappel,
  // envoi après l'événement).
  const start = Math.min(event.startsAt.getTime(), span.start.getTime());
  const end = Math.max(eventEnd(event).getTime(), span.start.getTime() + span.minutes * 60e3);
  await db.$transaction([
    db.eventSession.deleteMany({ where: { eventId: event.id } }),
    db.eventSession.createMany({ data: list.map((s) => ({ eventId: event.id, ...s })) }),
    db.event.update({ where: { id: event.id }, data: { startsAt: new Date(start), durationMinutes: Math.round((end - start) / 60e3) } }),
  ]);
  await audit(user.id, "event.sessions", "Event", event.id, { n: list.length });
  refresh(orgId, event.id);
  return { ok: t(list.length > 1 ? "{n} demi-journées créées." : "{n} demi-journée créée.", { n: list.length }) };
}

/** Retrait d'une demi-journée non émargée. */
export async function removeSession(form: FormData) {
  const { orgId, user, event } = await managed(form);
  if (!event) return;
  const s = event.sessions.find((x) => x.id === str(form, "sessionId"));
  if (!s || (await db.attendance.count({ where: { sessionId: s.id } })) > 0) return;
  await db.eventSession.delete({ where: { id: s.id } });
  await audit(user.id, "event.session_remove", "Event", event.id, { sessionId: s.id });
  refresh(orgId, event.id);
}

/**
 * Émargement relevé par l'organisateur (case par participant et par demi-journée). Les signatures des participants
 * eux-mêmes restent : seules les présences relevées par l'équipe se retirent.
 */
export async function saveAttendance(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form);
  if (!event) return { error: t("Événement introuvable.") };
  const regs = await db.registration.findMany({ where: { eventId: event.id, cancelledAt: null }, select: { id: true, checkedInAt: true, attendances: { select: { sessionId: true, method: true } } } });
  const now = new Date();
  let added = 0, removed = 0;
  for (const r of regs) {
    for (const s of event.sessions) {
      if (s.startsAt.getTime() - 30 * 60e3 > now.getTime()) continue; // demi-journée à venir : rien à relever
      const want = form.get(`att_${s.id}_${r.id}`) === "on";
      const has = r.attendances.find((a) => a.sessionId === s.id);
      if (want && !has) {
        await db.attendance.create({ data: { sessionId: s.id, registrationId: r.id, method: "team", byId: user.id } });
        added++;
      } else if (!want && has?.method === "team") {
        await db.attendance.deleteMany({ where: { sessionId: s.id, registrationId: r.id, method: "team" } });
        removed++;
      }
    }
    // Présent à au moins une demi-journée : présence enregistrée (attestation, questionnaire, déclarations).
    if (!r.checkedInAt && (r.attendances.length > 0 || event.sessions.some((s) => form.get(`att_${s.id}_${r.id}`) === "on")))
      await db.registration.update({ where: { id: r.id }, data: { checkedInAt: now, checkedInById: user.id } });
  }
  await audit(user.id, "event.attendance", "Event", event.id, { added, removed });
  refresh(orgId, event.id);
  return { ok: t("Émargement enregistré.") };
}

/** Évaluation des acquis par participant, une fois la formation terminée. */
export async function saveAssessments(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const { orgId, user, event } = await managed(form);
  if (!event) return { error: t("Événement introuvable.") };
  if (!eventEnded(event)) return { error: t("L'évaluation des acquis se renseigne une fois la formation terminée.") };
  const regs = await db.registration.findMany({ where: { eventId: event.id, cancelledAt: null }, select: { id: true, assessment: true } });
  let n = 0;
  for (const r of regs) {
    const v = str(form, `assess_${r.id}`);
    const next = v && isAssessment(v) ? v : null;
    if (next === r.assessment) continue;
    await db.registration.update({ where: { id: r.id }, data: { assessment: next, assessedAt: next ? new Date() : null } });
    n++;
  }
  await audit(user.id, "event.assessments", "Event", event.id, { n });
  refresh(orgId, event.id);
  return { ok: t("Évaluation des acquis enregistrée.") };
}

/** Émargement du participant connecté pour la demi-journée en cours. */
export async function signAttendance(form: FormData) {
  const user = await requireUser();
  const session = await db.eventSession.findUnique({ where: { id: str(form, "sessionId") }, include: { event: { select: { id: true, organizationId: true, cancelledAt: true } } } });
  if (!session || session.event.cancelledAt || !selfSignOpen(session)) return;
  const reg = await db.registration.findFirst({ where: { eventId: session.eventId, userId: user.id, cancelledAt: null }, select: { id: true, checkedInAt: true } });
  if (!reg) return;
  const { count } = await db.attendance.createMany({ data: [{ sessionId: session.id, registrationId: reg.id, method: "self" }], skipDuplicates: true });
  if (count && !reg.checkedInAt) await db.registration.update({ where: { id: reg.id }, data: { checkedInAt: new Date() } });
  if (count) await audit(user.id, "registration.sign", "Registration", reg.id, { sessionId: session.id });
  refresh(session.event.organizationId, session.eventId);
  revalidatePath("/inscriptions");
  revalidatePath(`/inscriptions/${reg.id}/badge`);
}
