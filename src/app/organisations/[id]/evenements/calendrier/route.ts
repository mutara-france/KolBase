import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventScope } from "@/lib/events";
import { appUrl, eventLocation, icsResponse, toIcs } from "@/lib/ics";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, user, roles } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const events = await db.event.findMany({ where: { organizationId: id, ...eventScope(user, roles), startsAt: { gte: new Date(Date.now() - 90 * 864e5) } }, include: { _count: { select: { registrations: true } } }, orderBy: { startsAt: "asc" } });
  return icsResponse(`kolbase-${id}.ics`, toIcs(`${org.name} — événements`, events.map((e) => ({
    uid: e.id, start: e.startsAt, minutes: e.durationMinutes, title: `${e.publishedAt ? "" : "[Brouillon] "}${e.title}`, location: eventLocation(e),
    description: `${e._count.registrations} inscrit(s)${e.capacity ? ` sur ${e.capacity}` : ""}.`, url: `${appUrl()}/organisations/${id}/evenements/${e.id}`,
  }))));
}
