import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Limiteur de débit à fenêtre glissante, stocké en base (table RateLimitHit). En mémoire, il repartait de zéro à chaque
 * déploiement (plusieurs par jour certains jours) et ne valait que pour une instance. La clé (adresse e-mail, IP…) n'est
 * conservée que hachée ; les tentatives de plus de 24 h sont purgées par la tâche planifiée (purgeRateLimits).
 */
const hashed = (key: string) => createHash("sha256").update(key).digest("hex");

/** Nombre de minutes avant de pouvoir réessayer si la limite est atteinte, sinon 0. Ne compte pas la tentative. */
export async function blockedFor(key: string, limit: number, windowMs: number): Promise<number> {
  const now = Date.now();
  const hits = await db.rateLimitHit.findMany({
    where: { key: hashed(key), at: { gt: new Date(now - windowMs) } },
    select: { at: true },
    orderBy: { at: "asc" },
    take: limit,
  });
  return hits.length >= limit ? Math.max(1, Math.ceil((windowMs - (now - hits[0].at.getTime())) / 60000)) : 0;
}

/** Enregistre une tentative. */
export async function hit(key: string) {
  await db.rateLimitHit.create({ data: { key: hashed(key) } });
}

/** Efface les tentatives d'une clé (connexion réussie). */
export async function reset(key: string) {
  await db.rateLimitHit.deleteMany({ where: { key: hashed(key) } });
}

/** Ménage : tentatives plus anciennes que la plus longue fenêtre utilisée (24 h). */
export async function purgeRateLimits(now = new Date()) {
  return (await db.rateLimitHit.deleteMany({ where: { at: { lt: new Date(now.getTime() - 24 * 3600 * 1000) } } })).count;
}

/** Adresse IP du client, telle que transmise par Cloudflare et le proxy de Render. */
export async function clientIp() {
  const h = await headers();
  // Render passe par Cloudflare, qui écrit lui-même True-Client-IP / CF-Connecting-IP (non falsifiables par le client).
  // X-Forwarded-For n'est pas nettoyé par Render (il est seulement complété) : sa première valeur peut être inventée par
  // le client ; on retient donc la dernière, ajoutée par le proxy.
  const xff = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return h.get("true-client-ip")?.trim() || h.get("cf-connecting-ip")?.trim() || xff[xff.length - 1] || h.get("x-real-ip") || "inconnue";
}
