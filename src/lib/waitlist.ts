import "server-only";
import { db } from "@/lib/db";
import { notifyWaitlistPlace } from "@/lib/notifications";

/** Délai pendant lequel une place proposée est laissée à la personne prévenue avant de prévenir la suivante. */
export const WAITLIST_OFFER_MS = 24 * 3600e3;

/**
 * Places libres d'un événement complet proposées à la liste d'attente, dans l'ordre d'arrivée : autant de personnes
 * prévenues que de places libres, moins les propositions encore en cours (moins de 24 h). Appelée à chaque place
 * libérée (annulation, capacité augmentée) et par les tâches planifiées. Idempotente.
 */
export async function offerFreedPlaces(eventId: string, now = new Date()): Promise<number> {
  const e = await db.event.findUnique({
    where: { id: eventId },
    select: { capacity: true, registrationOpen: true, startsAt: true, cancelledAt: true, publishedAt: true, _count: { select: { registrations: true } } },
  });
  if (!e?.capacity || !e.registrationOpen || e.cancelledAt || !e.publishedAt || e.startsAt <= now) return 0;
  const free = e.capacity - e._count.registrations;
  if (free <= 0) return 0;
  const pending = await db.waitlistEntry.count({ where: { eventId, notifiedAt: { gt: new Date(now.getTime() - WAITLIST_OFFER_MS) } } });
  const n = free - pending;
  if (n <= 0) return 0;
  const next = await db.waitlistEntry.findMany({ where: { eventId, notifiedAt: null }, orderBy: { createdAt: "asc" }, take: n, select: { id: true } });
  for (const w of next) {
    const { count } = await db.waitlistEntry.updateMany({ where: { id: w.id, notifiedAt: null }, data: { notifiedAt: now } });
    if (count) notifyWaitlistPlace(w.id);
  }
  return next.length;
}

/** Rang d'une personne sur la liste d'attente (1 = la première), null si elle n'y est pas. */
export async function waitlistRank(eventId: string, userId: string): Promise<number | null> {
  const me = await db.waitlistEntry.findUnique({ where: { eventId_userId: { eventId, userId } }, select: { createdAt: true } });
  if (!me) return null;
  return (await db.waitlistEntry.count({ where: { eventId, createdAt: { lt: me.createdAt } } })) + 1;
}
