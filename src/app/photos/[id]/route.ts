import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";
import { LOGO_TYPES } from "@/lib/logos";

/** Photo du book d'un prestataire : publique si l'organisation est validée et référencée, sinon réservée à ses membres. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = await db.organizationPhoto.findUnique({ where: { id }, include: { organization: { select: { id: true, verification: true, listed: true } } } });
  if (!photo || !(LOGO_TYPES as readonly string[]).includes(photo.contentType)) return new Response("Photo introuvable.", { status: 404 });
  const open = photo.organization.verification === "VERIFIED" && photo.organization.listed;
  if (!open) {
    const user = await getCurrentUser();
    if (!user || !(user.memberships.some((m) => m.organizationId === photo.organization.id) || isPlatformAdmin(user))) return new Response("Photo introuvable.", { status: 404 });
  }
  return new Response(Buffer.from(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.data.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": open ? "public, max-age=86400, stale-while-revalidate=604800" : "private, no-store",
    },
  });
}
