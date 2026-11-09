import "server-only";
import { db } from "@/lib/db";

export const coverSrc = (a: { id: string; coverType: string | null; updatedAt: Date }) => (a.coverType ? `/actualites/couverture/${a.id}?v=${a.updatedAt.getTime()}` : null);

const cardSelect = { id: true, slug: true, title: true, category: true, excerpt: true, coverType: true, publishedAt: true, updatedAt: true, body: true } as const;

const published = () => ({ publishedAt: { not: null, lte: new Date() } });

/** Actualités publiées, les plus récentes d'abord, éventuellement dans une seule rubrique. */
export async function publishedArticles(take?: number, category?: string) {
  return db.article.findMany({ where: { ...published(), ...(category ? { category } : {}) }, select: cardSelect, orderBy: { publishedAt: "desc" }, take });
}

/** Nombre d'articles publiés par rubrique (filtres de la page des actualités : seules les rubriques garnies sont proposées). */
export async function publishedCountsByCategory(): Promise<Record<string, number>> {
  const rows = await db.article.groupBy({ by: ["category"], where: published(), _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.category, r._count._all]));
}
export type NewsCardData = Awaited<ReturnType<typeof publishedArticles>>[number];
