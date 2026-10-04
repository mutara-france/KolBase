import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventTypeLabel, formatDate } from "@/lib/events";

export const metadata = { title: "Événements — Kolbase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const events = await db.event.findMany({
    where: { organizationId: id },
    include: { _count: { select: { registrations: true } } },
    orderBy: { startsAt: "desc" },
  });
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Événements</p>
        <div className="actions spread">
          <h1>Événements</h1>
          <div className="actions">
            <a className="btn ghost" href={`/organisations/${id}/evenements/calendrier`}>Exporter vers un agenda (.ics)</a>
            <Link className="btn" href={`/organisations/${id}/evenements/nouveau`}>Nouvel événement</Link>
          </div>
        </div>
        {events.length === 0 ? (
          <p className="muted">Aucun événement pour l&apos;instant.</p>
        ) : (
          <section className="card">
            <table className="table">
              <thead><tr><th>Date</th><th>Titre</th><th>Type</th><th>Statut</th><th>Inscrits</th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.startsAt)}</td>
                    <td><Link href={`/organisations/${id}/evenements/${e.id}`}>{e.title}</Link></td>
                    <td>{eventTypeLabel(e.typeId)}</td>
                    <td>{e.publishedAt ? (e.registrationOpen ? "Publié · inscriptions ouvertes" : "Publié · inscriptions closes") : "Brouillon"}</td>
                    <td>{e._count.registrations}{e.capacity ? ` / ${e.capacity}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </>
  );
}
