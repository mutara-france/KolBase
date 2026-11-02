import { requireMembership } from "@/lib/orgs";
import { PROJECT_VIEW_ROLES } from "@/lib/projects";
import { loadCollabConvention } from "@/lib/convention-data";
import { buildCollaborationConvention, pdfResponse } from "@/lib/convention-pdf";
import { isLocale } from "@/lib/i18n";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await params;
  await requireMembership(id, PROJECT_VIEW_ROLES);
  const data = await loadCollabConvention(linkId, { organizationId: id });
  if (!data) return new Response("Convention indisponible (l'expert n'a pas donné son accord).", { status: 404 });
  // ?lang=en : traduction anglaise de courtoisie (la version française fait foi).
  const lang = new URL(req.url).searchParams.get("lang");
  const locale = isLocale(lang) ? lang : "fr";
  return pdfResponse(await buildCollaborationConvention(data, locale), `convention-${data.ref}${locale === "fr" ? "" : "-en"}.pdf`);
}
