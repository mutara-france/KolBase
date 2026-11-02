import "server-only";
import { headers } from "next/headers";

/**
 * Limiteur de débit en mémoire (fenêtre glissante).
 * Suffisant tant que KolBase tourne sur une seule instance Render ; avec plusieurs instances,
 * remplacer le stockage par une table Postgres ou Redis (même interface).
 */
type Store = Map<string, number[]>;
const g = globalThis as unknown as { kbRateLimit?: Store };
const store: Store = (g.kbRateLimit ??= new Map());

function recent(key: string, windowMs: number, now: number) {
  const hits = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length) store.set(key, hits);
  else store.delete(key);
  return hits;
}

/** Nombre de minutes avant de pouvoir réessayer si la limite est atteinte, sinon 0. Ne compte pas la tentative. */
export function blockedFor(key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  const hits = recent(key, windowMs, now);
  return hits.length >= limit ? Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 60000)) : 0;
}

/** Enregistre une tentative. */
export function hit(key: string) {
  const now = Date.now();
  store.set(key, [...(store.get(key) ?? []), now]);
  // Ménage occasionnel des clés expirées (fenêtre maximale utilisée : 1 h).
  if (store.size > 5000) for (const k of [...store.keys()]) recent(k, 60 * 60 * 1000, now);
}

/** Efface les tentatives d'une clé (connexion réussie). */
export function reset(key: string) {
  store.delete(key);
}

/** Adresse IP du client telle que transmise par le proxy de Render. */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "inconnue";
}
