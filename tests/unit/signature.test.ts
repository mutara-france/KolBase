import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canApplyStatus, canSendAgain, mapYousignStatus, requestName, signatureApiUrl, signatureEnabled, signatureField, signatureSandbox,
  verifyWebhookSignature, webhookStatus, YOUSIGN_PRODUCTION_URL,
} from "@/lib/yousign";

describe("signature électronique : webhook Yousign", () => {
  const secret = "secret-de-test";
  const body = JSON.stringify({ event_name: "signature_request.done", data: { signature_request: { id: "sr-1", status: "done" } } });
  const sign = (b: string, k = secret) => `sha256=${createHmac("sha256", k).update(b).digest("hex")}`;

  it("accepte la signature HMAC SHA-256 du corps brut, préfixée « sha256= »", () => {
    expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true);
    expect(verifyWebhookSignature(new TextEncoder().encode(body), sign(body), secret)).toBe(true);
    expect(verifyWebhookSignature(body, ` ${sign(body).toUpperCase().replace("SHA256=", "sha256=")} `, secret)).toBe(true);
  });
  it("refuse un corps modifié, une autre clé, un en-tête absent ou mal formé", () => {
    expect(verifyWebhookSignature(body + " ", sign(body), secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, "autre"), secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body).replace("sha256=", ""), secret)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=abc", secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, ""), "")).toBe(false);
  });
  it("événements : seuls ceux qui changent le statut sont retenus", () => {
    expect(webhookStatus("signature_request.done")).toBe("done");
    expect(webhookStatus("signature_request.declined")).toBe("declined");
    expect(webhookStatus("signature_request.expired")).toBe("expired");
    expect(webhookStatus("signature_request.canceled")).toBe("canceled");
    expect(webhookStatus("signature_request.activated")).toBe("ongoing");
    expect(webhookStatus("signature_request.reminder_executed")).toBeNull();
    expect(webhookStatus("signer.done")).toBeNull();
    expect(webhookStatus("toString")).toBeNull();
    expect(webhookStatus(undefined)).toBeNull();
  });
});

describe("signature électronique : statuts", () => {
  it("statuts Yousign → statuts suivis", () => {
    expect(mapYousignStatus("ongoing")).toBe("ongoing");
    expect(mapYousignStatus("approval")).toBe("ongoing");
    expect(mapYousignStatus("done")).toBe("done");
    expect(mapYousignStatus("rejected")).toBe("declined");
    expect(mapYousignStatus("deleted")).toBe("canceled");
    expect(mapYousignStatus("expired")).toBe("expired");
    expect(mapYousignStatus("inconnu")).toBeNull();
    expect(mapYousignStatus("constructor")).toBeNull();
    expect(mapYousignStatus(42)).toBeNull();
  });
  it("une demande signée est définitive ; un nouvel envoi n'est possible qu'après échec, refus, expiration ou annulation", () => {
    expect(canApplyStatus("ongoing", "done")).toBe(true);
    expect(canApplyStatus("done", "ongoing")).toBe(false);
    expect(canApplyStatus("done", "canceled")).toBe(false);
    expect(canApplyStatus("ongoing", "ongoing")).toBe(false);
    expect(canApplyStatus("expired", "ongoing")).toBe(true);
    expect(canSendAgain(null)).toBe(true);
    expect(canSendAgain("draft")).toBe(true);
    expect(canSendAgain("declined")).toBe(true);
    expect(canSendAgain("expired")).toBe(true);
    expect(canSendAgain("ongoing")).toBe(false);
    expect(canSendAgain("done")).toBe(false);
  });
  it("configuration : production par défaut, bac à sable reconnu", () => {
    const saved = { ...process.env };
    delete process.env.YOUSIGN_API_KEY;
    delete process.env.YOUSIGN_API_URL;
    expect(signatureEnabled()).toBe(false);
    expect(signatureApiUrl()).toBe(YOUSIGN_PRODUCTION_URL);
    expect(signatureSandbox()).toBe(false);
    process.env.YOUSIGN_API_KEY = "cle";
    process.env.YOUSIGN_API_URL = "https://api-sandbox.yousign.app/v3/";
    expect(signatureEnabled()).toBe(true);
    expect(signatureApiUrl()).toBe("https://api-sandbox.yousign.app/v3");
    expect(signatureSandbox()).toBe(true);
    process.env = saved;
  });
});

describe("signature électronique : placement des champs", () => {
  // Cadres de la convention (A4, marges de 56 points) : organisation à gauche, expert à droite, en bas de la dernière page.
  const A4H = 841.89;
  const left = { page: 3, x: 56, y: 400, width: 226.64, height: 76, pageHeight: A4H };
  const right = { ...left, x: 312.64 };

  it("champ dans le cadre, repère Yousign (depuis le haut de la page), page conservée", () => {
    const f = signatureField("doc-1", left);
    expect(f).toMatchObject({ document_id: "doc-1", type: "signature", page: 3 });
    const top = A4H - (left.y + left.height);
    expect(f.x).toBeGreaterThanOrEqual(left.x);
    expect(f.x + f.width).toBeLessThanOrEqual(left.x + left.width);
    expect(f.y).toBeGreaterThanOrEqual(top);
    expect(f.y + f.height).toBeLessThanOrEqual(top + left.height);
    expect(Number.isInteger(f.x) && Number.isInteger(f.y) && Number.isInteger(f.width) && Number.isInteger(f.height)).toBe(true);
  });
  it("taille dans les bornes Yousign (85 × 37 au minimum), rapport proche de 2,3", () => {
    const f = signatureField("doc-1", right);
    expect(f.width).toBeGreaterThanOrEqual(85);
    expect(f.height).toBeGreaterThanOrEqual(37);
    expect(f.width / f.height).toBeCloseTo(2.3, 1);
    expect(signatureField("d", right).x).toBeGreaterThan(signatureField("d", left).x + left.width - 1);
    const tiny = signatureField("d", { ...left, width: 50, height: 20 });
    expect(tiny.width).toBe(85);
    expect(tiny.height).toBe(37);
  });
  it("nom de la demande : 128 caractères au plus, sans caractères de contrôle", () => {
    expect(requestName("Convention <KB>\n- Formation")).toBe("Convention KB - Formation");
    expect(requestName("x".repeat(300))).toHaveLength(128);
    expect(requestName("  ")).toBe("Convention");
  });
});
