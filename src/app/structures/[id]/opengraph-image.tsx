import { db } from "@/lib/db";
import { orgKindDisplay } from "@/lib/orgs";
import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "Organisation sur KolBase";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Aperçu de partage de la page publique d'une organisation validée. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = await db.organization.findFirst({ where: { id, listed: true, verification: "VERIFIED" }, select: { name: true, kind: true, supplierCategories: true, sector: true, headquarters: true, _count: { select: { events: { where: { publishedAt: { not: null }, startsAt: { gte: new Date() } } } } } } });
  if (!o) return ogImage({ title: "Organisations sur KolBase" });
  const n = o._count.events;
  return ogImage({
    kicker: orgKindDisplay(o),
    title: o.name,
    lines: [[o.sector, o.headquarters].filter(Boolean).join(" · "), n ? `${n} événement${n > 1 ? "s" : ""} à venir` : ""],
    footer: "kolbase.io/structures",
  });
}
