import { NextResponse, type NextRequest } from "next/server";
import { optionalServices, SERVICE_ORIGINS } from "@/lib/consent";

/**
 * Politique de sécurité des contenus (CSP) à nonce, en observation (Report-Only) : rien n'est bloqué, les écarts sont
 * envoyés à /api/csp et journalisés. Une fois les journaux propres, elle passera en `Content-Security-Policy` (bloquante).
 * Next.js lit le nonce dans cet en-tête de requête et l'appose sur ses propres scripts.
 */
function cspFor(nonce: string) {
  // Services soumis à consentement et configurés (mesure d'audience, marketing) : chargés par un script de la page
  // ('strict-dynamic'), ils envoient leurs mesures et images vers leurs propres domaines.
  const extra = optionalServices().flatMap((s) => SERVICE_ORIGINS[s.id]).join(" ");
  const more = extra ? ` ${extra}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${more}`,
    "font-src 'self' data:",
    `connect-src 'self'${more}`,
    ...(extra ? [`frame-src${more}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "report-uri /api/csp",
  ].join("; ");
}

/** Adresse publique du site (APP_URL), ou null si elle manque ou n'est pas une URL. */
const APP = (() => {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL) : null;
  } catch {
    return null;
  }
})();

/**
 * Proxy (Next 16, ex-« middleware ») : transmet aux pages le chemin demandé (en-tête de requête `x-kb-path`,
 * chemin et paramètres). Une page réservée aux membres connectés renvoie ainsi vers
 * `/connexion?next=<chemin>` (voir requireUser), et la personne revient où elle allait après la connexion.
 * L'en-tête envoyé par le navigateur est toujours remplacé.
 */
export function proxy(request: NextRequest) {
  // Une seule adresse publique : www.kolbase.io renvoie vers kolbase.io (pas de pages en double pour les moteurs).
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").toLowerCase();
  if (APP && host === `www.${APP.host}`) return NextResponse.redirect(new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, APP.origin), 308);
  const url = request.nextUrl.clone();
  // Requêtes de navigation côté client (composants serveur) : paramètre technique, sans intérêt pour le retour.
  url.searchParams.delete("_rsc");
  const headers = new Headers(request.headers);
  headers.set("x-kb-path", `${url.pathname}${url.search}`.slice(0, 2000));
  const nonce = btoa(crypto.randomUUID());
  const csp = cspFor(nonce);
  headers.set("content-security-policy-report-only", csp);
  // Nonce lu par les pages pour leurs propres scripts inline (données structurées : composant JsonLd).
  headers.set("x-kb-nonce", nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy-Report-Only", csp);
  return response;
}

export const config = {
  // Ni fichiers statiques, ni images optimisées, ni icônes.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png).*)"],
};
