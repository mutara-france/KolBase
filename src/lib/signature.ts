import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/auth";
import { conventionRef } from "@/lib/convention-data";
import { putObject, storageEnabled } from "@/lib/storage";
import { canApplyStatus, cancelSignatureRequest, downloadSignedDocument, getSignatureRequest, signatureEnabled, signatureOpen } from "@/lib/yousign";
import type { ConventionSignature, SignatureStatus } from "@/generated/prisma/client";

type Sig = ConventionSignature & { projectExpert: { projectId: string } };

/** Identifiant provisoire d'une demande en cours de création (verrou contre les doubles envois). */
export const PENDING_PREFIX = "envoi-";
export const isPendingRequest = (requestId: string) => requestId.startsWith(PENDING_PREFIX);

/** Clé de stockage de la convention signée électroniquement (unique : un seul dépôt par demande). */
export const signedConventionKey = (projectId: string, requestId: string) => `dossiers/${projectId}/signature-${requestId}.pdf`;
export const signedConventionName = (projectId: string, linkId: string) => `convention-signee-${conventionRef(projectId, linkId)}.pdf`;

/** Avec le stockage configuré, la convention signée rejoint les documents du dossier (sans doublon si l'événement est rejoué). */
async function storeSignedConvention(sig: Sig) {
  const projectId = sig.projectExpert.projectId;
  const key = signedConventionKey(projectId, sig.requestId);
  if (await db.document.findUnique({ where: { storageKey: key }, select: { id: true } })) return;
  const pdf = await downloadSignedDocument(sig.requestId, sig.documentId);
  await putObject(key, pdf, "application/pdf");
  await db.document
    .create({
      data: {
        projectId, projectExpertId: sig.projectExpertId, kind: "CONVENTION_SIGNEE", name: signedConventionName(projectId, sig.projectExpertId),
        contentType: "application/pdf", size: pdf.byteLength, storageKey: key, uploadedById: null,
      },
    })
    .catch((e: { code?: string }) => {
      if (e?.code !== "P2002") throw e; // déjà enregistrée par un traitement concurrent
    });
}

/**
 * Applique un nouveau statut (webhook ou interrogation de l'API). Idempotent : une demande signée ne change plus,
 * et la convention signée n'est enregistrée qu'une fois. Renvoie true si le statut a changé.
 */
export async function applySignatureStatus(sig: Sig, next: SignatureStatus, info: { completedAt?: Date | null; note?: string | null } = {}) {
  if (!canApplyStatus(sig.status, next)) return false;
  // Le PDF signé est récupéré avant de marquer la demande signée : en cas d'échec, un nouvel essai reste possible.
  if (next === "done" && storageEnabled()) await storeSignedConvention(sig);
  const { count } = await db.conventionSignature.updateMany({
    where: { id: sig.id, requestId: sig.requestId, status: { not: "done" } },
    data: {
      status: next,
      ...(next === "done" ? { completedAt: info.completedAt ?? new Date() } : {}),
      ...(next === "declined" ? { note: info.note ? info.note.slice(0, 500) : null } : {}),
    },
  });
  if (count > 0) await audit(null, `signature.${next}`, "ProjectExpert", sig.projectExpertId, { projectId: sig.projectExpert.projectId, requestId: sig.requestId });
  return count > 0;
}

/** Interroge l'API (sans webhook, ou pour rattraper un événement manqué) et applique le statut obtenu. */
export async function syncSignature(sig: Sig) {
  if (isPendingRequest(sig.requestId)) return sig.status;
  const r = await getSignatureRequest(sig.requestId);
  if (r.status) await applySignatureStatus(sig, r.status, { completedAt: r.completedAt, note: r.declineReason });
  return r.status ?? sig.status;
}

/**
 * Convention signée par un autre moyen (convention signée déposée, dossier passé « Signé ») ou dossier abandonné :
 * la demande de signature électronique encore ouverte est annulée chez Yousign (les signataires n'ont plus à signer)
 * ou, si l'annulation échoue, marquée caduque dans KolBase. Une demande en réalité déjà signée reprend son statut.
 */
export async function closeOpenSignatures(where: { projectExpertId: string } | { projectId: string }, why: string) {
  const open = await db.conventionSignature.findMany({
    where: { status: { in: ["ongoing", "draft"] }, ...("projectExpertId" in where ? { projectExpertId: where.projectExpertId } : { projectExpert: { projectId: where.projectId } }) },
    include: { projectExpert: { select: { projectId: true } } },
  });
  let closed = 0;
  for (const sig of open) {
    if (!signatureOpen(sig.status)) continue;
    let note = `Demande caduque : ${why}.`;
    if (sig.status === "ongoing" && signatureEnabled() && !isPendingRequest(sig.requestId)) {
      try {
        await cancelSignatureRequest(sig.requestId, `KolBase : ${why}.`);
        note = `Demande annulée : ${why}.`;
      } catch (e) {
        // Déjà close chez Yousign (signée, refusée…) : on reprend son statut réel ; sinon, caduque dans KolBase.
        const real = await syncSignature(sig).catch(() => null);
        if (real && !signatureOpen(real)) continue;
        console.error("[signature] annulation impossible, demande marquée caduque", sig.requestId, e);
      }
    }
    const { count } = await db.conventionSignature.updateMany({ where: { id: sig.id, status: { in: ["ongoing", "draft"] } }, data: { status: "canceled", note } });
    if (count) {
      closed++;
      await audit(null, "signature.closed", "ProjectExpert", sig.projectExpertId, { projectId: sig.projectExpert.projectId, requestId: sig.requestId, note });
    }
  }
  return closed;
}
