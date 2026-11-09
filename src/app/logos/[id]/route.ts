import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";
import { hasMemberRole } from "@/lib/org-roles";
import { LOGO_TYPES } from "@/lib/logos";

/**
 * Logo d'une organisation. Public une fois l'organisation validée ; avant cela, visible seulement
 * de ses membres et de l'équipe KolBase (personne ne peut afficher la marque d'un tiers sans contrôle).
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const logo = await db.organizationLogo.findUnique({ where: { organizationId: id }, include: { organization: { select: { verification: true } } } });
  if (!logo || !(LOGO_TYPES as readonly string[]).includes(logo.contentType)) return new Response("Logo introuvable.", { status: 404 });
  const verified = logo.organization.verification === "VERIFIED";
  if (!verified) {
    const user = await getCurrentUser();
    // hasMemberRole : un membre d'une organisation qui exige la double authentification ne voit rien tant qu'il ne l'a pas activée.
    const allowed = !!user && (hasMemberRole(user, id) || isPlatformAdmin(user));
    if (!allowed) return new Response("Logo introuvable.", { status: 404 });
  }
  return new Response(Buffer.from(logo.data), {
    headers: {
      "Content-Type": logo.contentType,
      "Content-Length": String(logo.data.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // L'URL porte la date de mise à jour (?v=…) : mise en cache longue sans risque d'image périmée.
      "Cache-Control": verified ? "public, max-age=86400, stale-while-revalidate=604800" : "private, no-store",
    },
  });
}
