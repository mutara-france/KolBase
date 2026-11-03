import { db } from "@/lib/db";
import { readingMinutes } from "@/lib/article-format";
import { ogImage, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "Actualité de KolBase";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

/** Aperçu de partage d'une actualité publiée. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await db.article.findFirst({ where: { slug, publishedAt: { not: null, lte: new Date() } } });
  if (!a) return ogImage({ title: "Actualités de KolBase" });
  return ogImage({
    kicker: `Actualités · ${a.category}`,
    title: a.title,
    lines: [`${readingMinutes(a.body)} min de lecture`],
    footer: "kolbase.io/actualites",
  });
}
