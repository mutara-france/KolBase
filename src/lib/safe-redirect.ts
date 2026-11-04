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
