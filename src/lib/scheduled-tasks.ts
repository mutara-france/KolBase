import "server-only";
import { db } from "@/lib/db";
import { eventEnd, FOLLOWUP_DELAY_MS, FOLLOWUP_MAX_AGE_MS, REMINDER_WINDOW_MS } from "@/lib/event-followup";
import { sendEventFollowUps, sendEventReminders } from "@/lib/notifications";

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
  return { reminders, followUps };
}
