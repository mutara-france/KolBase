"use server";

import { getT } from "@/lib/i18n/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit, requireUser } from "@/lib/auth";
import { requireMembership } from "@/lib/orgs";
import { str } from "@/lib/form";
import { PROJECT_ROLES, PROJECT_VIEW_ROLES } from "@/lib/projects";
import { loadCollabConvention } from "@/lib/convention-data";
import { buildCollaborationConventionForSignature } from "@/lib/convention-pdf";
import { canSendAgain, createSignatureRequest, SIGNATURE_LABEL, signatureEnabled, YousignError } from "@/lib/yousign";
import { isPendingRequest, PENDING_PREFIX, syncSignature } from "@/lib/signature";

export type ActionState = { error?: string; ok?: string } | undefined;
const ENGAGED = (s: string) => s !== "ATT_EXPERTS" && s !== "DECLINE";

const refresh = (orgId: string, projectId: string, linkId: string) => {
  revalidatePath(`/organisations/${orgId}/dossiers/${projectId}`);
  revalidatePath(`/sollicitations/${linkId}`);
};

const failure = (e: unknown) => {
  if (e instanceof YousignError) {
    if (e.status === 401 || e.status === 403) return "Yousign refuse la clé d'API (YOUSIGN_API_KEY) : vérifiez la configuration.";
    return `Yousign a refusé la demande (${e.status}) : ${e.detail}`;
  }
  return "Le service de signature électronique est injoignable. Réessayez dans quelques minutes.";
};

/**
 * Envoi de la convention d'un expert en signature électronique (dossier « En signature ») : signataires, la personne
 * qui envoie (pour l'organisation) et l'expert, à l'adresse de son compte. Yousign leur écrit à tous deux.
 */
export async function sendConventionForSignature(_: ActionState, form: FormData): Promise<ActionState> {
  const { t } = await getT();
  const orgId = str(form, "orgId");
  const linkId = str(form, "linkId");
  if (!signatureEnabled()) return { error: t("La signature électronique n'est pas configurée.") };
  const { user } = await requireMembership(orgId, PROJECT_ROLES);
  const link = await db.projectExpert.findFirst({ where: { id: linkId, project: { organizationId: orgId } }, include: { project: true, signature: true } });
  if (!link || !ENGAGED(link.status)) return { error: t("Expert introuvable sur ce dossier.") };
  if (link.project.status !== "SIGNATURE") return { error: t("La convention s'envoie en signature quand le dossier est « En signature ».") };
  if (!canSendAgain(link.signature?.status)) return { error: link.signature?.status === "done" ? t("Cette convention est déjà signée.") : t("Une demande de signature est déjà en cours pour cet expert.") };
  // Envoi lancé par quelqu'un d'autre il y a moins de deux minutes (ni abouti ni en échec) : on ne le double pas.
  const s = link.signature;
  if (s?.status === "draft" && isPendingRequest(s.requestId) && !s.note && Date.now() - s.updatedAt.getTime() < 120_000)
    return { error: t("Un envoi en signature est déjà en cours pour cet expert. Réessayez dans quelques instants.") };
  const data = await loadCollabConvention(link.id, { organizationId: orgId });
  if (!data) return { error: t("Convention indisponible.") };
  if (data.expert.email.toLowerCase() === user.email.toLowerCase()) return { error: t("L'expert ne peut pas signer aussi pour l'organisation.") };

  // Verrou : une seule demande à la fois par expert (double clic, deux membres de l'équipe en même temps).
  const placeholder = `${PENDING_PREFIX}${link.id}`;
  const locked = link.signature
    ? (await db.conventionSignature.updateMany({
        where: { id: link.signature.id, updatedAt: link.signature.updatedAt, status: { notIn: ["ongoing", "done"] } },
        data: { requestId: placeholder, documentId: null, status: "draft", note: null, completedAt: null, sentAt: null, sentById: user.id },
      })).count === 1
    : await db.conventionSignature.create({ data: { projectExpertId: link.id, requestId: placeholder, status: "draft", sentById: user.id } }).then(() => true, () => false);
  if (!locked) return { error: t("Une demande de signature est déjà en cours d'envoi pour cet expert.") };

  try {
    const { bytes, boxes } = await buildCollaborationConventionForSignature(data);
    const [orgBox, expertBox] = boxes;
    const r = await createSignatureRequest({
      name: `Convention ${data.ref} - ${data.project.title}`,
      externalId: link.id,
      filename: `convention-${data.ref}.pdf`,
      pdf: bytes,
      signers: [
        { firstName: user.firstName, lastName: user.lastName, email: user.email, box: orgBox, locale: user.locale },
        { firstName: data.expert.firstName, lastName: data.expert.lastName, email: data.expert.email, box: expertBox, locale: data.expertLocale },
      ],
    });
    await db.conventionSignature.update({
      where: { projectExpertId: link.id },
      data: { requestId: r.requestId, documentId: r.documentId, status: r.status, sentAt: new Date(), sentById: user.id },
    });
    await audit(user.id, "signature.send", "ProjectExpert", link.id, { projectId: link.projectId, requestId: r.requestId });
  } catch (e) {
    console.error("[signature] envoi impossible", e);
    await db.conventionSignature.update({ where: { projectExpertId: link.id }, data: { note: "Échec de l'envoi" } }).catch(() => {});
    refresh(orgId, link.projectId, link.id);
    return { error: failure(e) };
  }
  refresh(orgId, link.projectId, link.id);
  return { ok: t("Convention envoyée : Yousign a écrit à {email} et à {email2} pour la signer.", { email: user.email, email2: data.expert.email }) };
}

/** « Mettre à jour le statut » : interroge Yousign (sans webhook, ou pour rattraper un événement manqué). */
export async function refreshSignatureStatus(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const link = await db.projectExpert.findUnique({
    where: { id: str(form, "linkId") },
    include: { project: { select: { id: true, organizationId: true } }, practitioner: { select: { userId: true } }, signature: true },
  });
  const team = !!link && user.memberships.some((m) => m.organizationId === link.project.organizationId && PROJECT_VIEW_ROLES.includes(m.role));
  const expert = !!link && link.practitioner.userId === user.id;
  const { t } = await getT();
  if (!link || !(team || expert) || !link.signature) return { error: t("Demande de signature introuvable.") };
  if (!signatureEnabled()) return { error: t("La signature électronique n'est pas configurée.") };
  if (isPendingRequest(link.signature.requestId)) return { error: t("L'envoi n'a pas abouti : envoyez de nouveau la convention.") };
  try {
    const status = await syncSignature({ ...link.signature, projectExpert: { projectId: link.projectId } });
    refresh(link.project.organizationId, link.projectId, link.id);
    return { ok: t("Statut à jour : {statut}.", { statut: t(SIGNATURE_LABEL[status]).toLowerCase() }) };
  } catch (e) {
    console.error("[signature] statut indisponible", e);
    return { error: failure(e) };
  }
}
