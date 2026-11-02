import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, eventTypeLabel, formatDate, FORMAT_LABEL } from "@/lib/events";

export const metadata = { title: "Événements — KolBase" };

const DAY = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric" });
const MONTH = (d: Date) => d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", month: "short" });

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { roles, user } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const isOrganizer = roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r));
  const events = await db.event.findMany({
    where: { organizationId: id, ...eventScope(user, roles) },
    include: {
      _count: { select: { registrations: true } },
      agency: { select: { name: true } },
      project: { select: { title: true, _count: { select: { experts: { where: { status: { not: "DECLINE" } } } } } } },
      rfqs: { where: { status: { not: "cancelled" } }, select: { status: true, _count: { select: { quotes: true } } } },
    },
    orderBy: { startsAt: "asc" },
  });
  const now = new Date();
  const upcoming = events.filter((e) => e.startsAt >= now);
  const past = events.filter((e) => e.startsAt < now).reverse();
  const sectionTabs = await orgTabs("evenements", id);

  const Row = ({ e }: { e: (typeof events)[number] }) => {
    const status = e.internal ? { label: "Réunion interne", tone: "electric" } : e.publishedAt ? { label: e.registrationOpen ? "Publié · inscriptions ouvertes" : "Publié · inscriptions closes", tone: e.registrationOpen ? "ok" : "done" } : { label: "Brouillon", tone: "wait" };
    const toCompare = e.rfqs.filter((r) => r.status === "sent" && r._count.quotes > 0).length;
    const awarded = e.rfqs.filter((r) => r.status === "awarded").length;
    const logistics = e.rfqs.length === 0 ? null : toCompare ? `${toCompare} demande${toCompare > 1 ? "s" : ""} de devis à comparer` : `${awarded}/${e.rfqs.length} prestation${e.rfqs.length > 1 ? "s" : ""} attribuée${awarded > 1 ? "s" : ""}`;
    const participants = e.internal ? e.project?._count.experts ?? 0 : e._count.registrations;
    return (
      <Link href={`/organisations/${id}/evenements/${e.id}`} className="row-item">
        <span className="date-block" aria-hidden><strong>{DAY(e.startsAt)}</strong><small>{MONTH(e.startsAt)}</small></span>
        <span className="row-main">
          <strong>{e.title}</strong>
          <span className="muted text-sm">{formatDate(e.startsAt)} · {eventTypeLabel(e.typeId)} · {e.format === "DISTANCIEL" ? "en ligne" : e.city ?? FORMAT_LABEL[e.format]}{e.agency && isOrganizer ? ` · confié à ${e.agency.name}` : ""}</span>
        </span>
        <span className="row-status">
          <span className={`pill ${status.tone}`}>{status.label}</span>
          {logistics && <span className={`text-xs ${toCompare ? "warn-text" : "muted"}`}>{logistics}</span>}
        </span>
        <span className="row-figures">
          <strong>{participants}{e.capacity ? ` / ${e.capacity}` : ""}</strong>
          <span className="text-xs muted">{e.internal ? "participants" : "inscrits"}</span>
        </span>
      </Link>
    );
  };

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="evenements" label="Rubrique Événements" />
        <div className="actions spread">
          <h1>{isOrganizer ? "Événements" : "Événements confiés"}</h1>
          <div className="actions">
            <a className="btn ghost" href={`/organisations/${id}/evenements/calendrier`}>Exporter vers un agenda (.ics)</a>
            {isOrganizer && <Link className="btn" href={`/organisations/${id}/evenements/nouveau`}>Nouvel événement</Link>}
          </div>
        </div>
        {events.length === 0 ? (
          <div className="card empty"><p className="muted">Aucun événement pour l&apos;instant.</p></div>
        ) : (
          <>
            <section className="card row-list" aria-label="Événements à venir">
              <h2 className="section-title">À venir ({upcoming.length})</h2>
              {upcoming.length === 0 ? <p className="muted">Aucun événement à venir.</p> : upcoming.map((e) => <Row key={e.id} e={e} />)}
            </section>
            {past.length > 0 && (
              <section className="card row-list" aria-label="Événements passés">
                <h2 className="section-title">Passés ({past.length})</h2>
                {past.map((e) => <Row key={e.id} e={e} />)}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
