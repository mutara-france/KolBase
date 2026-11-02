import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { EVENT_ORGANIZER_ROLES } from "@/lib/events";
import { getObject } from "@/lib/storage";

/** PDF joint à un devis : visible du prestataire qui l'a envoyé et de l'équipe événements de l'organisation qui l'a demandé. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const q = await db.quote.findUnique({ where: { id }, include: { rfq: { select: { organizationId: true, event: { select: { agencyId: true } } } } } });
  const supplier = !!q && user.memberships.some((m) => m.organizationId === q.supplierId);
  // Équipe de l'organisation, ou agence mandatée sur l'événement concerné (même périmètre que la page des devis).
  const team = !!q && user.memberships.some((m) => m.organizationId === q.rfq.organizationId && EVENT_ORGANIZER_ROLES.includes(m.role));
  const agency = !!q?.rfq.event?.agencyId && user.memberships.some((m) => m.organizationId === q.rfq.event!.agencyId) && user.memberships.some((m) => m.organizationId === q.rfq.organizationId && m.role === "PRESTATAIRE");
  const requester = team || agency;
  if (!q?.fileKey || !(supplier || requester)) return new Response("Devis introuvable.", { status: 404 });
  const body = await getObject(q.fileKey);
  const name = q.fileName ?? "devis.pdf";
  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
