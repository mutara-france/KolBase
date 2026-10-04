import { db } from "@/lib/db";
import { appUrl, eventLocation, icsResponse, toIcs } from "@/lib/ics";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await db.event.findFirst({ where: { id, publishedAt: { not: null } }, include: { organization: { select: { name: true } } } });
  if (!e) return new Response("Événement introuvable", { status: 404 });
  return icsResponse(`kolbase-${e.id}.ics`, toIcs(e.title, [{
    uid: e.id, start: e.startsAt, minutes: e.durationMinutes, title: e.title, location: eventLocation(e),
    description: `Organisé par ${e.organization.name}.`, url: `${appUrl()}/evenements/${e.id}`,
  }]));
}
