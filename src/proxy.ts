import { NextResponse, type NextRequest } from "next/server";

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
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Ni fichiers statiques, ni images optimisées, ni icônes.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png).*)"],
};
