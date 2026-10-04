import { requireMembership } from "@/lib/orgs";
import { PROJECT_VIEW_ROLES } from "@/lib/projects";
import { loadCollabConvention } from "@/lib/convention-data";
import { buildCollaborationConvention, pdfResponse } from "@/lib/convention-pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await params;
  await requireMembership(id, PROJECT_VIEW_ROLES);
  const data = await loadCollabConvention(linkId, { organizationId: id });
  if (!data) return new Response("Convention indisponible (l'expert n'a pas donné son accord).", { status: 404 });
  return pdfResponse(await buildCollaborationConvention(data), `convention-${data.ref}.pdf`);
}
