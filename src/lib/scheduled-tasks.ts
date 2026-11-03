import "server-only";
import { db } from "@/lib/db";
import { eventEnd, FOLLOWUP_DELAY_MS, FOLLOWUP_MAX_AGE_MS, REMINDER_WINDOW_MS } from "@/lib/event-followup";
import { sendEventFollowUps, sendEventReminders, sendServiceReport } from "@/lib/notifications";
import { REPORT_DELAY_DAYS } from "@/lib/services";

/** Tâches dues : rappels de la veille, puis remerciements (attestation, questionnaire) après les événements. Idempotent. */
export async function runDueTasks(now = new Date()) {
  const soon = await db.event.findMany({
    where: { internal: false, startsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_WINDOW_MS) }, registrations: { some: { reminderSentAt: null } } },
    select: { id: true },
  });
  let reminders = 0;
  for (const e of soon) reminders += await sendEventReminders(e.id, now);

  const recent = await db.event.findMany({
    where: { internal: false, startsAt: { gte: new Date(now.getTime() - FOLLOWUP_MAX_AGE_MS), lt: now }, registrations: { some: { followUpSentAt: null } } },
    select: { id: true, startsAt: true, durationMinutes: true },
  });
  let followUps = 0;
  for (const e of recent) if (eventEnd(e).getTime() + FOLLOWUP_DELAY_MS <= now.getTime()) followUps += await sendEventFollowUps(e.id, now);
  // Bilan des services KolBase : sept jours après la réalisation, ou dès que l'événement a eu lieu.
  const due = await db.serviceOrder.findMany({
    where: { status: "realisee", reportSentAt: null, doneAt: { not: null }, OR: [{ doneAt: { lte: new Date(now.getTime() - REPORT_DELAY_DAYS * 86400e3) } }, { event: { startsAt: { lte: now } } }] },
    select: { id: true },
  });
  let reports = 0;
  for (const o of due) if (await sendServiceReport(o.id, now).catch((e) => { console.error("[bilan du service]", o.id, e); return false; })) reports++;
  // Conservation : sessions et liens de connexion expirés depuis plus de 30 jours.
  const old = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const sessions = (await db.session.deleteMany({ where: { expiresAt: { lt: old } } })).count;
  const tokens = (await db.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { usedAt: { lt: old } }] } })).count;
  return { reminders, followUps, reports, purged: { sessions, tokens } };
}
