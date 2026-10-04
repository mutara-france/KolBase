import Link from "next/link";
import { CalendarDays, ClipboardList, ExternalLink, Gift, Megaphone, Search, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { StatCard } from "@/components/PublicCards";
import { StatusPill } from "@/components/ProjectBits";
import { TodoList, type TodoItem } from "@/components/Todo";
import { db } from "@/lib/db";
import { ORG_KIND_LABEL, ROLE_LABEL, requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES, formatDate, formatDateTime, formatEUR } from "@/lib/events";
import { PROJECT_ROLES, PROJECT_VIEW_ROLES } from "@/lib/projects";

export const metadata = { title: "Tableau de bord — Kolbase" };

const DAY = 864e5;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, roles } = await requireMembership(id);
  const can = { project: roles.some((r) => PROJECT_ROLES.includes(r)), view: roles.some((r) => PROJECT_VIEW_ROLES.includes(r)), events: roles.some((r) => EVENT_MANAGER_ROLES.includes(r)), compliance: roles.some((r) => COMPLIANCE_ROLES.includes(r)), review: roles.includes("RELECTURE") };
  const now = new Date();
  const base = `/organisations/${id}`;

  const reviewQueue = can.review || roles.includes("ADMIN") || can.compliance
    ? await db.materialVersion.findMany({ where: { status: "submitted", material: { project: { organizationId: id } } }, include: { material: { include: { project: { select: { id: true, title: true } } } } } })
    : [];
  const [projects, events, calls, hosp] = await Promise.all([
    can.view ? db.project.findMany({ where: { organizationId: id }, include: { experts: true }, orderBy: { updatedAt: "desc" } }) : Promise.resolve([]),
    can.events || can.compliance ? db.event.findMany({ where: { organizationId: id }, include: { _count: { select: { registrations: true } } }, orderBy: { startsAt: "asc" } }) : Promise.resolve([]),
    can.project ? db.openCall.findMany({ where: { organizationId: id, status: "open" }, include: { applications: { where: { status: "pending" }, select: { id: true } } } }) : Promise.resolve([]),
    can.compliance
      ? db.registration.findMany({ where: { event: { organizationId: id }, profession: { not: null }, declared: false, benefits: { some: {} } }, include: { event: true, benefits: true } })
      : Promise.resolve([]),
  ]);

  const active = projects.filter((p) => !["TERMINE", "DECLINE"].includes(p.status));
  const engaged = active.flatMap((p) => p.experts.filter((e) => !["ATT_EXPERTS", "DECLINE"].includes(e.status)));
  const upcoming = events.filter((e) => e.startsAt >= now);
  const hospValue = hosp.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);
  const pendingApps = calls.reduce((s, c) => s + c.applications.length, 0);

  const todos: TodoItem[] = [];
  const dossier = (p: (typeof projects)[number]) => `${base}/dossiers/${p.id}`;
  if (can.project) {
    for (const p of projects) {
      if (p.status === "ATT_IND") todos.push({ href: dossier(p), title: `Proposition d'expert à examiner : ${p.title}`, icon: "Inbox", tone: "warn" });
      if (p.status === "ACCORD") todos.push({ href: dossier(p), title: `Soumettre à la conformité : ${p.title}`, detail: "Accord de principe obtenu", icon: "ShieldCheck" });
      if (p.status === "BLOQUE") todos.push({ href: dossier(p), title: `Reprendre le dossier : ${p.title}`, detail: p.complianceNote ?? "Bloqué par la conformité", icon: "AlertTriangle", tone: "danger" });
      if (p.status === "VALIDE") todos.push({ href: dossier(p), title: `Choisir le régime : ${p.title}`, detail: "Déclaration simple ou autorisation de l'Ordre", icon: "CircleDot" });
      if (p.status === "ORDRE") todos.push({ href: dossier(p), title: `Réponse de l'Ordre attendue : ${p.title}`, detail: p.ordreRef ?? undefined, icon: "CalendarClock", tone: "warn" });
      if (p.status === "SIGNATURE") todos.push({ href: dossier(p), title: `Convention à faire signer : ${p.title}`, icon: "FileSignature", tone: "warn" });
      if (p.status === "ATT_EXPERTS" && now.getTime() - p.updatedAt.getTime() > 5 * DAY)
        todos.push({ href: dossier(p), title: `Relancer les experts : ${p.title}`, detail: `Sans réponse depuis le ${formatDate(p.updatedAt)}`, icon: "Inbox", tone: "warn" });
    }
    for (const c of calls) if (c.applications.length) todos.push({ href: `${base}/opportunites/${c.id}`, title: `${c.applications.length} candidature${c.applications.length > 1 ? "s" : ""} à examiner`, detail: c.title, icon: "UserRound" });
  }
  if (can.compliance) {
    for (const p of projects)
      if ((p.status === "SIGNE" || p.status === "TERMINE") && !p.declared)
        todos.push({ href: `${base}/conformite?onglet=transparence`, title: `Publier sur Transparence Santé : ${p.title}`, detail: "Convention signée", icon: "FileSignature", tone: "warn" });
    for (const p of projects) if (p.status === "EN_VALID") todos.push({ href: dossier(p), title: `Valider : ${p.title}`, detail: `Soumis le ${formatDate(p.updatedAt)}`, icon: "ShieldCheck", tone: "warn" });
    const byEvent = new Map<string, { title: string; n: number; past: boolean }>();
    for (const r of hosp) {
      const e = byEvent.get(r.eventId) ?? { title: r.event.title, n: 0, past: r.event.startsAt < now };
      e.n++; byEvent.set(r.eventId, e);
    }
    for (const [, e] of byEvent) if (e.past) todos.push({ href: `${base}/hospitalites`, title: `Déclarer les hospitalités : ${e.title}`, detail: `${e.n} bénéficiaire${e.n > 1 ? "s" : ""}`, icon: "FileSignature", tone: "danger" });
  }
  for (const v of reviewQueue)
    todos.push({ href: `${base}/dossiers/${v.material.project.id}`, title: `Support à relire : ${v.material.title} (v${v.version})`, detail: v.material.project.title, icon: "CircleDot" });
  if (can.events) {
    for (const e of events) {
      if (!e.publishedAt && e.startsAt >= now) todos.push({ href: `${base}/evenements/${e.id}`, title: `Brouillon à publier : ${e.title}`, detail: formatDate(e.startsAt), icon: "CalendarClock", tone: "warn" });
      const days = Math.ceil((e.startsAt.getTime() - now.getTime()) / DAY);
      if (e.publishedAt && days >= 0 && days <= 14)
        todos.push({ href: `${base}/evenements/${e.id}`, title: `J-${days} : ${e.title}`, detail: `${e._count.registrations} inscrit${e._count.registrations > 1 ? "s" : ""}${e.capacity ? ` sur ${e.capacity}` : ""}`, icon: "CalendarClock", tone: "ok" });
    }
  }

  const shortcuts = [
    can.view && { href: `${base}/dossiers`, label: "Dossiers", icon: ClipboardList },
    can.project && { href: `${base}/dossiers/nouveau`, label: "Nouveau dossier", icon: ClipboardList },
    can.project && { href: `${base}/opportunites`, label: "Opportunités", icon: Megaphone },
    can.events && { href: `${base}/evenements/nouveau`, label: "Nouvel événement", icon: CalendarDays },
    can.compliance && { href: `${base}/hospitalites`, label: "Hospitalités", icon: Gift },
    { href: "/annuaire", label: "Annuaire des experts", icon: Search },
    { href: `${base}/membres`, label: "Membres et réglages", icon: Users },
    { href: `/structures/${id}`, label: "Page publique", icon: ExternalLink },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Users }[];

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div className="tile-head">
          <Avatar name={org.name} size={52} square />
          <div>
            <span className="eyebrow">{ORG_KIND_LABEL[org.kind]} · {roles.map((r) => ROLE_LABEL[r]).join(", ")}</span>
            <h1>{org.name}</h1>
          </div>
        </div>

        <div className="stats-row">
          {can.view && <StatCard label="Dossiers en cours" value={active.length} hint={`${engaged.length} expert${engaged.length > 1 ? "s" : ""} engagé${engaged.length > 1 ? "s" : ""}`} />}
          {can.view && <StatCard label="Engagement en cours (HT)" value={formatEUR(engaged.reduce((s, e) => s + (e.feeCents ?? 0), 0))} />}
          {can.events && <StatCard label="Événements à venir" value={upcoming.length} hint={`${upcoming.reduce((s, e) => s + e._count.registrations, 0)} inscrits`} electric />}
          {can.project && <StatCard label="Candidatures à traiter" value={pendingApps} hint={`${calls.length} appel${calls.length > 1 ? "s" : ""} ouvert${calls.length > 1 ? "s" : ""}`} />}
          {can.compliance && <StatCard label="À valider" value={projects.filter((p) => p.status === "EN_VALID").length} />}
          {can.compliance && <StatCard label="Hospitalités à déclarer" value={hosp.length} hint={formatEUR(hospValue)} />}
        </div>

        <div className="grid-2 dash-grid">
          <section className="card">
            <h2 className="section-title">À faire ({todos.length})</h2>
            <TodoList items={todos} />
          </section>
          <div className="stack">
            <section className="card">
              <h2 className="section-title">Raccourcis</h2>
              <div className="shortcuts">
                {shortcuts.map((s) => <Link key={s.href} href={s.href} className="shortcut"><s.icon size={16} /> {s.label}</Link>)}
              </div>
            </section>
            {can.view && projects.length > 0 && (
              <section className="card">
                <h2 className="section-title">Derniers dossiers</h2>
                <ul className="mini-list">
                  {projects.slice(0, 5).map((p) => (
                    <li key={p.id} className="flex-between"><Link href={dossier(p)}><strong>{p.title}</strong></Link><StatusPill status={p.status} /></li>
                  ))}
                </ul>
              </section>
            )}
            {(can.events || can.compliance) && upcoming.length > 0 && (
              <section className="card">
                <h2 className="section-title">Prochains événements</h2>
                <ul className="mini-list">
                  {upcoming.slice(0, 4).map((e) => (
                    <li key={e.id}><Link href={`${base}/evenements/${e.id}`}><strong>{e.title}</strong></Link><span className="text-xs">{formatDateTime(e.startsAt)} · {e._count.registrations} inscrit{e._count.registrations > 1 ? "s" : ""}{e.publishedAt ? "" : " · brouillon"}</span></li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
