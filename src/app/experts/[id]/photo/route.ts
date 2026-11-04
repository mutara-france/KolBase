import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";
import { drPrefix } from "@/lib/professions";
import { canSee, kolViewer, kolVisibility } from "@/lib/visibility";

/**
 * Photo d'un praticien (vignette, ou grand format avec ?taille=grande), selon son réglage « Photo » : publique, réservée
 * aux organisations ou masquée. Le praticien et l'équipe KolBase la voient toujours ; un expert retiré de l'annuaire
 * n'a plus de photo visible des autres.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const large = new URL(req.url).searchParams.get("taille") === "grande";
  const [p, bytes] = await Promise.all([
    db.practitionerProfile.findUnique({ where: { id }, select: { id: true, listed: true, visibility: true, profession: true, user: { select: { firstName: true, lastName: true } } } }),
    // Une seule des deux images est lue.
    large
      ? db.practitionerPhoto.findUnique({ where: { practitionerId: id }, select: { data: true } }).then((r) => r?.data ?? null)
      : db.practitionerPhoto.findUnique({ where: { practitionerId: id }, select: { thumb: true } }).then((r) => r?.thumb ?? null),
  ]);
  if (!p || !bytes) return new Response("Photo introuvable.", { status: 404 });
  const level = kolVisibility(p.visibility).photo;
  const open = p.listed && level === "public";
  if (!open) {
    const user = await getCurrentUser();
    const viewer = kolViewer(user, id);
    const allowed = viewer === "proprietaire" || isPlatformAdmin(user) || (p.listed && canSee(level, viewer));
    if (!allowed) return new Response("Photo introuvable.", { status: 404 });
  }
  const file = `${drPrefix(p.profession)}${p.user.firstName} ${p.user.lastName}`.normalize("NFD").replace(/[^\w -]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "photo";
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": large ? "image/jpeg" : "image/webp",
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...(large ? { "Content-Disposition": `inline; filename="${file}.jpg"` } : {}),
      // L'adresse porte la date de mise à jour (?v=…) : cache long sans risque d'image périmée.
      "Cache-Control": open ? "public, max-age=86400, stale-while-revalidate=604800" : "private, no-store",
    },
  });
}
