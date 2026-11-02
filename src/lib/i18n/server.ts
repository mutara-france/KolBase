import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { isLocale, makeT, type Locale } from "@/lib/i18n";

export const LOCALE_COOKIE = "kb_lang";

/**
 * Langue de la requête : choix explicite (cookie posé par le sélecteur), sinon préférence du compte,
 * sinon première langue du navigateur (anglais si elle l'est, français dans tous les autres cas).
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  const user = await getCurrentUser();
  if (user) return isLocale(user.locale) ? user.locale : "fr";
  const first = ((await headers()).get("accept-language") ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "fr";
});

export async function getT() {
  const locale = await getLocale();
  return { locale, t: makeT(locale) };
}
