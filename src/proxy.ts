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

/**
 * Proxy (Next 16, ex-« middleware ») : transmet aux pages le chemin demandé (en-tête de requête `x-kb-path`,
 * chemin et paramètres). Une page réservée aux membres connectés renvoie ainsi vers
 * `/connexion?next=<chemin>` (voir requireUser), et la personne revient où elle allait après la connexion.
 * L'en-tête envoyé par le navigateur est toujours remplacé.
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  // Requêtes de navigation côté client (composants serveur) : paramètre technique, sans intérêt pour le retour.
  url.searchParams.delete("_rsc");
  const headers = new Headers(request.headers);
  headers.set("x-kb-path", `${url.pathname}${url.search}`.slice(0, 2000));
  const csp = cspFor(btoa(crypto.randomUUID()));
  headers.set("content-security-policy-report-only", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy-Report-Only", csp);
  return response;
}

export const config = {
  // Ni fichiers statiques, ni images optimisées, ni icônes.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png).*)"],
};
