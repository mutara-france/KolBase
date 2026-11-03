import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { attestableRegistrations, attestationPdf } from "@/lib/attestation-pdf";
import { canCheckIn } from "@/lib/checkin";
import { pdfResponse } from "@/lib/convention-pdf";

/** Attestations de présence de l'événement (toutes, ou ?inscription=<id>) : organisateur ou agence mandatée. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const user = await getCurrentUser();
  const event = await db.event.findFirst({ where: { id: eventId, organizationId: id }, select: { id: true, organizationId: true, agencyId: true, startsAt: true } });
  if (!user || !event || !canCheckIn(user, event)) return new Response("Introuvable.", { status: 404 });
  const one = new URL(req.url).searchParams.get("inscription");
  const regs = await attestableRegistrations({ eventId, ...(one ? { id: one } : {}) });
  if (regs.length === 0) return new Response("Aucun participant pointé : pas d'attestation à éditer.", { status: 404 });
  return pdfResponse(await attestationPdf(regs), `attestations-${event.startsAt.toISOString().slice(0, 10)}.pdf`);
}
