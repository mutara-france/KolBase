import { after } from "next/server";
import { db } from "@/lib/db";
import { applySignatureStatus } from "@/lib/signature";
import { parseDate, signatureEnabled, verifyWebhookSignature, webhookSecret, webhookStatus } from "@/lib/yousign";

export const dynamic = "force-dynamic";

type YousignEvent = {
  event_id?: string;
  event_name?: string;
  data?: { signature_request?: { id?: unknown; completed_at?: unknown; decline_information?: { reason?: unknown } | null } };
};

/**
 * Webhook Yousign (abonnement à déclarer avec l'URL <APP_URL>/api/signature/webhook) :
 * https://developers.yousign.com/docs/use-webhooks-in-your-app — réponse 2xx attendue en moins d'une seconde,
 * événements rejoués en cas d'échec (le traitement est idempotent), identifiants inconnus ignorés.
 */
export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret || !signatureEnabled()) return Response.json({ error: "Webhook non configuré." }, { status: 503 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (!verifyWebhookSignature(raw, req.headers.get("x-yousign-signature-256"), secret)) return Response.json({ error: "Signature invalide." }, { status: 401 });

  let event: YousignEvent;
  try {
    event = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return Response.json({ error: "Corps invalide." }, { status: 400 });
  }
  const next = webhookStatus(event?.event_name);
  const sr = event?.data?.signature_request;
  if (!next || typeof sr?.id !== "string") return Response.json({ received: true, ignored: true });
  const sig = await db.conventionSignature.findUnique({ where: { requestId: sr.id }, include: { projectExpert: { select: { projectId: true } } } });
  if (!sig) return Response.json({ received: true, ignored: true });

  if (next === "done") {
    // Téléchargement du PDF signé et dépôt dans le stockage après la réponse (délai imposé par Yousign).
    // En cas d'échec, la demande reste « en cours » : « Mettre à jour le statut » la rattrape.
    const completedAt = parseDate(sr.completed_at);
    after(() => applySignatureStatus(sig, "done", { completedAt }).catch((e) => console.error("[signature] finalisation impossible", sig.requestId, e)));
  } else {
    const reason = sr.decline_information?.reason;
    await applySignatureStatus(sig, next, { note: typeof reason === "string" ? reason : null });
  }
  return Response.json({ received: true });
}
