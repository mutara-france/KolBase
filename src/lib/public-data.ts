import "server-only";
import { db } from "@/lib/db";
import { ORG_KIND_LABEL } from "@/lib/orgs";
import type { CallCardData, EventCardData, KolCardData, OrgCardData } from "@/components/PublicCards";

export async function publicEvents(take?: number): Promise<EventCardData[]> {
  const events = await db.event.findMany({
    where: { publishedAt: { not: null }, startsAt: { gte: new Date() } },
    include: { organization: { select: { name: true } }, _count: { select: { registrations: true } } },
    orderBy: { startsAt: "asc" },
    take,
  });
  return events.map((e) => ({ ...e, registrations: e._count.registrations }));
}

export async function publicExperts(take?: number): Promise<KolCardData[]> {
  const ps = await db.practitionerProfile.findMany({
    where: { listed: true },
    include: { user: { select: { firstName: true, lastName: true } }, projectLinks: { where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] } }, select: { project: { select: { organizationId: true } } } } },
    orderBy: { listedAt: "desc" },
    take,
  });
  return ps.map((p) => ({
    id: p.id, name: `Dr ${p.user.firstName} ${p.user.lastName}`, specialty: p.specialty, subspecialty: p.subspecialty, profession: p.profession,
    city: p.city, hospital: p.hospital, verified: p.rppsVerified, types: p.interventionTypes,
    collaborations: p.projectLinks.length, organizations: new Set(p.projectLinks.map((l) => l.project.organizationId)).size,
  }));
}

export async function publicOrgs(take?: number): Promise<OrgCardData[]> {
  const os = await db.organization.findMany({
    where: { listed: true },
    include: { _count: { select: { openCalls: { where: { status: "open" } }, projects: { where: { status: { notIn: ["ATT_EXPERTS", "DECLINE"] } } } } } },
    orderBy: { createdAt: "asc" },
    take,
  });
  return os.map((o) => ({ id: o.id, name: o.name, kind: ORG_KIND_LABEL[o.kind], sector: o.sector, about: o.about, hq: o.headquarters, areas: o.areas, openCalls: o._count.openCalls, collaborations: o._count.projects }));
}

export async function publicCalls(take?: number): Promise<CallCardData[]> {
  const now = new Date();
  const cs = await db.openCall.findMany({
    where: { status: "open", OR: [{ deadline: null }, { deadline: { gte: now } }] },
    include: { organization: { select: { name: true } } },
    orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
    take,
  });
  return cs.map((c) => ({ id: c.id, title: c.title, specialty: c.specialty, typeId: c.typeId, poster: c.organization.name, deadline: c.deadline, description: c.description, budgetMinCents: c.budgetMinCents, budgetMaxCents: c.budgetMaxCents, open: true }));
}

export async function publicCounts() {
  const now = new Date();
  const [experts, verified, industriels, organizations, events, calls] = await Promise.all([
    db.practitionerProfile.count({ where: { listed: true } }),
    db.practitionerProfile.count({ where: { listed: true, rppsVerified: true } }),
    db.organization.count({ where: { listed: true, kind: "INDUSTRIEL" } }),
    db.organization.count({ where: { listed: true } }),
    db.event.count({ where: { publishedAt: { not: null }, startsAt: { gte: now } } }),
    db.openCall.count({ where: { status: "open", OR: [{ deadline: null }, { deadline: { gte: now } }] } }),
  ]);
  return { experts, verified, industriels, organizations, events, calls };
}

/** Spécialités des experts référencés, de la plus représentée à la moins représentée. */
export async function publicSpecialties(): Promise<{ name: string; count: number }[]> {
  const rows = await db.practitionerProfile.groupBy({ by: ["specialty"], where: { listed: true, specialty: { not: null } }, _count: { _all: true } });
  return rows
    .map((r) => ({ name: r.specialty as string, count: r._count._all }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));
}

/** Prochain événement publié d'une organisation et nombre d'événements à venir. */
export async function publicOrgAgenda(organizationId: string) {
  const where = { organizationId, publishedAt: { not: null }, startsAt: { gte: new Date() } };
  const [next, upcoming] = await Promise.all([
    db.event.findFirst({ where, orderBy: { startsAt: "asc" }, select: { id: true, title: true, startsAt: true, city: true } }),
    db.event.count({ where }),
  ]);
  return { next, upcoming };
}
