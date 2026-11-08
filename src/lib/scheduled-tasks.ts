import "server-only";
import { db } from "@/lib/db";
import { eventEnd, FOLLOWUP_DELAY_MS, FOLLOWUP_MAX_AGE_MS, REMINDER_WINDOW_MS } from "@/lib/event-followup";
import { sendEventFollowUps, sendEventReminders, sendOverdueReviews, sendServiceReport } from "@/lib/notifications";
import { REPORT_DELAY_DAYS } from "@/lib/services";
import { purgeRateLimits } from "@/lib/rate-limit";
import { purgeEmailLog } from "@/lib/email-log";
import { offerFreedPlaces } from "@/lib/waitlist";
import { NEEDS_RETENTION_DAYS } from "@/lib/registration-needs";

/** Tâches dues : rappels de la veille, puis remerciements (attestation, questionnaire) après les événements. Idempotent. */
export async function runDueTasks(now = new Date()) {
  const soon = await db.event.findMany({
    where: { internal: false, cancelledAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + REMINDER_WINDOW_MS) }, registrations: { some: { reminderSentAt: null } } },
    select: { id: true },
  });
  let reminders = 0;
  for (const e of soon) reminders += await sendEventReminders(e.id, now);

  const recent = await db.event.findMany({
    where: { internal: false, cancelledAt: null, startsAt: { gte: new Date(now.getTime() - FOLLOWUP_MAX_AGE_MS), lt: now }, registrations: { some: { followUpSentAt: null } } },
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
  // Délais internes : examens de la conformité en retard, relancés une fois par jour.
  const reviewReminders = await sendOverdueReviews(now);
  // Conservation : sessions et liens de connexion expirés depuis plus de 30 jours.
  const old = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const sessions = (await db.session.deleteMany({ where: { expiresAt: { lt: old } } })).count;
  const tokens = (await db.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: old } }, { usedAt: { lt: old } }] } })).count;
  // Mesure des services : visites des liens suivis conservées 13 mois (politique de confidentialité).
  const clicks = (await db.serviceClick.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 395 * 24 * 3600 * 1000) } } })).count;
  // Limiteur de débit : tentatives de plus de 24 h.
  const attempts = await purgeRateLimits(now);
  // Listes d'attente : places encore libres proposées aux suivants (proposition précédente restée sans suite 24 h).
  const waiting = await db.event.findMany({ where: { startsAt: { gt: now }, cancelledAt: null, waitlist: { some: { notifiedAt: null } } }, select: { id: true } });
  let offers = 0;
  for (const e of waiting) offers += await offerFreedPlaces(e.id, now);
  // Besoins déclarés à l'inscription (régime, allergies, accessibilité) : effacés 30 jours après l'événement.
  const needsLimit = new Date(now.getTime() - NEEDS_RETENTION_DAYS * 86400e3 - 7 * 86400e3);
  const needs = (await db.registration.updateMany({
    where: { event: { startsAt: { lt: needsLimit } }, OR: [{ diet: { not: null } }, { allergies: { not: null } }, { needs: { not: null } }] },
    data: { diet: null, allergies: null, needs: null },
  })).count;
  // Journal des e-mails : 90 jours.
  const emails = await purgeEmailLog(now);
  return { reminders, followUps, reports, reviewReminders, offers, purged: { sessions, tokens, clicks, attempts, needs, emails } };
}
