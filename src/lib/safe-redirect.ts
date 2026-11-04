const BASE = "http://kolbase.invalid";

/**
 * Chemin interne sûr pour une redirection (paramètre « next »), sinon `fallback`.
 * Refuse les URL absolues, « //hote » et « /\hote » (que les navigateurs lisent comme « //hote »).
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f]/.test(next)) return fallback;
  try {
    const url = new URL(next, BASE);
    return url.origin === BASE ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}

/** Page de connexion qui ramène ensuite au chemin demandé (s'il est sûr et n'est pas l'accueil). */
export function loginPath(path: string | null | undefined): string {
  const next = safeNext(path, "/");
  return next === "/" || next.startsWith("/connexion") ? "/connexion" : `/connexion?next=${encodeURIComponent(next)}`;
}

/** Pages d'authentification : un lien « Se connecter » posé sur l'une d'elles n'y ramène pas. */
const AUTH_PAGES = ["/connexion", "/inscription", "/mot-de-passe", "/confirmer-email"];

/** Page d'origine à transmettre depuis `path` (en-tête public) : vide pour l'accueil et les pages d'authentification. */
export function originOf(path: string | null | undefined): string {
  const next = safeNext(path, "/");
  return next === "/" || AUTH_PAGES.some((p) => next.startsWith(p)) ? "" : next;
}

/**
 * Lien vers la connexion ou la création de compte qui garde la page d'origine (`next`) et le profil choisi
 * (« organisation ») : « /inscription?profil=organisation&next=%2Finvitation%2F… ».
 */
export function authLink(page: string, next?: string | null, profil?: string | null): string {
  const q = [profil ? `profil=${encodeURIComponent(profil)}` : "", next ? `next=${encodeURIComponent(next)}` : ""].filter(Boolean).join("&");
  return q ? `${page}?${q}` : page;
}

/** Profil « organisation » déduit de la page d'origine : invitation à rejoindre une organisation, création d'organisation. */
export const organisationOrigin = (next: string | null | undefined) => !!next && /^\/(invitation\/|organisations\/nouvelle)/.test(next);
