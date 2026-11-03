import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { appUrl, eventLocation, icsResponse, joinUrl, toIcs } from "@/lib/ics";
import { getT } from "@/lib/i18n/server";

/** Agenda personnel : inscriptions et interventions à venir. */
export async function GET() {
  const user = await requireUser();
  const { t } = await getT();
  const now = new Date();
  const [regs, talks] = await Promise.all([
    db.registration.findMany({ where: { userId: user.id, event: { startsAt: { gte: now } } }, include: { event: { include: { organization: { select: { name: true } } } } } }),
    user.practitioner
      ? db.application.findMany({ where: { practitionerId: user.practitioner.id, status: "retained", openCall: { event: { startsAt: { gte: now } } } }, include: { openCall: { include: { event: { include: { organization: { select: { name: true } } } } } } } })
      : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const items = [...talks.flatMap((a) => (a.openCall.event ? [{ e: a.openCall.event, talk: true }] : [])), ...regs.map((r) => ({ e: r.event, talk: false }))].filter(({ e }) => !seen.has(e.id) && !!seen.add(e.id));
  // Lien de connexion des événements en ligne : réservé aux inscrits (pas aux seuls intervenants retenus).
  const registered = new Set(regs.map((r) => r.eventId));
  return icsResponse("kolbase-mon-agenda.ics", toIcs(t("KolBase — mon agenda"), items.map(({ e, talk }) => {
    const link = registered.has(e.id) ? joinUrl(e) : null;
    const location = eventLocation(e);
    return {
      uid: `${e.id}-${user.id}`, start: e.startsAt, minutes: e.durationMinutes, title: talk ? t("Intervention : {title}", { title: e.title }) : e.title,
      location: link && e.format === "DISTANCIEL" ? link : location && t(location),
      description: [t("Organisé par {org}.", { org: e.organization.name }), link ? t("Lien de connexion : {url}", { url: link }) : null].filter(Boolean).join("\n\n"),
      url: `${appUrl()}/evenements/${e.id}`,
    };
  })));
}
