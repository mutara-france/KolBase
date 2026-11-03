/**
 * Double authentification par application (Google Authenticator, Microsoft Authenticator, 1Password…) :
 * codes à 6 chiffres renouvelés toutes les 30 secondes (TOTP, RFC 6238, HMAC-SHA1). Module pur, testé.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Nouveau secret (160 bits, encodé en base 32). */
export const newSecret = () => base32Encode(randomBytes(20));

/** Code HOTP (RFC 4226) pour un compteur. */
export function hotp(key: Buffer, counter: number, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);
export const totp = (secret: string, ms = Date.now(), digits = DIGITS) => hotp(base32Decode(secret), stepAt(ms), digits);

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Vérifie un code (tolérance d'un pas avant ou après, pour le décalage des horloges). Renvoie le pas accepté,
 * ou null si le code est faux ou déjà utilisé (pas inférieur ou égal au dernier accepté).
 */
export function verifyTotp(secret: string, code: string, { now = Date.now(), lastStep = null as number | null, window = 1 } = {}) {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secret);
  const current = stepAt(now);
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (lastStep != null && step <= lastStep) continue;
    if (same(hotp(key, step), c)) return step;
  }
  return null;
}

/** Adresse à scanner (QR code) dans l'application d'authentification. */
export const otpauthUri = (secret: string, account: string, issuer = "KolBase") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

/** Codes de secours à usage unique (« abcd-efgh »), à conserver par l'utilisateur ; seuls leurs hash sont stockés. */
export const newRecoveryCodes = (n = 10) =>
  Array.from({ length: n }, () => base32Encode(randomBytes(5)).toLowerCase().replace(/^(.{4})(.{4})$/, "$1-$2"));
export const normalizeRecovery = (s: string) => s.toLowerCase().replace(/[^a-z2-7]/g, "");
export const hashRecovery = (code: string) => createHash("sha256").update(normalizeRecovery(code)).digest("hex");
/** Ressemble à un code de secours (8 caractères base 32) plutôt qu'à un code à 6 chiffres. */
export const looksLikeRecovery = (s: string) => normalizeRecovery(s).length === 8 && !/^\d+$/.test(s.replace(/\s/g, ""));
