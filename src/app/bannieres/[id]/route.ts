import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";
import { hasMemberRole } from "@/lib/org-roles";
import { LOGO_TYPES } from "@/lib/logos";

/** Bannière de la page d'un prestataire : publique si l'organisation est validée et référencée, sinon réservée à ses membres. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const banner = await db.organizationBanner.findUnique({ where: { organizationId: id }, include: { organization: { select: { verification: true, listed: true } } } });
  if (!banner || !(LOGO_TYPES as readonly string[]).includes(banner.contentType)) return new Response("Bannière introuvable.", { status: 404 });
  const open = banner.organization.verification === "VERIFIED" && banner.organization.listed;
  if (!open) {
    const user = await getCurrentUser();
    // hasMemberRole : un membre d'une organisation qui exige la double authentification ne voit rien tant qu'il ne l'a pas activée.
    if (!user || !(hasMemberRole(user, id) || isPlatformAdmin(user))) return new Response("Bannière introuvable.", { status: 404 });
  }
  return new Response(Buffer.from(banner.data), {
    headers: {
      "Content-Type": banner.contentType,
      "Content-Length": String(banner.data.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // L'URL porte la date de mise à jour (?v=…) : mise en cache longue sans risque d'image périmée.
      "Cache-Control": open ? "public, max-age=86400, stale-while-revalidate=604800" : "private, no-store",
    },
  });
}
