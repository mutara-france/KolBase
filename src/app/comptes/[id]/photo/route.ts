import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";
import { memberRoles } from "@/lib/org-roles";

/**
 * Photo d'un compte sans profil praticien (vignette WebP) : visible de la personne, des membres d'une organisation
 * dont elle est membre, et de l'équipe KolBase. Jamais publique.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) return new Response("Photo introuvable.", { status: 404 });
  const allowed =
    viewer.id === id ||
    isPlatformAdmin(viewer) ||
    // Organisations où le lecteur a effectivement accès (memberRoles : pas celles qui exigent une double authentification
    // qu'il n'a pas activée).
    !!(await db.membership.findFirst({ where: { userId: id, organizationId: { in: viewer.memberships.map((m) => m.organizationId).filter((o) => memberRoles(viewer, o).length > 0) } }, select: { id: true } }));
  const photo = allowed ? await db.userPhoto.findUnique({ where: { userId: id }, select: { thumb: true } }) : null;
  if (!photo) return new Response("Photo introuvable.", { status: 404 });
  return new Response(Buffer.from(photo.thumb), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(photo.thumb.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
