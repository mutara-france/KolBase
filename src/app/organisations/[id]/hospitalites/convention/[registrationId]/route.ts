import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { loadHospitalityConvention } from "@/lib/convention-data";
import { buildHospitalityConvention, pdfResponse } from "@/lib/convention-pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; registrationId: string }> }) {
  const { id, registrationId } = await params;
  await requireMembership(id, COMPLIANCE_ROLES);
  const data = await loadHospitalityConvention(registrationId, id);
  if (!data) return new Response("Convention indisponible.", { status: 404 });
  return pdfResponse(await buildHospitalityConvention(data), `hospitalite-${data.ref}.pdf`);
}
