import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";
import { isBot, SOURCE_COOKIE, SOURCE_COOKIE_DAYS } from "@/lib/services";

/**
 * Lien suivi d'un service KolBase (e-mailing, post, mise à la une) : compte la visite (visiteur pseudonyme, sans
 * adresse IP conservée), pose un cookie d'attribution de 30 jours puis renvoie vers la page publique de l'événement.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  const order = /^[A-Za-z0-9_-]{6,16}$/.test(code)
    ? await db.serviceOrder.findUnique({ where: { trackCode: code }, select: { id: true, eventId: true, status: true } })
    : null;
  if (!order) return NextResponse.redirect(new URL("/evenements", base), 302);
  const res = NextResponse.redirect(new URL(`/evenements/${order.eventId}`, base), 302);
  const ua = req.headers.get("user-agent") ?? "";
  // Préchargements et robots (aperçus de liens, antivirus des messageries) : ni visite ni cookie.
  const prefetch = req.headers.get("next-router-prefetch") || req.headers.get("purpose") === "prefetch" || req.headers.get("sec-purpose")?.includes("prefetch");
  if (prefetch || isBot(ua) || ["refusee", "annulee"].includes(order.status)) return res;
  const visitor = createHash("sha256").update(`${await clientIp()}|${ua}|${order.id}`).digest("hex").slice(0, 24);
  await db.serviceClick.create({ data: { orderId: order.id, visitor } }).catch((e) => console.error("[lien suivi]", e));
  res.cookies.set(SOURCE_COOKIE, order.id, { maxAge: SOURCE_COOKIE_DAYS * 86400, httpOnly: true, sameSite: "lax", secure: base.startsWith("https"), path: "/" });
  return res;
}
