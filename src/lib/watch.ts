import "server-only";
import { db } from "@/lib/db";
import { errorText } from "@/lib/redact";
import { mentions } from "@/lib/feed";
import { readFeed } from "@/lib/feed-reader";

/** Un flux est relevé au plus toutes les six heures, dix flux par passage des tâches planifiées. */
const REFRESH_MS = 6 * 3600e3;
const PER_RUN = 10;
/** Publications relevées conservées treize mois ; affichées sur les quatre-vingt-dix derniers jours. */
const RETENTION_MS = 395 * 86400e3;
export const WATCH_DAYS = 90;
/** Relève une source : nouvelles publications enregistrées, date et erreur du relevé notées. */
export async function refreshSource(source: { id: string; url: string }, now = new Date()) {
  try {
    const items = await readFeed(source.url);
    const data = items
      .map((i) => ({ sourceId: source.id, title: i.title, url: i.url, summary: i.summary, publishedAt: i.publishedAt && i.publishedAt <= now ? i.publishedAt : now }))
      .filter((i) => now.getTime() - i.publishedAt.getTime() < RETENTION_MS);
    const created = (await db.watchItem.createMany({ data, skipDuplicates: true })).count;
    await db.watchSource.update({ where: { id: source.id }, data: { fetchedAt: now, error: null } });
    return { read: items.length, created };
  } catch (e) {
    await db.watchSource.update({ where: { id: source.id }, data: { fetchedAt: now, error: errorText(e).slice(0, 300) } });
    return { read: 0, created: 0 };
  }
}

/** Tâche planifiée : relève les sources actives dues (les plus anciennes d'abord) et efface les publications périmées. */
export async function refreshWatchSources(now = new Date()) {
  const due = await db.watchSource.findMany({
    where: { active: true, OR: [{ fetchedAt: null }, { fetchedAt: { lt: new Date(now.getTime() - REFRESH_MS) } }] },
    orderBy: { fetchedAt: { sort: "asc", nulls: "first" } }, take: PER_RUN, select: { id: true, url: true },
  });
  let created = 0;
  for (const s of due) created += (await refreshSource(s, now)).created;
  const purged = (await db.watchItem.deleteMany({ where: { sourceId: { not: null }, publishedAt: { lt: new Date(now.getTime() - RETENTION_MS) } } })).count;
  return { sources: due.length, created, purged };
}

export type WatchHit = { id: string; title: string; url: string; summary: string | null; publishedAt: Date; source: string | null; own: boolean; manual: boolean; about: string[] };

/**
 * Veille d'une organisation sur quatre-vingt-dix jours : publications des sources communes qui citent l'un de ses
 * concurrents suivis (nom ou autre écriture) ou l'organisation elle-même (nom, marques), et publications qu'elle a
 * ajoutées à la main.
 */
export async function watchFor(org: { id: string; name: string; brands: readonly string[] }, now = new Date()) {
  const since = new Date(now.getTime() - WATCH_DAYS * 86400e3);
  const [competitors, items, sources] = await Promise.all([
    db.competitor.findMany({ where: { organizationId: org.id }, select: { name: true, aliases: true } }),
    db.watchItem.findMany({
      where: { publishedAt: { gte: since }, OR: [{ organizationId: org.id }, { organizationId: null, source: { active: true } }] },
      orderBy: { publishedAt: "desc" }, take: 3000, include: { source: { select: { name: true } } },
    }),
    db.watchSource.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true, fetchedAt: true } }),
  ]);
  const watched = [{ label: org.name, own: true, terms: [org.name, ...org.brands] }, ...competitors.map((c) => ({ label: c.name, own: false, terms: [c.name, ...c.aliases] }))];
  const hits: WatchHit[] = [];
  for (const i of items) {
    const found = mentions(`${i.title} ${i.summary ?? ""}`, watched);
    const manual = i.organizationId !== null;
    if (found.length === 0 && !manual) continue;
    hits.push({ id: i.id, title: i.title, url: i.url, summary: i.summary, publishedAt: i.publishedAt, source: i.source?.name ?? null, manual, own: found.some((f) => f.own), about: found.filter((f) => !f.own).map((f) => f.label) });
  }
  return { hits: hits.slice(0, 200), sources, competitors: competitors.length };
}
