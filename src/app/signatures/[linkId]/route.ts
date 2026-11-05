import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PROJECT_VIEW_ROLES } from "@/lib/projects";
import { hasMemberRole } from "@/lib/org-roles";
import { getObject, storageEnabled } from "@/lib/storage";
import { signedConventionKey, signedConventionName } from "@/lib/signature";
import { downloadSignedDocument, signatureEnabled } from "@/lib/yousign";

/**
 * Convention signée électroniquement d'un expert : depuis le stockage si elle y a été déposée, sinon directement
 * chez Yousign. Accès : équipe de l'organisation (lecture des dossiers) ou expert concerné, comme les conventions.
 */
export async function GET(_: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const user = await requireUser();
  const link = await db.projectExpert.findUnique({
    where: { id: linkId },
    include: { project: { select: { organizationId: true } }, practitioner: { select: { userId: true } }, signature: true },
  });
  const team = !!link && hasMemberRole(user, link.project.organizationId, PROJECT_VIEW_ROLES);
  const expert = !!link && link.practitioner.userId === user.id;
  const sig = link?.signature;
  if (!link || !(team || expert) || !sig || sig.status !== "done") return new Response("Convention signée introuvable.", { status: 404 });

  let pdf: Uint8Array;
  try {
    const key = signedConventionKey(link.projectId, sig.requestId);
    const stored = storageEnabled() ? await db.document.findUnique({ where: { storageKey: key }, select: { id: true } }) : null;
    if (stored) pdf = await getObject(key);
    else if (signatureEnabled()) pdf = await downloadSignedDocument(sig.requestId, sig.documentId);
    else return new Response("Convention signée indisponible : la signature électronique n'est plus configurée.", { status: 404 });
  } catch (e) {
    console.error("[signature] téléchargement impossible", sig.requestId, e);
    return new Response("Convention signée momentanément indisponible. Réessayez dans quelques minutes.", { status: 502 });
  }
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${signedConventionName(link.projectId, link.id)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
