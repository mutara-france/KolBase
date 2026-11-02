import { requireUser } from "@/lib/auth";
import { loadCollabConvention } from "@/lib/convention-data";
import { buildCollaborationConvention, pdfResponse } from "@/lib/convention-pdf";
import { isLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export async function GET(req: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const user = await requireUser();
  const data = await loadCollabConvention(linkId, { expertUserId: user.id });
  if (!data) return new Response("Convention indisponible.", { status: 404 });
  // ?lang=en : traduction anglaise de courtoisie (la version française fait foi).
  const lang = new URL(req.url).searchParams.get("lang");
  const locale = isLocale(lang) ? lang : await getLocale();
  return pdfResponse(await buildCollaborationConvention(data, locale), `convention-${data.ref}${locale === "fr" ? "" : "-en"}.pdf`);
}
