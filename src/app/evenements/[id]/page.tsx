import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { RegisterForm } from "@/components/EventForms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { eventTypeLabel, formatDateTime, formatEUR, FORMAT_LABEL, isHcp } from "@/lib/events";
import { cancelRegistration } from "@/lib/event-actions";

export const metadata = { title: "Événement — Kolbase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event, user] = await Promise.all([
    db.event.findFirst({
      where: { id, publishedAt: { not: null } },
      include: { organization: true, benefits: true, _count: { select: { registrations: true } } },
    }),
    getCurrentUser(),
  ]);
  if (!event) notFound();
  const reg = user
    ? await db.registration.findUnique({ where: { eventId_userId: { eventId: id, userId: user.id } }, include: { benefits: { include: { benefit: true } } } })
    : null;
  const full = event.capacity != null && event._count.registrations >= event.capacity;
  const past = event.startsAt < new Date();
  const back = encodeURIComponent(`/evenements/${id}`);

  return (
    <>
      <SiteHeader variant="public" />
      <main className="narrow stack">
        <div>
          <span className="tag">{eventTypeLabel(event.typeId)}</span>
          <h1>{event.title}</h1>
          <p className="muted">Organisé par {event.organization.name}</p>
          {!past && <a className="btn ghost small" href={`/evenements/${id}/calendrier`}><CalendarPlus size={14} /> Ajouter à mon agenda</a>}
        </div>
        <section className="card">
          <dl className="facts">
            <dt>Date</dt><dd>{formatDateTime(event.startsAt)}</dd>
            {event.durationMinutes && (<><dt>Durée</dt><dd>{Math.floor(event.durationMinutes / 60)} h {String(event.durationMinutes % 60).padStart(2, "0")}</dd></>)}
            <dt>Format</dt><dd>{FORMAT_LABEL[event.format]}</dd>
            {(event.venue || event.city) && (<><dt>Lieu</dt><dd>{[event.venue, event.city].filter(Boolean).join(", ")}</dd></>)}
            {event.therapeuticArea && (<><dt>Domaine</dt><dd>{event.therapeuticArea}</dd></>)}
            {event.capacity && (<><dt>Places</dt><dd>{Math.max(0, event.capacity - event._count.registrations)} restantes sur {event.capacity}</dd></>)}
          </dl>
        </section>
        {event.description && <section className="card"><h2>Programme</h2><p>{event.description}</p></section>}
        <section className="card">
          <h2>Prestations proposées</h2>
          {event.benefits.length === 0 ? (
            <p className="muted">Aucune prise en charge : les participants viennent à leurs frais.</p>
          ) : (
            <ul className="plain">{event.benefits.map((b) => <li key={b.id}>{b.label} <span className="muted">— {formatEUR(b.valueCents)} par personne</span></li>)}</ul>
          )}
        </section>
        {event.speakerCallOpen && !past && (!event.speakerDeadline || event.speakerDeadline >= new Date()) && (
          <section className="card">
            <h2>Appel à intervenants</h2>
            <p className="muted">
              L&apos;organisateur recherche {event.speakerSlots ? `${event.speakerSlots} intervenant${event.speakerSlots > 1 ? "s" : ""}` : "des intervenants"}
              {event.speakerDeadline ? ` (candidatures jusqu'au ${formatDateTime(event.speakerDeadline).split(" à")[0]})` : ""}.
            </p>
            {event.speakerProfile && <p>{event.speakerProfile}</p>}
            {user?.practitioner?.listed ? (
              <Link className="btn ghost" href="/interventions?onglet=appels">Candidater depuis Mes interventions</Link>
            ) : (
              <p className="hint">Réservé aux experts référencés.</p>
            )}
          </section>
        )}
        <section className="card highlight">
          <h2>Inscription</h2>
          {reg ? (
            <>
              <p className="notice ok">Vous êtes inscrit à cet événement.</p>
              <p className="muted">
                {reg.benefits.length === 0
                  ? "Vous n'avez accepté aucune prestation."
                  : `Prestations acceptées : ${reg.benefits.map((b) => b.benefit.label).join(", ")} (${formatEUR(reg.benefits.reduce((s, b) => s + b.valueCents, 0))}).`}
              </p>
              {!reg.declared && !past && (
                <form action={cancelRegistration}><input type="hidden" name="eventId" value={id} /><button className="btn ghost">Annuler mon inscription</button></form>
              )}
            </>
          ) : past ? (
            <p className="muted">Cet événement a eu lieu.</p>
          ) : !event.registrationOpen ? (
            <p className="muted">Les inscriptions sont closes.</p>
          ) : full ? (
            <p className="muted">L&apos;événement est complet.</p>
          ) : !user ? (
            <>
              <p className="muted">L&apos;inscription est nominative : connectez-vous pour vous inscrire et choisir les prestations que vous acceptez.</p>
              <div className="actions">
                <Link className="btn" href={`/connexion?next=${back}`}>Se connecter</Link>
                <Link className="btn ghost" href={`/inscription?next=${back}`}>Créer un compte</Link>
              </div>
            </>
          ) : (
            <RegisterForm
              eventId={id}
              hcp={isHcp(user)}
              defaultStructure={user.practitioner?.hospital ?? ""}
              benefits={event.benefits.map((b) => ({ id: b.id, label: b.label, valueCents: b.valueCents }))}
            />
          )}
        </section>
      </main>
    </>
  );
}
