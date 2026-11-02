import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/ics";

export const dynamic = "force-dynamic";

/** Plan du site : pages publiques, experts référencés, organisations validées, événements publiés à venir. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const [experts, orgs, events] = await Promise.all([
    db.practitionerProfile.findMany({ where: { listed: true }, select: { id: true, updatedAt: true } }),
    db.organization.findMany({ where: { listed: true, verification: "VERIFIED", kind: { not: "PRESTATAIRE" } }, select: { id: true, updatedAt: true } }),
    db.event.findMany({ where: { publishedAt: { not: null }, startsAt: { gte: new Date() }, organization: { verification: "VERIFIED" } }, select: { id: true, updatedAt: true } }),
  ]);
  return [
    ...["", "/experts", "/evenements", "/appels", "/structures", "/aide", "/cgu", "/confidentialite", "/mentions-legales"].map((p) => ({ url: `${base}${p}` })),
    ...experts.map((e) => ({ url: `${base}/experts/${e.id}`, lastModified: e.updatedAt })),
    ...orgs.map((o) => ({ url: `${base}/structures/${o.id}`, lastModified: o.updatedAt })),
    ...events.map((e) => ({ url: `${base}/evenements/${e.id}`, lastModified: e.updatedAt })),
  ];
}
