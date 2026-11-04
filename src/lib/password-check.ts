import "server-only";
import type { T } from "@/lib/i18n";
import { verifyPassword } from "@/lib/password";
import { blockedFor, hit, reset } from "@/lib/rate-limit";

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Mot de passe actuel redemandé dans une session ouverte (changement de mot de passe, suppression du compte, retrait de la
 * double authentification) : 10 erreurs par quart d'heure au plus, pour qu'une session volée ne permette pas de le deviner.
 */
export async function confirmPassword(userId: string, password: string, stored: string | null): Promise<{ ok: boolean; wait: number }> {
  const key = `password:user:${userId}`;
  const wait = await blockedFor(key, MAX_FAILURES, WINDOW_MS);
  if (wait) return { ok: false, wait };
  const ok = await verifyPassword(password, stored);
  if (ok) await reset(key);
  else await hit(key);
  return { ok, wait: 0 };
}

export const tooManyAttempts = (t: T, minutes: number) => ({
  error: minutes > 1 ? t("Trop de tentatives. Réessayez dans {n} minutes.", { n: minutes }) : t("Trop de tentatives. Réessayez dans {n} minute.", { n: minutes }),
});
