import "server-only";
import { db } from "@/lib/db";

export const coverSrc = (a: { id: string; coverType: string | null; updatedAt: Date }) => (a.coverType ? `/actualites/couverture/${a.id}?v=${a.updatedAt.getTime()}` : null);

const cardSelect = { id: true, slug: true, title: true, category: true, excerpt: true, coverType: true, publishedAt: true, updatedAt: true, body: true } as const;

/** Actualités publiées, les plus récentes d'abord. */
export async function publishedArticles(take?: number) {
  return db.article.findMany({ where: { publishedAt: { not: null, lte: new Date() } }, select: cardSelect, orderBy: { publishedAt: "desc" }, take });
}
export type NewsCardData = Awaited<ReturnType<typeof publishedArticles>>[number];
