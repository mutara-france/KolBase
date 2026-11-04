import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { appUrl, eventLocation, icsResponse, joinUrl, toIcs } from "@/lib/ics";
import { getT } from "@/lib/i18n/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const e = await db.event.findFirst({ where: { id, publishedAt: { not: null }, organization: { verification: "VERIFIED" } }, include: { organization: { select: { name: true } } } });
  if (!e) return new Response(t("Événement introuvable"), { status: 404 });
  const location = eventLocation(e);
  // Le lien de connexion n'est donné qu'à une personne inscrite.
  const user = await getCurrentUser();
  const registered = !!user && !!(await db.registration.findUnique({ where: { eventId_userId: { eventId: id, userId: user.id } }, select: { id: true } }));
  const link = registered ? joinUrl(e) : null;
  return icsResponse(`kolbase-${e.id}.ics`, toIcs(e.title, [{
    uid: e.id, start: e.startsAt, minutes: e.durationMinutes, title: e.title, location: link && e.format === "DISTANCIEL" ? link : location && t(location),
    description: [t("Organisé par {name}.", { name: e.organization.name }), link ? t("Lien de connexion : {url}", { url: link }) : null].filter(Boolean).join("\n\n"),
    url: `${appUrl()}/evenements/${e.id}`,
  }]));
}
