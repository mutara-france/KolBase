import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pdfResponse } from "@/lib/convention-pdf";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { feeNotePdf, type FeeNoteData } from "@/lib/fee-notes";
import { PROJECT_VIEW_ROLES } from "@/lib/projects";

/** Note d'honoraires (PDF) : l'expert qui l'a émise, ou l'organisation destinataire (projets, conformité). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const note = user ? await db.feeNote.findUnique({ where: { id } }) : null;
  const allowed =
    !!note && !!user &&
    (user.practitioner?.id === note.practitionerId ||
      user.memberships.some((m) => m.organizationId === note.organizationId && [...PROJECT_VIEW_ROLES, ...COMPLIANCE_ROLES].includes(m.role)));
  if (!note || !allowed) return new Response("Introuvable.", { status: 404 });
  const bytes = await feeNotePdf({ ...note, data: note.data as unknown as FeeNoteData });
  return pdfResponse(bytes, `note-honoraires-${note.number}.pdf`);
}
