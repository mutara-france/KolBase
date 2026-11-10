import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { EVENT_ORGANIZER_ROLES } from "@/lib/events";
import { getObject } from "@/lib/storage";
import { rfqConflict } from "@/lib/suppliers";
import { hasMemberRole, memberRoles } from "@/lib/org-roles";

/** PDF joint à un devis : visible du prestataire qui l'a envoyé et de l'équipe événements de l'organisation qui l'a demandé. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ?facture=1 : la facture déposée par le prestataire retenu, mêmes droits que le devis.
  const invoice = new URL(req.url).searchParams.get("facture") === "1";
  const user = await requireUser();
  const q = await db.quote.findUnique({ where: { id }, include: { rfq: { select: { organizationId: true, event: { select: { agencyId: true } }, suppliers: { select: { supplierId: true } } } } } });
  const supplier = !!q && hasMemberRole(user, q.supplierId);
  // Équipe de l'organisation, ou agence mandatée sur l'événement concerné (même périmètre que la page des devis).
  const team = !!q && hasMemberRole(user, q.rfq.organizationId, EVENT_ORGANIZER_ROLES);
  // Sauf si l'agence est elle-même consultée sur la demande : elle ne voit pas les devis de ses concurrents.
  const agency = !!q?.rfq.event?.agencyId && hasMemberRole(user, q.rfq.event.agencyId) && memberRoles(user, q.rfq.organizationId).includes("PRESTATAIRE")
    && !rfqConflict(q.rfq.suppliers.map((s) => s.supplierId), user.memberships.filter((m) => m.organization.kind === "PRESTATAIRE").map((m) => m.organizationId));
  const requester = team || agency;
  const key = invoice ? q?.invoiceKey : q?.fileKey;
  if (!q || !key || !(supplier || requester)) return new Response("Devis introuvable.", { status: 404 });
  const body = await getObject(key);
  const name = (invoice ? q.invoiceName : q.fileName) ?? (invoice ? "facture.pdf" : "devis.pdf");
  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(body.byteLength),
      // En pièce jointe et isolé : un fichier déposé par un tiers ne s'ouvre pas dans l'origine de KolBase.
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
