import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ORG_KIND_LABEL } from "@/lib/orgs";
import { orgFamily } from "@/lib/org-roles";
import { supplierCategoryLabel } from "@/lib/suppliers";
import { canSee, companyVisibility, kolVisibility } from "@/lib/visibility";
import { logoSrc } from "@/lib/logos";
import { country } from "@/lib/countries";
import { SIGNED_STATUSES } from "@/lib/projects";
import { featuredEvents, trackedPath } from "@/lib/services";
import type { CallCardData, EventCardData, KolCardData, OrgCardData } from "@/components/PublicCards";

/** Événements auxquels la personne connectée est inscrite (cartes « Inscrit »), lus une fois par requête. */
export const myRegisteredEventIds = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return new Set<string>();
  const regs = await db.registration.findMany({ where: { userId: user.id }, select: { eventId: true } });
  return new Set(regs.map((r) => r.eventId));
});

/** Événements de l'agenda public : publiés, à venir, d'une organisation validée (même règle pour la liste et les compteurs). */
const publicEventWhere = (now = new Date()) => ({ publishedAt: { not: null }, internal: false, startsAt: { gte: now }, organization: { verification: "VERIFIED" as const } });

/**
 * Agenda public. `tracked` : liens suivis de la mise à la une (accueil seulement) ; ailleurs (/evenements), l'événement
 * reste en tête et marqué « À la une », mais le lien est direct (la mise à la une vendue est celle de l'accueil).
 */
export async function publicEvents(take?: number, { tracked = false }: { tracked?: boolean } = {}): Promise<EventCardData[]> {
  // Événements « à la une » (service KolBase) d'abord, puis les prochains par date.
  const codes = await featuredEvents();
  const featured = [...codes.keys()];
  const where = publicEventWhere();
  const include = { organization: { select: { name: true } }, _count: { select: { registrations: true } } } as const;
  // Le lien de connexion (réservé aux inscrits) n'est jamais lu pour les pages publiques.
  const omit = { onlineUrl: true } as const;
  const top = featured.length ? await db.event.findMany({ where: { ...where, id: { in: featured } }, include, omit, take }) : [];
  const rest = await db.event.findMany({ where: { ...where, id: { notIn: top.map((e) => e.id) } }, include, omit, orderBy: { startsAt: "asc" }, take: take != null ? Math.max(take - top.length, 0) : undefined });
  const sorted = top.sort((a, b) => featured.indexOf(a.id) - featured.indexOf(b.id));
  // Lien suivi de la mise à la une : visites et inscriptions comptées dans le bilan de l'organisateur.
  return [...sorted.map((e) => ({ ...e, featured: true, trackedHref: tracked && codes.get(e.id) ? trackedPath(codes.get(e.id)!) : undefined })), ...rest].map((e) => ({ ...e, registrations: e._count.registrations }));
}

/** Experts référencés tels qu'un visiteur non connecté peut les voir (réglages de visibilité appliqués). */
export async function publicExperts(take?: number): Promise<KolCardData[]> {
  const ps = await db.practitionerProfile.findMany({
    where: { listed: true },
    // Collaborations : les dossiers signés seulement, comme la fiche expert.
    include: { user: { select: { firstName: true, lastName: true } }, projectLinks: { where: { status: { in: SIGNED_STATUSES } }, select: { project: { select: { organizationId: true } } } } },
    // « Réseau vérifié » : les identités vérifiées par KolBase d'abord, puis les plus récemment référencés.
    orderBy: [{ rppsVerified: "desc" }, { listedAt: "desc" }],
    take,
  });
  return ps.map((p) => {
    const v = kolVisibility(p.visibility);
    const contact = canSee(v.contact, "public");
    const activity = canSee(v.historique, "public") && v.projets !== "masque";
    return {
      id: p.id, name: `Dr ${p.user.firstName} ${p.user.lastName}`, specialty: p.specialty, subspecialty: p.subspecialty, profession: p.profession,
      city: contact ? p.city : null, hospital: contact ? p.hospital : null, country: country(p.country).name, verified: p.rppsVerified, types: p.interventionTypes,
      collaborations: activity ? p.projectLinks.length : null,
      organizations: activity ? new Set(p.projectLinks.map((l) => l.project.organizationId)).size : null,
    };
  });
}

export async function publicOrgs(take?: number): Promise<OrgCardData[]> {
  const os = await db.organization.findMany({
    where: { listed: true, verification: "VERIFIED" },
    // Collaborations : les dossiers signés seulement, comme la fiche de l'organisation et celle de l'expert.
    include: { _count: { select: { openCalls: { where: { status: "open" } }, projects: { where: { status: { in: SIGNED_STATUSES } } } } } },
    orderBy: { createdAt: "asc" },
    take,
  });
  return os.map((o) => {
    const v = companyVisibility(o.visibility);
    return {
      id: o.id, name: o.name, logo: logoSrc(o), kind: ORG_KIND_LABEL[o.kind], family: orgFamily(o.kind),
      categories: o.supplierCategories.map(supplierCategoryLabel), coverage: o.coverage, sector: o.sector, about: o.about, hq: o.headquarters,
      areas: canSee(v.areas, "public") ? o.areas : [], openCalls: canSee(v.projets, "public") ? o._count.openCalls : 0, collaborations: o._count.projects,
    };
  });
}

export async function publicCalls(take?: number): Promise<CallCardData[]> {
  const now = new Date();
  const cs = await db.openCall.findMany({
    where: {
      status: "open", organization: { verification: "VERIFIED" },
      AND: [{ OR: [{ deadline: null }, { deadline: { gte: now } }] }, { OR: [{ eventId: null }, { event: { startsAt: { gte: now } } }] }],
    },
    include: { organization: { select: { id: true, name: true, visibility: true, logoUpdatedAt: true } }, event: { select: { title: true, startsAt: true } } },
    orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
  });
  // Pages publiques : seulement les organisations qui affichent leurs appels publiquement (réglage « Appels ouverts ») ;
  // les praticiens connectés voient tous les appels ouverts dans « Opportunités ».
  const visible = cs.filter((c) => canSee(companyVisibility(c.organization.visibility).projets, "public"));
  return visible.slice(0, take).map((c) => ({ id: c.id, title: c.title, specialty: c.specialty, typeId: c.typeId, poster: c.organization.name, posterLogo: logoSrc(c.organization), deadline: c.deadline, description: c.description, budgetMinCents: c.budgetMinCents, budgetMaxCents: c.budgetMaxCents, open: true, event: c.event ? { title: c.event.title, startsAt: c.event.startsAt } : null }));
}

/**
 * Compteurs de l'accueil et de l'aide : les mêmes règles que les pages qui listent (experts, organisations, agenda,
 * appels publics), pour qu'un « 12 appels ouverts » mène à 12 appels.
 */
export async function publicCounts() {
  const [experts, verified, industriels, organizations, events, calls] = await Promise.all([
    db.practitionerProfile.count({ where: { listed: true } }),
    db.practitionerProfile.count({ where: { listed: true, rppsVerified: true } }),
    db.organization.count({ where: { listed: true, verification: "VERIFIED", kind: "INDUSTRIEL" } }),
    db.organization.count({ where: { listed: true, verification: "VERIFIED" } }),
    db.event.count({ where: publicEventWhere() }),
    publicCalls().then((cs) => cs.length),
  ]);
  return { experts, verified, industriels, organizations, events, calls };
}

/** Organisations qui ont au moins un événement à venir ou un appel ouvert visibles du public (« Ils publient sur KolBase »). */
export async function publishingOrgIds() {
  const now = new Date();
  const [events, calls] = await Promise.all([
    db.event.findMany({ where: publicEventWhere(now), select: { organizationId: true }, distinct: ["organizationId"] }),
    publicCalls(),
  ]);
  const callOrgs = await db.openCall.findMany({ where: { id: { in: calls.map((c) => c.id) } }, select: { organizationId: true }, distinct: ["organizationId"] });
  return new Set([...events, ...callOrgs].map((x) => x.organizationId));
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
