import { db } from "@/lib/db";

/** Désinscription en un clic (en-tête List-Unsubscribe-Post des messageries, RFC 8058). */
export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return new Response(null, { status: 404 });
  const u = await db.user.findUnique({ where: { unsubscribeToken: token }, select: { id: true, notifyPrefs: true } });
  if (!u) return new Response(null, { status: 404 });
  const prefs = u.notifyPrefs && typeof u.notifyPrefs === "object" ? (u.notifyPrefs as Record<string, unknown>) : {};
  await db.user.update({ where: { id: u.id }, data: { notifyPrefs: { ...prefs, newsletter: false, newsletterAsked: true } } });
  await db.auditLog.create({ data: { actorId: u.id, action: "user.newsletter_off", entityType: "User", entityId: u.id, data: { via: "one-click" } } });
  return new Response(null, { status: 200 });
}
