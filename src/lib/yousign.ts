import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignatureStatus } from "@/generated/prisma/client";

/**
 * Signature électronique des conventions avec Yousign (API v3). Facultative : sans YOUSIGN_API_KEY, rien ne change.
 * Yousign (Youtrust depuis 2026) : la documentation développeurs redirige vers developers.youtrust.com, l'API reste sur api.yousign.app.
 * - URL de base et authentification (Authorization: Bearer) : https://developers.yousign.com/docs/set-up-your-account
 * - Parcours création → document → signataires → activation : https://developers.yousign.com/docs/create-your-first-signature-request
 * - Référence de l'API : https://developers.yousign.com/reference (post-signature_requests, …-documents, …-signers, …-activate)
 * - Webhooks (en-tête X-Yousign-Signature-256) : https://developers.yousign.com/docs/use-webhooks-in-your-app
 */
export const YOUSIGN_PRODUCTION_URL = "https://api.yousign.app/v3";
export const YOUSIGN_SANDBOX_URL = "https://api-sandbox.yousign.app/v3";

export const signatureEnabled = () => !!process.env.YOUSIGN_API_KEY;
export const signatureApiUrl = () => (process.env.YOUSIGN_API_URL || YOUSIGN_PRODUCTION_URL).replace(/\/+$/, "");
/** Environnement de test Yousign : les signatures n'y ont aucune valeur juridique. */
export const signatureSandbox = () => /sandbox/i.test(signatureApiUrl());
export const webhookSecret = () => process.env.YOUSIGN_WEBHOOK_SECRET || null;

export const SIGNATURE_LABEL: Record<SignatureStatus, string> = {
  draft: "Envoi inachevé",
  ongoing: "En cours de signature",
  done: "Signée électroniquement",
  declined: "Signature refusée",
  expired: "Demande expirée",
  canceled: "Demande annulée",
};

// ─── Règles (sans appel réseau) ──────────────────────────────────────────────

/**
 * Statut Yousign d'une demande → statut suivi par KolBase (null : inconnu, ignoré).
 * Valeurs documentées : draft, ongoing, done, deleted, expired, canceled, approval, rejected, declined, paused.
 */
const STATUS_MAP: Record<string, SignatureStatus> = {
  draft: "draft",
  ongoing: "ongoing",
  approval: "ongoing",
  paused: "ongoing",
  done: "done",
  declined: "declined",
  rejected: "declined",
  expired: "expired",
  canceled: "canceled",
  deleted: "canceled",
};
export const mapYousignStatus = (s: unknown): SignatureStatus | null => (typeof s === "string" && Object.hasOwn(STATUS_MAP, s) ? STATUS_MAP[s] : null);

/**
 * Événement de webhook → statut à appliquer (null : événement sans effet pour KolBase).
 * Événements : https://developers.yousign.com/reference/signature-request-events
 */
const EVENT_MAP: Record<string, SignatureStatus> = {
  "signature_request.activated": "ongoing",
  "signature_request.reactivated": "ongoing",
  "signature_request.done": "done",
  "signature_request.declined": "declined",
  "signature_request.rejected": "declined",
  "signature_request.expired": "expired",
  "signature_request.canceled": "canceled",
  "signature_request.deleted": "canceled",
  "signature_request.permanently_deleted": "canceled",
};
export const webhookStatus = (eventName: unknown): SignatureStatus | null =>
  typeof eventName === "string" && Object.hasOwn(EVENT_MAP, eventName) ? EVENT_MAP[eventName] : null;

/** Une demande signée est définitive : un événement en retard (ou rejoué) ne la fait pas revenir en arrière. */
export const canApplyStatus = (current: SignatureStatus, next: SignatureStatus) => current !== "done" && current !== next;

/** Une nouvelle demande peut être envoyée tant qu'aucune n'est en cours ni signée. */
export const canSendAgain = (current: SignatureStatus | null | undefined) => !current || !["ongoing", "done"].includes(current);

/**
 * Vérification du webhook : en-tête « X-Yousign-Signature-256 » = « sha256= » + HMAC SHA-256 (hexadécimal) du corps brut,
 * clé : secret de l'abonnement ; comparaison en temps constant (https://developers.yousign.com/docs/use-webhooks-in-your-app).
 */
export function verifyWebhookSignature(rawBody: Uint8Array | string, header: string | null | undefined, secret: string | null | undefined) {
  if (!header || !secret) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header.trim().toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Cadre de signature dessiné dans la convention : page (à partir de 1), points, repère PDF (origine en bas à gauche). */
export type SignatureBox = { page: number; x: number; y: number; width: number; height: number; pageHeight: number };

/**
 * Champ de signature Yousign centré dans un cadre de la convention. Repère Yousign : points depuis le coin supérieur
 * gauche, page à partir de 1 ; taille de 85 × 37 à 2000 × 1000 points, rapport largeur/hauteur de 2,3
 * (https://developers.yousign.com/docs/signature-field, https://developers.yousign.com/docs/field-creation-with-api-endpoints).
 */
export function signatureField(documentId: string, box: SignatureBox) {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const height = clamp(Math.floor(box.height - 12), 37, 1000);
  const width = clamp(Math.min(Math.round(height * 2.3), Math.floor(box.width - 12)), 85, 2000);
  const top = box.pageHeight - (box.y + box.height); // haut du cadre, mesuré depuis le haut de la page
  return {
    document_id: documentId,
    type: "signature" as const,
    page: box.page,
    x: Math.max(0, Math.round(box.x + (box.width - width) / 2)),
    y: Math.max(0, Math.round(top + (box.height - height) / 2)),
    width,
    height,
  };
}

/** Nom d'une demande (1 à 128 caractères, sans caractères de contrôle ni chevrons). */
export const requestName = (s: string) => s.replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 128) || "Convention";

// ─── Appels à l'API ──────────────────────────────────────────────────────────

export class YousignError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Yousign ${status} : ${detail}`);
  }
}

async function call(path: string, init: { method?: string; json?: unknown; form?: FormData; accept?: string } = {}) {
  const key = process.env.YOUSIGN_API_KEY;
  if (!key) throw new Error("Signature électronique non configurée (YOUSIGN_API_KEY).");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: init.accept ?? "application/json" };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${signatureApiUrl()}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = String(j.detail ?? j.message ?? j.title ?? detail).slice(0, 300);
    } catch {}
    throw new YousignError(res.status, detail || res.statusText);
  }
  return res;
}
const callJson = async <T>(path: string, init: Parameters<typeof call>[1] = {}) => (await call(path, init)).json() as Promise<T>;

export type Signer = { firstName: string; lastName: string; email: string; box: SignatureBox };

/**
 * Crée la demande, dépose la convention, ajoute les signataires (signature électronique simple, code reçu par e-mail)
 * avec un champ chacun dans son cadre, puis l'active : Yousign envoie alors un e-mail à chaque signataire.
 */
export async function createSignatureRequest(i: { name: string; externalId: string; filename: string; pdf: Uint8Array; signers: Signer[] }) {
  const sr = await callJson<{ id: string }>("/signature_requests", {
    method: "POST",
    json: {
      name: requestName(i.name),
      delivery_mode: "email",
      timezone: "Europe/Paris",
      external_id: i.externalId,
      audit_trail_locale: "fr",
      signers_allowed_to_decline: true,
    },
  });
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(i.pdf)], { type: "application/pdf" }), i.filename);
  form.append("nature", "signable_document");
  const doc = await callJson<{ id: string }>(`/signature_requests/${sr.id}/documents`, { method: "POST", form });
  for (const s of i.signers) {
    await callJson(`/signature_requests/${sr.id}/signers`, {
      method: "POST",
      json: {
        info: { first_name: s.firstName.slice(0, 255), last_name: s.lastName.slice(0, 255), email: s.email, locale: "fr" },
        signature_level: "electronic_signature",
        signature_authentication_mode: "otp_email",
        fields: [signatureField(doc.id, s.box)],
      },
    });
  }
  const activated = await callJson<{ status?: string }>(`/signature_requests/${sr.id}/activate`, { method: "POST" });
  return { requestId: sr.id, documentId: doc.id, status: mapYousignStatus(activated.status) ?? "ongoing" };
}

/** État d'une demande (GET /signature_requests/{id}). */
export async function getSignatureRequest(requestId: string) {
  const r = await callJson<{ status?: string; completed_at?: string | null; decline_information?: { reason?: string | null } | null }>(
    `/signature_requests/${encodeURIComponent(requestId)}`,
  );
  return { status: mapYousignStatus(r.status), completedAt: parseDate(r.completed_at), declineReason: r.decline_information?.reason ?? null };
}

/**
 * Convention signée (PDF) : GET /signature_requests/{id}/documents/{documentId}/download (Accept: application/pdf),
 * ou, sans identifiant de document, GET /signature_requests/{id}/documents/download?version=completed&archive=false.
 */
export async function downloadSignedDocument(requestId: string, documentId: string | null) {
  const id = encodeURIComponent(requestId);
  const path = documentId ? `/signature_requests/${id}/documents/${encodeURIComponent(documentId)}/download` : `/signature_requests/${id}/documents/download?version=completed&archive=false`;
  const bytes = new Uint8Array(await (await call(path, { accept: "application/pdf" })).arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new YousignError(502, "le document reçu n'est pas un PDF");
  return bytes;
}

export const parseDate = (v: unknown) => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
