import { createHmac, timingSafeEqual } from "node:crypto";

/** Encodage « a[b][0]=… » attendu par l'API Stripe (formulaire). */
export function encodeForm(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x !== null && typeof x === "object" ? encodeForm(x as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object" && !(v instanceof Date)) encodeForm(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/** En-tête Stripe-Signature (utilisé par le faux Stripe des tests). */
export const signWebhook = (payload: string, secret: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

/** Vérifie une notification Stripe : signature HMAC et fraîcheur (5 minutes). */
export function verifyWebhook(payload: string, header: string, secret: string, nowSec = Math.floor(Date.now() / 1000), tolerance = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(nowSec - t) > tolerance) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
}
