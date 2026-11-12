import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/ics";
import { currentBrand } from "@/lib/brand-server";

/**
 * Seules les pages publiques sont à indexer. Sur le nom de domaine d'une organisation (KolBase Business), rien ne
 * l'est : ses pages publiques existent déjà sur KolBase.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (await currentBrand()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Espaces connectés, documents, liens personnels et adresses techniques. Les pages publiques restent ouvertes, comme
      // celles marquées noindex (attestation, pointage…), que les moteurs doivent pouvoir lire pour les écarter.
      disallow: [
        "/admin", "/annuaire", "/compte", "/comptes", "/confirmer-email", "/desinscription", "/devis",
        "/documents", "/inscriptions", "/interventions", "/invitation", "/mot-de-passe", "/notes-honoraires", "/opportunites", "/organisations",
        "/propositions", "/r/", "/revenus", "/signatures", "/sollicitations", "/suivis", "/tableau-de-bord", "/api",
      ],
    },
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
