import { requireUser } from "@/lib/auth";
import { loadCollabConvention } from "@/lib/convention-data";
import { buildCollaborationConvention, pdfResponse } from "@/lib/convention-pdf";

export async function GET(_: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const user = await requireUser();
  const data = await loadCollabConvention(linkId, { expertUserId: user.id });
  if (!data) return new Response("Convention indisponible.", { status: 404 });
  return pdfResponse(await buildCollaborationConvention(data), `convention-${data.ref}.pdf`);
}
