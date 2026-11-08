import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { eventIcsEntry, icsResponse, toIcs } from "@/lib/ics";
import { getT } from "@/lib/i18n/server";
import { canSeeInviteOnly } from "@/lib/event-invites";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await getT();
  const e = await db.event.findFirst({ where: { id, publishedAt: { not: null }, organization: { verification: "VERIFIED" } }, include: { organization: { select: { name: true } } } });
  if (!e) return new Response(t("Événement introuvable"), { status: 404 });
  // Le lien de connexion n'est donné qu'à une personne inscrite.
  const user = await getCurrentUser();
  if (e.inviteOnly && !(await canSeeInviteOnly(e, user))) return new Response(t("Événement introuvable"), { status: 404 });
  const registered = !!user && !!(await db.registration.findUnique({ where: { eventId_userId: { eventId: id, userId: user.id } }, select: { id: true } }));
  return icsResponse(`kolbase-${e.id}.ics`, toIcs(e.title, [eventIcsEntry(e, e.organization.name, registered, t)]));
}
