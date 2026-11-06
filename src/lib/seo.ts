import type { Metadata } from "next";

/**
 * Métadonnées d'une page publique : titre, description, adresse canonique (les variantes filtrées, paginées ou
 * servies sur www se rattachent à la page principale) et aperçu de partage à son nom, plutôt que celui de l'accueil.
 */
export function publicPage({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "KolBase", url: path, title: title.replace(/ — KolBase$/, ""), description },
  };
}
