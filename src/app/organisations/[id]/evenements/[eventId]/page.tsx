import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventScope, eventTypeLabel, formatDate, formatDateTime, formatEUR, FORMAT_LABEL } from "@/lib/events";
import { setEventAgency, setEventFlag } from "@/lib/event-actions";

export const metadata = { title: "Événement — Kolbase" };

export default async function Page({ params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const { org, roles, user } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const isOrganizer = roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r));
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: id, ...eventScope(user, roles) },
    include: {
      agency: { select: { name: true } },
      benefits: true,
      registrations: { include: { user: true, benefits: { include: { benefit: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!event) notFound();
  const totalCents = event.registrations.reduce((s, r) => s + r.benefits.reduce((x, b) => x + b.valueCents, 0), 0);
  const withBenefits = event.registrations.filter((r) => r.benefits.length > 0).length;

  const agencies = isOrganizer ? await db.mandate.findMany({ where: { mandatorId: id }, include: { agency: { select: { id: true, name: true } } } }) : [];
  const AgencyForm = () =>
    agencies.length === 0 ? null : (
      <form action={setEventAgency} className="inline wrap">
        <input type="hidden" name="orgId" value={id} />
        <input type="hidden" name="eventId" value={eventId} />
        <label className="muted">Agence mandatée
          <select name="agencyId" defaultValue={event.agencyId ?? ""}>
            <option value="">— aucune (géré en interne) —</option>
            {agencies.map((m) => <option key={m.agency.id} value={m.agency.id}>{m.agency.name}</option>)}
          </select>
        </label>
        <button className="btn ghost small">Confier</button>
      </form>
    );

  const Flag = ({ flag, label, ghost }: { flag: string; label: string; ghost?: boolean }) => (
    <form action={setEventFlag}>
      <input type="hidden" name="orgId" value={id} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="flag" value={flag} />
      <button className={ghost ? "btn ghost" : "btn"}>{label}</button>
    </form>
  );

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/evenements`}>Événements</Link></p>
        <div>
          <span className="tag">{eventTypeLabel(event.typeId)}</span>
          <h1>{event.title}</h1>
          <p className="muted">
            {formatDateTime(event.startsAt)} · {FORMAT_LABEL[event.format]}{event.city ? ` · ${event.city}` : ""} ·{" "}
            {event.publishedAt ? <Link href={`/evenements/${event.id}`}>publié dans l&apos;agenda</Link> : "brouillon"}
          </p>
        </div>
        <div className="actions">
          {event.publishedAt ? <Flag flag="unpublish" label="Retirer de l'agenda" ghost /> : <Flag flag="publish" label="Publier dans l'agenda" />}
          {event.registrationOpen ? <Flag flag="close" label="Fermer les inscriptions" ghost /> : <Flag flag="open" label="Rouvrir les inscriptions" ghost />}
        </div>
        {isOrganizer ? (
          <AgencyForm />
        ) : (
          <p className="notice ok">Événement confié à {event.agency?.name ?? "votre agence"} par {org.name}.</p>
        )}
        <div className="stats">
          <div className="card stat"><span className="muted">Inscrits</span><strong>{event.registrations.length}{event.capacity ? ` / ${event.capacity}` : ""}</strong></div>
          <div className="card stat"><span className="muted">Avec hospitalités</span><strong>{withBenefits}</strong></div>
          <div className="card stat"><span className="muted">Valeur totale</span><strong>{formatEUR(totalCents)}</strong></div>
        </div>
        <section className="card">
          <div className="actions spread">
            <h2>Inscrits</h2>
            {event.registrations.length > 0 && <a className="btn ghost" href={`/organisations/${id}/evenements/${eventId}/export`}>Exporter (CSV)</a>}
          </div>
          {event.registrations.length === 0 ? (
            <p className="muted">Aucune inscription pour l&apos;instant.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Nom</th><th>Profession</th><th>Structure</th><th>Prestations acceptées</th><th>Valeur</th><th>Inscrit le</th></tr></thead>
              <tbody>
                {event.registrations.map((r) => (
                  <tr key={r.id}>
                    <td>{r.user.firstName} {r.user.lastName}</td>
                    <td>{r.profession ?? "—"}</td>
                    <td>{r.structure ?? "—"}</td>
                    <td>{r.benefits.map((b) => b.benefit.label).join(", ") || "Aucune"}</td>
                    <td>{formatEUR(r.benefits.reduce((s, b) => s + b.valueCents, 0))}</td>
                    <td>{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Prestations proposées</h2>
          {event.benefits.length === 0 ? <p className="muted">Aucune.</p> : (
            <ul className="plain">{event.benefits.map((b) => <li key={b.id}>{b.label} — {formatEUR(b.valueCents)}</li>)}</ul>
          )}
        </section>
      </main>
    </>
  );
}
