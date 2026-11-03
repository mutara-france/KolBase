"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { str } from "@/lib/form";
import { PROJECT_ROLES } from "@/lib/projects";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { ALLOWED_TYPES, deleteObject, MAX_UPLOAD_BYTES, putObject, safeFileName, storageEnabled } from "@/lib/storage";
import { getT } from "@/lib/i18n/server";
import { closeOpenSignatures } from "@/lib/signature";

export type ActionState = { error?: string; ok?: string } | undefined;
const ENGAGED = (s: string) => s !== "ATT_EXPERTS" && s !== "DECLINE";

/** Rôle de l'utilisateur sur un dossier : équipe de l'organisation (projets ou conformité), expert engagé, ou rien. */
async function access(projectId: string) {
  const user = await requireUser();
  const project = await db.project.findUnique({ where: { id: projectId }, include: { experts: { include: { practitioner: { select: { userId: true } } } } } });
  if (!project) return null;
  const orgRoles = user.memberships.filter((m) => m.organizationId === project.organizationId).map((m) => m.role);
  const team = orgRoles.some((r) => PROJECT_ROLES.includes(r) || COMPLIANCE_ROLES.includes(r));
  const ownLink = project.experts.find((e) => e.practitioner.userId === user.id && ENGAGED(e.status)) ?? null;
  return { user, project, team, ownLink };
}

const refresh = (orgId: string, projectId: string, linkId?: string | null) => {
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  if (linkId) revalidatePath(`/sollicitations/${linkId}`);
};

/** Dépôt d'une pièce (ou de la convention signée d'un expert) dans le dossier. */
export async function uploadDocument(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  if (!storageEnabled()) return { error: t("Le dépôt de documents n'est pas encore activé (stockage non configuré).") };
  const a = await access(str(form, "projectId"));
  if (!a || (!a.team && !a.ownLink)) return { error: t("Accès refusé.") };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: t("Choisissez un fichier.") };
  if (file.size > MAX_UPLOAD_BYTES) return { error: t("Fichier trop lourd : 10 Mo au maximum.") };
  if (!(file.type in ALLOWED_TYPES)) return { error: t("Format non accepté : PDF, JPEG, PNG, Word, Excel ou PowerPoint.") };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === "application/pdf" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return { error: t("Ce fichier n'est pas un PDF valide.") };

  const kind = str(form, "kind") === "CONVENTION_SIGNEE" ? "CONVENTION_SIGNEE" : "PIECE";
  // Un expert dépose pour son propre lien ; l'organisation choisit l'expert concerné (obligatoire pour une convention).
  const linkId = a.ownLink && !a.team ? a.ownLink.id : str(form, "linkId") || null;
  const link = linkId ? a.project.experts.find((e) => e.id === linkId && ENGAGED(e.status)) : null;
  if (linkId && !link) return { error: t("Expert introuvable sur ce dossier.") };
  if (kind === "CONVENTION_SIGNEE" && !link) return { error: t("Indiquez l'expert signataire de la convention.") };

  const key = `dossiers/${a.project.id}/${randomBytes(8).toString("hex")}-${safeFileName(file.name)}`;
  await putObject(key, bytes, file.type);
  const doc = await db.document.create({
    data: { projectId: a.project.id, projectExpertId: link?.id ?? null, kind, name: file.name.slice(0, 200), contentType: file.type, size: file.size, storageKey: key, uploadedById: a.user.id },
  });
  await audit(a.user.id, kind === "CONVENTION_SIGNEE" ? "document.signed_convention" : "document.upload", "Project", a.project.id, { documentId: doc.id, name: doc.name, linkId: link?.id });
  // Convention signée déposée à la main : la demande de signature électronique encore en cours est close.
  if (kind === "CONVENTION_SIGNEE" && link) await closeOpenSignatures({ projectExpertId: link.id }, "convention signée déposée dans KolBase");
  refresh(a.project.organizationId, a.project.id, link?.id);
  return { ok: kind === "CONVENTION_SIGNEE" ? t("Convention signée déposée.") : t("Document déposé.") };
}

/** Retrait d'un document : l'équipe du dossier ou son auteur ; une convention signée d'un dossier signé reste archivée. */
export async function deleteDocument(form: FormData) {
  const doc = await db.document.findUnique({ where: { id: str(form, "documentId") } });
  if (!doc) return;
  const a = await access(doc.projectId);
  if (!a || !(a.team || doc.uploadedById === a.user.id)) return;
  if (doc.kind === "CONVENTION_SIGNEE" && ["SIGNE", "TERMINE"].includes(a.project.status)) return;
  await db.document.delete({ where: { id: doc.id } });
  await deleteObject(doc.storageKey).catch((e) => console.error("[stockage] suppression impossible", doc.storageKey, e));
  await audit(a.user.id, "document.delete", "Project", doc.projectId, { documentId: doc.id, name: doc.name });
  refresh(a.project.organizationId, a.project.id, doc.projectExpertId);
}
