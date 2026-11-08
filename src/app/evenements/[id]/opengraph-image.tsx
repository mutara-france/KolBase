import { db } from "@/lib/db";
import { eventTypeLabel, FORMAT_LABEL, TZ } from "@/lib/events";
import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "Événement sur KolBase";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Aperçu de partage d'un événement publié : type, titre, date, lieu, organisateur. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = await db.event.findFirst({ where: { id, publishedAt: { not: null }, inviteOnly: false, organization: { verification: "VERIFIED" } }, include: { organization: { select: { name: true } } } });
  if (!e) return ogImage({ title: "Événement introuvable" });
  const when = e.startsAt.toLocaleString("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/(\d{2}):(\d{2})/, (_, h, m) => (m === "00" ? `${h} h` : `${h} h ${m}`));
  const where = e.format === "DISTANCIEL" ? "En ligne" : [e.city, e.format === "HYBRIDE" ? "et en ligne" : null].filter(Boolean).join(" ") || FORMAT_LABEL[e.format];
  return ogImage({
    kicker: [eventTypeLabel(e.typeId), e.therapeuticArea].filter(Boolean).join(" · "),
    title: e.title,
    lines: [when.charAt(0).toUpperCase() + when.slice(1), `${where} · ${e.organization.name}`],
    footer: "Inscription sur kolbase.io",
  });
}
