import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/ics";
import { realOrganization, realPractitioner } from "@/lib/demo";

export const dynamic = "force-dynamic";

/**
 * Plan du site : pages publiques, experts référencés, organisations validées, événements publiés à venir.
 * Jamais les données de démonstration (lib/demo), qui ne doivent pas être indexées.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const [experts, orgs, events, articles] = await Promise.all([
    db.practitionerProfile.findMany({ where: { listed: true, ...realPractitioner }, select: { id: true, updatedAt: true } }),
    db.organization.findMany({ where: { listed: true, verification: "VERIFIED", kind: { not: "PRESTATAIRE" }, ...realOrganization }, select: { id: true, updatedAt: true } }),
    db.event.findMany({ where: { publishedAt: { not: null }, inviteOnly: false, startsAt: { gte: new Date() }, organization: { verification: "VERIFIED", ...realOrganization } }, select: { id: true, updatedAt: true } }),
    db.article.findMany({ where: { publishedAt: { not: null, lte: new Date() } }, select: { slug: true, updatedAt: true } }),
  ]);
  return [
    ...["", "/experts", "/evenements", "/appels", "/structures", "/actualites", "/barometre", "/intelligence", "/business", "/aide", "/cgu", "/conditions-de-vente", "/confidentialite", "/sous-traitance", "/mentions-legales"].map((p) => ({ url: `${base}${p}` })),
    ...experts.map((e) => ({ url: `${base}/experts/${e.id}`, lastModified: e.updatedAt })),
    ...orgs.map((o) => ({ url: `${base}/structures/${o.id}`, lastModified: o.updatedAt })),
    ...events.map((e) => ({ url: `${base}/evenements/${e.id}`, lastModified: e.updatedAt })),
    ...articles.map((a) => ({ url: `${base}/actualites/${a.slug}`, lastModified: a.updatedAt })),
  ];
}
