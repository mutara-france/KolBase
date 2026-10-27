import { cache } from "react";
import { cookies } from "next/headers";
import type { TodoItem } from "@/components/Todo";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, formatDate } from "@/lib/events";
import { PROJECT_ROLES, PROJECT_VIEW_ROLES, REVIEW_ROLES, SOURCING_ROLES } from "@/lib/projects";
import { countFor, orgSectionTabs, type OrgSectionKey, type SectionTab } from "@/lib/nav";
import type { OrgRole } from "@/generated/prisma/client";


const DAY = 864e5;

/** Droits d'un ensemble de rôles dans une organisation (une organisation prestataire n'a que ses devis). */
export function orgCan(roles: OrgRole[], kind: string) {
  const has = (list: OrgRole[]) => kind !== "PRESTATAIRE" && roles.some((r) => list.includes(r));
  return {
    sourcing: has(SOURCING_ROLES),
    project: has(PROJECT_ROLES),
    view: has(PROJECT_VIEW_ROLES),
    events: has(EVENT_MANAGER_ROLES),
    organizer: has(EVENT_ORGANIZER_ROLES),
    compliance: has(COMPLIANCE_ROLES),
    review: has(REVIEW_ROLES),
  };
}

/**
 * Vue d'ensemble d'une organisation pour l'utilisateur connecté : les actions qui l'attendent (« À faire »)
 * et les données qui servent au tableau de bord. Mise en cache le temps d'une requête, car l'en-tête
 * (pastilles) et le tableau de bord la demandent tous les deux.
 */
export const orgOverview = cache(async (orgId: string) => {
  const user = await getCurrentUser();
  const memberships = user?.memberships.filter((m) => m.organizationId === orgId) ?? [];
  if (!user || memberships.length === 0) return null;
  const org = memberships[0].organization;
  const roles = memberships.map((m) => m.role);
  const can = orgCan(roles, org.kind);
  const evScope = eventScope(user, roles);
  const now = new Date();
  const base = `/organisations/${orgId}`;

  const [projects, events, calls, hosp, reviewQueue, speakerApps, rfqs, waitingQuotes] = await Promise.all([
    can.view ? db.project.findMany({ where: { organizationId: orgId }, include: { experts: true }, orderBy: { updatedAt: "desc" } }) : Promise.resolve([]),
    can.events || can.compliance
      ? db.event.findMany({ where: { organizationId: orgId, ...(can.compliance ? {} : evScope) }, include: { _count: { select: { registrations: true } } }, orderBy: { startsAt: "asc" } })
      : Promise.resolve([]),
    can.sourcing
      ? db.openCall.findMany({ where: { organizationId: orgId, status: "open" }, include: { applications: { where: { status: "pending" }, select: { id: true } } } })
      : Promise.resolve([]),
    can.compliance
      ? db.registration.findMany({ where: { event: { organizationId: orgId }, profession: { not: null }, declared: false, benefits: { some: {} } }, include: { event: true, benefits: true } })
      : Promise.resolve([]),
    can.review
      ? db.materialVersion.findMany({ where: { status: "submitted", material: { project: { organizationId: orgId } } }, include: { material: { include: { project: { select: { id: true, title: true } } } } } })
      : Promise.resolve([]),
    can.organizer ? db.speakerApplication.groupBy({ by: ["eventId"], where: { status: "pending", event: { organizationId: orgId } }, _count: true }) : Promise.resolve([]),
    can.organizer
      ? db.rfq.findMany({ where: { organizationId: orgId, status: { in: ["draft", "sent"] } }, include: { event: { select: { title: true } }, _count: { select: { quotes: true, suppliers: true } } } })
      : Promise.resolve([]),
    org.kind === "PRESTATAIRE"
      ? db.rfqSupplier.findMany({
          where: { supplierId: orgId, declined: false, rfq: { status: "sent", quotes: { none: { supplierId: orgId } } } },
          include: { rfq: { include: { organization: { select: { name: true } }, event: { select: { title: true } } } } },
        })
      : Promise.resolve([]),
  ]);

  const todos: TodoItem[] = [];
  const dossier = (p: (typeof projects)[number]) => `${base}/dossiers/${p.id}`;
  if (can.project) {
    for (const p of projects) {
      if (p.status === "ATT_IND") todos.push({ href: dossier(p), title: "Proposition d'expert à examiner", detail: p.title, icon: "Inbox" });
      if (p.status === "ACCORD") todos.push({ href: dossier(p), title: `Soumettre à la conformité : ${p.title}`, detail: "Accord de principe obtenu", icon: "ShieldCheck" });
      if (p.status === "BLOQUE") todos.push({ href: dossier(p), title: `Reprendre le dossier : ${p.title}`, detail: p.complianceNote ?? "Bloqué par la conformité", icon: "AlertTriangle", tone: "danger" });
      if (p.status === "VALIDE") todos.push({ href: dossier(p), title: `Choisir le régime : ${p.title}`, detail: "Déclaration simple ou autorisation de l'Ordre", icon: "CircleDot" });
      if (p.status === "ORDRE") todos.push({ href: dossier(p), title: `Réponse de l'Ordre attendue : ${p.title}`, detail: p.ordreRef ?? undefined, icon: "CalendarClock", tone: "warn" });
      if (p.status === "SIGNATURE") todos.push({ href: dossier(p), title: `Convention à faire signer : ${p.title}`, icon: "FileSignature", tone: "warn" });
      if (p.status === "ATT_EXPERTS" && now.getTime() - p.updatedAt.getTime() > 5 * DAY)
        todos.push({ href: dossier(p), title: `Relancer les experts : ${p.title}`, detail: `Sans réponse depuis le ${formatDate(p.updatedAt)}`, icon: "Inbox", tone: "warn" });
    }
  }
  if (can.sourcing) {
    for (const c of calls)
      if (c.applications.length)
        todos.push({ href: `${base}/opportunites/${c.id}`, title: `${c.applications.length} candidature${c.applications.length > 1 ? "s" : ""} à examiner`, detail: c.title, icon: "UserRound" });
  }
  if (can.compliance) {
    for (const p of projects)
      if ((p.status === "SIGNE" || p.status === "TERMINE") && !p.declared)
        todos.push({ href: `${base}/conformite?onglet=transparence`, title: `Publier sur Transparence Santé : ${p.title}`, detail: "Convention signée", icon: "FileSignature", tone: "warn" });
    for (const p of projects)
      if (p.status === "EN_VALID") todos.push({ href: dossier(p), title: `Valider : ${p.title}`, detail: `Soumis le ${formatDate(p.updatedAt)}`, icon: "ShieldCheck", tone: "warn" });
    const byEvent = new Map<string, { title: string; n: number; past: boolean }>();
    for (const r of hosp) {
      const e = byEvent.get(r.eventId) ?? { title: r.event.title, n: 0, past: r.event.startsAt < now };
      e.n++;
      byEvent.set(r.eventId, e);
    }
    for (const [, e] of byEvent)
      if (e.past) todos.push({ href: `${base}/hospitalites`, title: `Déclarer les hospitalités : ${e.title}`, detail: `${e.n} bénéficiaire${e.n > 1 ? "s" : ""} · événement passé`, icon: "FileSignature", tone: "danger" });
  }
  for (const v of reviewQueue)
    todos.push({ href: `${base}/relecture`, title: `Support à relire : ${v.material.title} (v${v.version})`, detail: v.material.project.title, icon: "CircleDot" });
  if (can.events) {
    for (const e of events)
      if (!e.publishedAt && e.startsAt >= now)
        todos.push({ href: `${base}/evenements/${e.id}`, title: `Brouillon à publier : ${e.title}`, detail: formatDate(e.startsAt), icon: "CalendarClock", tone: "warn" });
  }
  if (can.organizer) {
    const n = speakerApps.reduce((s, a) => s + a._count, 0);
    if (n) {
      const titles = events.filter((e) => speakerApps.some((a) => a.eventId === e.id)).map((e) => e.title);
      todos.push({ href: `${base}/intervenants`, title: `${n} candidature${n > 1 ? "s" : ""} d'intervenant à examiner`, detail: titles.join(", ") || undefined, icon: "Mic", tone: "warn" });
    }
    for (const r of rfqs) {
      const label = r.event?.title ?? "Demande de devis";
      if (r.status === "draft") todos.push({ href: `${base}/prestataires`, title: `Demande de devis à envoyer : ${label}`, icon: "Receipt" });
      else if (r._count.quotes > 0)
        todos.push({ href: `${base}/prestataires`, title: `Devis à comparer : ${label}`, detail: `${r._count.quotes} devis reçu${r._count.quotes > 1 ? "s" : ""} sur ${r._count.suppliers} prestataire${r._count.suppliers > 1 ? "s" : ""}`, icon: "Receipt", tone: "warn" });
    }
  }
  for (const w of waitingQuotes)
    todos.push({ href: `${base}/devis`, title: `Devis demandé par ${w.rfq.organization.name}`, detail: w.rfq.event?.title ?? w.rfq.needs.slice(0, 60), icon: "Receipt", tone: "warn" });

  // Les urgences d'abord, puis l'ordre de découverte.
  todos.sort((a, b) => Number(b.tone === "danger") - Number(a.tone === "danger"));

  return { org, roles, can, todos, projects, events, calls, hosp, rfqs };
});

/** Onglets d'une rubrique d'organisation, avec le nombre d'actions qui mènent à chaque onglet. */
export async function orgTabs(section: OrgSectionKey, orgId: string): Promise<SectionTab[]> {
  const o = await orgOverview(orgId);
  if (!o) return [];
  const hrefs = o.todos.map((t) => t.href);
  return orgSectionTabs(section, orgId, o.roles, o.org.kind).map((t) => ({ ...t, count: countFor({ href: t.href }, hrefs) }));
}

/**
 * Organisation de référence pour les pages communes à plusieurs espaces (annuaire, suivis) :
 * l'espace mémorisé s'il donne accès à l'annuaire, sinon la première organisation qui y donne accès.
 */
export async function currentSourcingOrg() {
  const user = await getCurrentUser();
  if (!user) return null;
  const eligible = user.memberships.filter((m) => SOURCING_ROLES.includes(m.role) && m.organization.kind !== "PRESTATAIRE").map((m) => m.organizationId);
  if (eligible.length === 0) return null;
  const pref = (await cookies()).get("kb_espace")?.value;
  return pref && eligible.includes(decodeURIComponent(pref)) ? decodeURIComponent(pref) : eligible[0];
}
