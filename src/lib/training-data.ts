import "server-only";
import { db } from "@/lib/db";
import { eventEnded } from "@/lib/events";
import { acquisition, INDICATOR_MONTHS, satisfaction } from "@/lib/training";

/**
 * Indicateurs de résultats d'un organisme (Qualiopi, indicateur 2) : formations (événements avec une fiche de
 * formation) terminées sur les douze derniers mois ; satisfaction et acquis, publiés avec leur mode de calcul.
 */
export async function trainingIndicators(orgId: string, now = new Date()) {
  const since = new Date(now);
  since.setMonth(since.getMonth() - INDICATOR_MONTHS);
  const events = await db.event.findMany({
    where: { organizationId: orgId, training: { isNot: null }, cancelledAt: null, startsAt: { gte: since, lt: now } },
    select: {
      startsAt: true, durationMinutes: true,
      registrations: { where: { cancelledAt: null }, select: { checkedInAt: true, assessment: true, _count: { select: { attendances: true } }, survey: { select: { overall: true } } } },
    },
  });
  const done = events.filter((e) => eventEnded(e, now));
  const regs = done.flatMap((e) => e.registrations).filter((r) => r.checkedInAt || r._count.attendances > 0);
  return {
    trainings: done.length,
    participants: regs.length,
    satisfaction: satisfaction(regs.flatMap((r) => (r.survey ? [r.survey] : [])), regs.length),
    acquisition: acquisition(regs.map((r) => r.assessment)),
  };
}
