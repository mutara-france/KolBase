import { cache } from "react";
import { cookies } from "next/headers";
import type { TodoItem } from "@/components/Todo";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventEnded, eventScope, formatDate, needsOnlineLink } from "@/lib/events";
import { PROJECT_ROLES, PROJECT_VIEW_ROLES, recruitmentOpen, REVIEW_ROLES, SOURCING_ROLES } from "@/lib/projects";
import { orgSectionTabs, tabCount, type OrgSectionKey, type SectionTab } from "@/lib/nav";
import type { OrgRole } from "@/generated/prisma/client";
import { billingBlocked } from "@/lib/billing";
import { pointedPastEvents } from "@/lib/checkin";
import { toDeclare } from "@/lib/indicators";
import { subscribeHref } from "@/lib/billing-plans";
import { activeMandate } from "@/lib/mandates";
import { de } from "@/lib/elision";
import { rfqConflict } from "@/lib/suppliers";
import { getT } from "@/lib/i18n/server";
import { complianceSettings, hospitalityRegime } from "@/lib/compliance";
import { practicesInFrance } from "@/lib/countries";


const DAY = 864e5;
const LOOKBACK_DAYS = 7;

/** Droits d'un ensemble de rôles dans une organisation (une organisation prestataire n'a que ses devis). */
function orgCan(roles: OrgRole[], kind: string) {
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
  // Agence mandatée : seulement les demandes de devis des événements qui lui sont confiés.
  const rfqScope = Object.keys(evScope).length ? { event: evScope } : {};
  const ownOrgs = user.memberships.filter((m) => m.organization.kind === "PRESTATAIRE").map((m) => m.organizationId);

  // Calculée à chaque page de l'espace (pastilles de l'en-tête) : seulement ce qui peut encore demander une action,
  // pas tout l'historique de l'organisation. Dossiers : en cours, ou terminés sans déclaration Transparence Santé.
  // Événements : à venir ou en cours ; un événement commencé il y a plus de LOOKBACK n'est en cours que si sa durée
  // dépasse LOOKBACK (eventEnd : début + durée).
  const lookback = new Date(now.getTime() - LOOKBACK_DAYS * DAY);
  const [projects, events, calls, undeclared, reviewQueue, rfqs, waitingQuotes] = await Promise.all([
    can.view
      ? db.project.findMany({
          where: { organizationId: orgId, OR: [{ status: { notIn: ["TERMINE", "DECLINE"] } }, { status: "TERMINE", declared: false }] },
          include: { experts: true },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    can.events || can.compliance
      ? db.event.findMany({
          where: { organizationId: orgId, ...(can.compliance ? {} : evScope), OR: [{ startsAt: { gte: lookback } }, { durationMinutes: { gt: LOOKBACK_DAYS * 24 * 60 } }] },
          include: { _count: { select: { registrations: true } } },
          orderBy: { startsAt: "asc" },
        })
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
    can.events
      ? db.rfq.findMany({ where: { organizationId: orgId, status: { in: ["draft", "sent"] }, ...rfqScope }, include: { event: { select: { title: true } }, suppliers: { select: { supplierId: true } }, _count: { select: { quotes: true, suppliers: true } } } })
      : Promise.resolve([]),
    org.kind === "PRESTATAIRE"
      ? db.rfqSupplier.findMany({
          where: { supplierId: orgId, declined: false, rfq: { status: "sent", quotes: { none: { supplierId: orgId } } } },
          include: { rfq: { include: { organization: { select: { name: true } }, event: { select: { title: true } } } } },
        })
      : Promise.resolve([]),
  ]);

  // Hospitalités soumises à autorisation de l'Ordre (praticiens exerçant en France) pour un événement à venir : la
  // demande est à faire avant le délai (paramètres de conformité). Même règle que Conformité › Autorisations.
  const authRegs = can.compliance
    ? await db.registration.findMany({
        where: { event: { organizationId: orgId, startsAt: { gte: now }, cancelledAt: null }, profession: { not: null }, cancelledAt: null, benefits: { some: {} } },
        include: { event: { select: { id: true, title: true, startsAt: true } }, user: { select: { practitioner: { select: { country: true } } } }, benefits: { include: { benefit: { select: { catalogId: true } } } } },
      })
    : [];
  const limits = complianceSettings(org.complianceSettings);
  const authByEvent = new Map<string, { title: string; startsAt: Date; n: number }>();
  for (const r of authRegs) {
    if (!practicesInFrance(r.user.practitioner?.country ?? "FR")) continue;
    if (hospitalityRegime(limits, r.benefits.map((b) => ({ catalogId: b.benefit.catalogId, valueCents: b.valueCents }))).regime !== "autorisation") continue;
    const e = authByEvent.get(r.event.id) ?? { title: r.event.title, startsAt: r.event.startsAt, n: 0 };
    e.n++;
    authByEvent.set(r.event.id, e);
  }

  // Hospitalités à déclarer : pas celles des absents au pointage (avantage non consommé).
  const pointed = await pointedPastEvents(undeclared.map((r) => r.eventId));
  const hosp = undeclared.filter((r) => toDeclare(r, pointed.has(r.eventId)));
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
      // Contre-proposition d'un expert : accepter ses honoraires ou lui renvoyer une proposition.
      if (recruitmentOpen(p.status) && p.experts.some((e) => e.status === "ATT_EXPERTS" && e.desiredFeeCents != null))
        todos.push({ href: dossier(p), title: `Honoraires proposés par un expert : ${p.title}`, detail: "Accepter ou proposer d'autres conditions", icon: "Inbox", tone: "warn" });
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
      if (p.status === "EN_VALID") todos.push({ href: dossier(p), title: `Valider : ${p.title}`, detail: `Soumis le ${formatDate(p.updatedAt)}`, icon: "ShieldCheck", tone: "warn", tab: "a-valider" });
    const byEvent = new Map<string, { title: string; n: number; past: boolean }>();
    for (const r of hosp) {
      const e = byEvent.get(r.eventId) ?? { title: r.event.title, n: 0, past: eventEnded(r.event, now) };
      e.n++;
      byEvent.set(r.eventId, e);
    }
    for (const [, e] of byEvent)
      if (e.past) todos.push({ href: `${base}/hospitalites`, title: `Déclarer les hospitalités : ${e.title}`, detail: `${e.n} bénéficiaire${e.n > 1 ? "s" : ""} · événement passé`, icon: "FileSignature", tone: "danger" });
    for (const [, e] of authByEvent) {
      const by = new Date(e.startsAt.getTime() - limits.authorizationDays * DAY);
      todos.push({
        href: `${base}/conformite?onglet=autorisations`, title: `Autorisation d'hospitalité à demander : ${e.title}`,
        detail: `${e.n} bénéficiaire${e.n > 1 ? "s" : ""} · ${by < now ? "délai d'autorisation dépassé" : `avant le ${formatDate(by)}`}`,
        icon: "ShieldCheck", tone: by < now ? "danger" : "warn", tab: "autorisations",
      });
    }
  }
  for (const v of reviewQueue)
    todos.push({ href: `${base}/relecture`, title: `Support à relire : ${v.material.title} (v${v.version})`, detail: v.material.project.title, icon: "CircleDot" });
  if (can.events) {
    for (const e of events)
      if (!e.publishedAt && !e.internal && !e.cancelledAt && e.startsAt >= now)
        todos.push({ href: `${base}/evenements/${e.id}`, title: `Brouillon à publier : ${e.title}`, detail: formatDate(e.startsAt), icon: "CalendarClock", tone: "warn" });
    // Événement en ligne ou hybride à deux jours sans lien de connexion : les inscrits ne pourraient pas se connecter.
    for (const e of events)
      if (!e.cancelledAt && needsOnlineLink(e, now))
        todos.push({ href: `${base}/evenements/${e.id}#modifier`, title: `Ajouter le lien de connexion : ${e.title}`, detail: `${formatDate(e.startsAt)} · ${e._count.registrations} inscrit${e._count.registrations > 1 ? "s" : ""}`, icon: "AlertTriangle", tone: "danger" });
  }
  // Organisateurs, et agence mandatée pour les événements qui lui sont confiés.
  if (can.events) {
    for (const r of rfqs) {
      // Agence consultée sur la demande : l'organisation la conduit seule, rien à faire ici pour l'agence.
      if (rfqConflict(r.suppliers.map((s) => s.supplierId), ownOrgs)) continue;
      const label = r.event?.title ?? "Demande de devis";
      if (r.status === "draft") todos.push({ href: `${base}/prestataires`, title: `Demande de devis à envoyer : ${label}`, icon: "Receipt" });
      else if (r.proposedQuoteId && can.organizer)
        todos.push({ href: `${base}/prestataires#rfq-${r.id}`, title: `Devis à retenir : ${label}`, detail: "Proposé par l'agence mandatée", icon: "Receipt", tone: "warn" });
      else if (r._count.quotes > 0)
        todos.push({ href: `${base}/prestataires`, title: `Devis à comparer : ${label}`, detail: `${r._count.quotes} devis reçu${r._count.quotes > 1 ? "s" : ""} sur ${r._count.suppliers} prestataire${r._count.suppliers > 1 ? "s" : ""}`, icon: "Receipt", tone: "warn" });
    }
  }
  for (const w of waitingQuotes)
    todos.push({ href: `${base}/devis`, title: `Devis demandé par ${w.rfq.organization.name}`, detail: w.rfq.event?.title ?? w.rfq.needs.slice(0, 60), icon: "Receipt", tone: "warn" });
  // Prestataire : après un premier devis retenu, l'abonnement est à activer pour répondre à de nouvelles demandes.
  if (org.kind === "PRESTATAIRE" && roles.includes("ADMIN") && (await billingBlocked(orgId, "reponse")))
    todos.unshift({ href: subscribeHref(orgId, "reponse"), title: "Activer l'abonnement", detail: "Premier devis retenu : l'abonnement (premier mois offert) permet de répondre à de nouvelles demandes", icon: "Receipt", tone: "warn" });

  // Questions sur les demandes de devis restées sans réponse : la dernière parole revient à l'autre partie.
  const isSupplier = org.kind === "PRESTATAIRE";
  if (isSupplier || can.events) {
    const msgs = await db.rfqMessage.findMany({
      where: {
        rfq: {
          status: { in: ["sent", "awarded"] },
          // Côté client, pas les demandes où l'organisation de l'utilisateur (agence) est elle-même consultée.
          ...(isSupplier ? {} : { organizationId: orgId, ...rfqScope, ...(ownOrgs.length ? { suppliers: { none: { supplierId: { in: ownOrgs } } } } : {}) }),
        },
        // Une agence ne se répond pas à elle-même : ses propres fils de prestataire sont dans son espace.
        ...(isSupplier ? { supplierId: orgId } : ownOrgs.length ? { supplierId: { notIn: ownOrgs } } : {}),
      },
      include: { supplier: { select: { name: true } }, rfq: { select: { id: true, organization: { select: { name: true } }, event: { select: { title: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const seen = new Set<string>();
    for (const m of msgs) {
      const key = `${m.rfqId}:${m.supplierId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isSupplier && !m.fromSupplier)
        todos.push({ href: `${base}/devis`, title: `Message ${de(m.rfq.organization.name)}`, detail: m.rfq.event?.title ?? "Demande de devis", icon: "MessageSquare", tone: "warn" });
      if (!isSupplier && m.fromSupplier)
        todos.push({ href: `${base}/prestataires#rfq-${m.rfqId}`, title: `Question ${de(m.supplier.name)}`, detail: m.rfq.event?.title ?? "Demande de devis", icon: "MessageSquare", tone: "warn" });
    }
  }

  // Agence : les devis et questions des événements que ses clients lui confient (mandat actif), sans ses propres fils.
  if (isSupplier) {
    const confided = await db.rfq.findMany({
      // Sauf les demandes où l'agence est elle-même consultée : elle y répond comme prestataire (« Devis demandé par… »).
      where: { status: "sent", event: { agencyId: orgId }, suppliers: { none: { supplierId: orgId } }, organization: { mandatesGiven: { some: { agencyId: orgId, ...activeMandate(now) } } } },
      include: {
        organization: { select: { name: true } },
        event: { select: { title: true } },
        _count: { select: { quotes: { where: { supplierId: { not: orgId } } } } },
        messages: { where: { supplierId: { not: orgId } }, orderBy: { createdAt: "desc" }, select: { supplierId: true, fromSupplier: true, supplier: { select: { name: true } } } },
      },
    });
    for (const r of confided) {
      const href = `/organisations/${r.organizationId}/prestataires#rfq-${r.id}`;
      const label = r.event?.title ?? "Demande de devis";
      if (r._count.quotes > 0 && !r.proposedQuoteId)
        todos.push({ href, title: `Devis à comparer : ${label}`, detail: `${r.organization.name} · ${r._count.quotes} devis reçu${r._count.quotes > 1 ? "s" : ""}`, icon: "Receipt", tone: "warn" });
      const seen = new Set<string>();
      for (const m of r.messages) {
        if (seen.has(m.supplierId)) continue;
        seen.add(m.supplierId);
        if (m.fromSupplier) todos.push({ href, title: `Question ${de(m.supplier.name)}`, detail: `${label} · ${r.organization.name}`, icon: "MessageSquare", tone: "warn" });
      }
    }
  }

  // Les urgences d'abord, puis l'ordre de découverte.
  todos.sort((a, b) => Number(b.tone === "danger") - Number(a.tone === "danger"));

  return { org, roles, can, todos, projects, events, calls, hosp, rfqs };
});

/** Onglets d'une rubrique d'organisation, avec le nombre d'actions qui mènent à chaque onglet. */
export async function orgTabs(section: OrgSectionKey, orgId: string): Promise<SectionTab[]> {
  const o = await orgOverview(orgId);
  if (!o) return [];
  const tabs = orgSectionTabs(section, orgId, o.roles, o.org.kind);
  // Onglets traduits comme la navigation de l'espace (nav.ts).
  const { t } = await getT();
  return tabs.map((tab) => ({ ...tab, label: t(tab.label), count: tabCount(tab, tabs, o.todos) }));
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
