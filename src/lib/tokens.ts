import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { AuthTokenPurpose } from "@/generated/prisma/client";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export const TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  RESET_PASSWORD: 60 * 60 * 1000, // 1 heure
  VERIFY_EMAIL: 7 * 24 * 60 * 60 * 1000, // 7 jours
  TWO_FACTOR: 10 * 60 * 1000, // 10 minutes : saisie du code après le mot de passe
};

/** Crée un jeton à usage unique (seul son hash est stocké) et renvoie la valeur à mettre dans le lien. */
export async function issueToken(userId: string, purpose: AuthTokenPurpose) {
  const token = randomBytes(32).toString("base64url");
  await db.authToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]) } });
  return token;
}

/** Jeton valide (bon usage, non expiré, non utilisé), avec son utilisateur ; null sinon. */
export async function findToken(token: string, purpose: AuthTokenPurpose) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const t = await db.authToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt < new Date()) return null;
  return t;
}

/** Consomme le jeton (et invalide les autres jetons du même usage pour cet utilisateur). */
export async function consumeToken(id: string, userId: string, purpose: AuthTokenPurpose) {
  const now = new Date();
  const { count } = await db.authToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: now } });
  if (count) await db.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } });
  return count === 1;
}
