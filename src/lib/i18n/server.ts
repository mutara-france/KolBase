import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { isLocale, makeT, type Locale } from "@/lib/i18n";

export const LOCALE_COOKIE = "kb_lang";
const CRAWLER = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview/i;

/**
 * Langue de la requête : pour un compte connecté, celle de son profil (« Mon compte ») ; pour un visiteur, son choix
 * explicite (cookie posé par le sélecteur du site public), sinon la première langue du navigateur (anglais si elle
 * l'est, français dans tous les autres cas).
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const user = await getCurrentUser();
  if (user) return isLocale(user.locale) ? user.locale : "fr";
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  const h = await headers();
  // Robots d'indexation et d'aperçu : toujours la version française, la seule à indexer (même adresse pour les deux langues).
  if (CRAWLER.test(h.get("user-agent") ?? "")) return "fr";
  const first = (h.get("accept-language") ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "fr";
});

export async function getT() {
  const locale = await getLocale();
  return { locale, t: makeT(locale) };
}
