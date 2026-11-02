import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/ics";

/** Seules les pages publiques sont à indexer. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/annuaire", "/compte", "/confirmer-email", "/documents", "/inscriptions", "/interventions", "/invitation", "/mot-de-passe", "/opportunites", "/organisations", "/sollicitations", "/suivis", "/tableau-de-bord", "/api"],
    },
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
