import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { loadHospitalityConvention } from "@/lib/convention-data";
import { buildHospitalityConvention, pdfResponse } from "@/lib/convention-pdf";
import { isLocale } from "@/lib/i18n";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; registrationId: string }> }) {
  const { id, registrationId } = await params;
  await requireMembership(id, COMPLIANCE_ROLES);
  const data = await loadHospitalityConvention(registrationId, id);
  if (!data) return new Response("Convention indisponible.", { status: 404 });
  const lang = new URL(req.url).searchParams.get("lang");
  const locale = isLocale(lang) ? lang : "fr";
  return pdfResponse(await buildHospitalityConvention(data, locale), `hospitalite-${data.ref}${locale === "fr" ? "" : "-en"}.pdf`);
}
