import { db } from "@/lib/db";
import { appUrl, eventLocation, icsResponse, toIcs } from "@/lib/ics";
import { getT } from "@/lib/i18n/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const e = await db.event.findFirst({ where: { id, publishedAt: { not: null }, organization: { verification: "VERIFIED" } }, include: { organization: { select: { name: true } } } });
  if (!e) return new Response(t("Événement introuvable"), { status: 404 });
  const location = eventLocation(e);
  return icsResponse(`kolbase-${e.id}.ics`, toIcs(e.title, [{
    uid: e.id, start: e.startsAt, minutes: e.durationMinutes, title: e.title, location: location && t(location),
    description: t("Organisé par {name}.", { name: e.organization.name }), url: `${appUrl()}/evenements/${e.id}`,
  }]));
}
