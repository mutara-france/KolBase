import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/ics";

/** Seules les pages publiques sont à indexer. */
export default function robots(): MetadataRoute.Robots {
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
