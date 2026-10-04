import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { appUrl, eventLocation, icsResponse, toIcs } from "@/lib/ics";

/** Agenda personnel : inscriptions et interventions à venir. */
export async function GET() {
  const user = await requireUser();
  const now = new Date();
  const [regs, talks] = await Promise.all([
    db.registration.findMany({ where: { userId: user.id, event: { startsAt: { gte: now } } }, include: { event: { include: { organization: { select: { name: true } } } } } }),
    user.practitioner
      ? db.speakerApplication.findMany({ where: { practitionerId: user.practitioner.id, status: "retained", event: { startsAt: { gte: now } } }, include: { event: { include: { organization: { select: { name: true } } } } } })
      : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const items = [...talks.map((t) => ({ e: t.event, talk: true })), ...regs.map((r) => ({ e: r.event, talk: false }))].filter(({ e }) => !seen.has(e.id) && !!seen.add(e.id));
  return icsResponse("kolbase-mon-agenda.ics", toIcs("Kolbase — mon agenda", items.map(({ e, talk }) => ({
    uid: `${e.id}-${user.id}`, start: e.startsAt, minutes: e.durationMinutes, title: `${talk ? "Intervention : " : ""}${e.title}`, location: eventLocation(e),
    description: `Organisé par ${e.organization.name}.`, url: `${appUrl()}/evenements/${e.id}`,
  }))));
}
