import { db } from "@/lib/db";
import { companyVisibility, kolVisibility } from "@/lib/visibility";

export type FeedItem = { key: string; date: Date; subject: string; href: string; label: string; kind: "practitioner" | "organization" };

const WINDOW_DAYS = 180;

/**
 * Fil des mises à jour des profils suivis, reconstitué à partir des données existantes
 * (publications, référencement, interventions, appels, événements). Respecte la visibilité
 * choisie par chaque profil pour un membre connecté.
 */
export async function followFeed(userId: string): Promise<FeedItem[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5);
  const follows = await db.follow.findMany({ where: { userId }, select: { practitionerId: true, organizationId: true } });
  const pIds = follows.map((f) => f.practitionerId).filter((x): x is string => !!x);
  const oIds = follows.map((f) => f.organizationId).filter((x): x is string => !!x);
  const items: FeedItem[] = [];

  if (pIds.length) {
    const pracs = await db.practitionerProfile.findMany({
      where: { id: { in: pIds }, listed: true },
      include: {
        user: { select: { firstName: true, lastName: true } },
        publications: { where: { createdAt: { gte: since } } },
        speakerApplications: { where: { status: "retained", createdAt: { gte: since }, event: { publishedAt: { not: null } } }, include: { event: true } },
      },
    });
    for (const p of pracs) {
      const name = `Dr ${p.user.firstName} ${p.user.lastName}`;
      const href = `/experts/${p.id}`;
      if (kolVisibility(p.visibility).publications !== "masque")
        for (const x of p.publications) items.push({ key: `pub-${x.id}`, date: x.createdAt, subject: name, href, kind: "practitioner", label: `Nouvelle publication : ${x.title}` });
      for (const a of p.speakerApplications)
        items.push({ key: `spk-${a.id}`, date: a.createdAt, subject: name, href: `/evenements/${a.eventId}`, kind: "practitioner", label: `Intervient à « ${a.event.title} »` });
      if (p.listedAt && p.listedAt >= since) items.push({ key: `lst-${p.id}`, date: p.listedAt, subject: name, href, kind: "practitioner", label: "Référencé(e) comme expert" });
    }
  }

  if (oIds.length) {
    const orgs = await db.organization.findMany({
      where: { id: { in: oIds }, listed: true },
      include: {
        openCalls: { where: { status: "open", createdAt: { gte: since } } },
        events: { where: { publishedAt: { gte: since, not: null } } },
      },
    });
    for (const o of orgs) {
      const href = `/structures/${o.id}`;
      if (companyVisibility(o.visibility).projets !== "masque")
        for (const c of o.openCalls) items.push({ key: `call-${c.id}`, date: c.createdAt, subject: o.name, href: `/opportunites/${c.id}`, kind: "organization", label: `Nouvel appel : ${c.title}` });
      for (const e of o.events) {
        items.push({ key: `ev-${e.id}`, date: e.publishedAt!, subject: o.name, href: `/evenements/${e.id}`, kind: "organization", label: `Nouvel événement : ${e.title}` });
        if (e.speakerCallOpen && e.startsAt > new Date())
          items.push({ key: `spc-${e.id}`, date: e.updatedAt, subject: o.name, href: `/evenements/${e.id}`, kind: "organization", label: `Appel à intervenants : ${e.title}` });
      }
    }
  }
  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Nombre de mises à jour depuis la dernière visite de « Mes suivis ». */
export async function unseenFollowCount(userId: string, seenAt: Date | null) {
  const [feed, since] = await Promise.all([followFeed(userId), seenSince(userId, seenAt)]);
  return feed.filter((i) => i.date > since).length;
}

/** Date de référence du « nouveau » : dernière visite, à défaut le premier suivi. */
export async function seenSince(userId: string, seenAt: Date | null) {
  if (seenAt) return seenAt;
  const first = await db.follow.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  return first?.createdAt ?? new Date();
}
