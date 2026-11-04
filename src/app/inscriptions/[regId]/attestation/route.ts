import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { attestableRegistrations, attestationPdf } from "@/lib/attestation-pdf";
import { pdfResponse } from "@/lib/convention-pdf";
import { eventEnded } from "@/lib/events";

/** Attestation de présence du participant connecté (présent au pointage). */
export async function GET(_: Request, { params }: { params: Promise<{ regId: string }> }) {
  const { regId } = await params;
  const user = await getCurrentUser();
  const reg = user ? await db.registration.findFirst({ where: { id: regId, userId: user.id }, select: { eventId: true } }) : null;
  const regs = reg ? await attestableRegistrations({ eventId: reg.eventId, id: regId, userId: user!.id }) : [];
  if (regs.length === 0) return new Response("Attestation indisponible : présence non enregistrée.", { status: 404 });
  if (!eventEnded(regs[0].event)) return new Response("Attestation disponible après la fin de l'événement.", { status: 404 });
  return pdfResponse(await attestationPdf(regs), `attestation-presence-${regs[0].event.startsAt.toISOString().slice(0, 10)}.pdf`);
}
