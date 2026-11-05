import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PROJECT_VIEW_ROLES } from "@/lib/projects";
import { hasMemberRole } from "@/lib/org-roles";
import { getObject } from "@/lib/storage";

/** Téléchargement d'un document de dossier, après contrôle des droits (le stockage n'est jamais exposé). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const doc = await db.document.findUnique({ where: { id }, include: { project: { select: { organizationId: true } }, projectExpert: { include: { practitioner: { select: { userId: true } } } } } });
  const team = !!doc && hasMemberRole(user, doc.project.organizationId, PROJECT_VIEW_ROLES);
  const expert = !!doc?.projectExpert && doc.projectExpert.practitioner.userId === user.id;
  if (!doc || !(team || expert)) return new Response("Document introuvable.", { status: 404 });
  const body = await getObject(doc.storageKey);
  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename="${doc.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
