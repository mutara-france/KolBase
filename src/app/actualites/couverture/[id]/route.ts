import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/platform";
import { LOGO_TYPES } from "@/lib/logos";

/** Image d'une actualité : publique une fois l'article publié, sinon réservée à l'équipe KolBase. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await db.article.findUnique({ where: { id }, select: { coverData: true, coverType: true, publishedAt: true } });
  if (!a?.coverData || !a.coverType || !(LOGO_TYPES as readonly string[]).includes(a.coverType)) return new Response("Image introuvable.", { status: 404 });
  if (!a.publishedAt) {
    const user = await getCurrentUser();
    if (!user || !isPlatformAdmin(user)) return new Response("Image introuvable.", { status: 404 });
  }
  return new Response(Buffer.from(a.coverData), {
    headers: {
      "Content-Type": a.coverType,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": a.publishedAt ? "public, max-age=86400" : "private, no-store",
    },
  });
}
