import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { RegisterForm } from "@/components/EventForms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { eventTypeLabel, FORMAT_LABEL, isHcp } from "@/lib/events";
import { cancelRegistration } from "@/lib/event-actions";
import type { Metadata } from "next";
import { fmtDate, fmtEur, type Locale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

/** « lundi 3 novembre 2026 à 14:00 » / « Monday, 3 November 2026 at 14:00 » (heure de Paris). */
const dateTime = (locale: Locale, d: Date) => fmtDate(locale, d, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { t, locale } = await getT();
  const e = await db.event.findFirst({ where: { id, publishedAt: { not: null }, organization: { verification: "VERIFIED" } }, include: { organization: { select: { name: true } } } });
  if (!e) return { title: t("Événement — KolBase"), robots: { index: false } };
  return {
    title: `${e.title} — ${e.organization.name} — KolBase`,
    description: `${t(eventTypeLabel(e.typeId))} · ${dateTime(locale, e.startsAt)}${e.city ? ` · ${e.city}` : ""}. ${e.description ?? ""}`.trim().slice(0, 160),
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [event, user] = await Promise.all([
    db.event.findFirst({
      where: { id, publishedAt: { not: null }, organization: { verification: "VERIFIED" } },
      include: { organization: true, benefits: true, _count: { select: { registrations: true } } },
    }),
    getCurrentUser(),
  ]);
  if (!event) notFound();
  const { t, locale } = await getT();
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
          <span className="tag">{t(eventTypeLabel(event.typeId))}</span>
          <h1>{event.title}</h1>
          <p className="muted">{t("Organisé par {name}", { name: event.organization.name })}</p>
          {!past && <a className="btn ghost small" href={`/evenements/${id}/calendrier`}><CalendarPlus size={14} /> {t("Ajouter à mon agenda")}</a>}
        </div>
        <section className="card">
          <dl className="facts">
            <dt>{t("Date")}</dt><dd>{dateTime(locale, event.startsAt)}</dd>
            {event.durationMinutes && (<><dt>{t("Durée")}</dt><dd>{t("{h} h {m}", { h: Math.floor(event.durationMinutes / 60), m: String(event.durationMinutes % 60).padStart(2, "0") })}</dd></>)}
            <dt>{t("Format")}</dt><dd>{t(FORMAT_LABEL[event.format])}</dd>
            {(event.venue || event.city) && (<><dt>{t("Lieu")}</dt><dd>{[event.venue, event.city].filter(Boolean).join(", ")}</dd></>)}
            {event.therapeuticArea && (<><dt>{t("Domaine")}</dt><dd>{t(event.therapeuticArea)}</dd></>)}
            {event.capacity && (<><dt>{t("Places")}</dt><dd>{t("{n} restantes sur {capacity}", { n: Math.max(0, event.capacity - event._count.registrations), capacity: event.capacity })}</dd></>)}
          </dl>
        </section>
        {event.description && <section className="card"><h2>{t("Programme")}</h2><p>{event.description}</p></section>}
        <section className="card">
          <h2>{t("Prestations proposées")}</h2>
          {event.benefits.length === 0 ? (
            <p className="muted">{t("Aucune prise en charge : les participants viennent à leurs frais.")}</p>
          ) : (
            <ul className="plain">{event.benefits.map((b) => <li key={b.id}>{t(b.label)} <span className="muted">{t("— {amount} par personne", { amount: fmtEur(locale, b.valueCents) })}</span></li>)}</ul>
          )}
        </section>
        {event.speakerCallOpen && !past && (!event.speakerDeadline || event.speakerDeadline >= new Date()) && (
          <section className="card">
            <h2>{t("Appel à intervenants")}</h2>
            <p className="muted">
              {(() => {
                const who = event.speakerSlots ? t(event.speakerSlots > 1 ? "{n} intervenants" : "{n} intervenant", { n: event.speakerSlots }) : t("des intervenants");
                return event.speakerDeadline
                  ? t("L'organisateur recherche {who} (candidatures jusqu'au {date}).", { who, date: fmtDate(locale, event.speakerDeadline, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) })
                  : t("L'organisateur recherche {who}.", { who });
              })()}
            </p>
            {event.speakerProfile && <p>{event.speakerProfile}</p>}
            {user?.practitioner?.listed ? (
              <Link className="btn ghost" href="/interventions?onglet=appels">{t("Candidater depuis Mes interventions")}</Link>
            ) : (
              <p className="hint">{t("Réservé aux experts référencés.")}</p>
            )}
          </section>
        )}
        <section className="card highlight">
          <h2>{t("Inscription")}</h2>
          {reg ? (
            <>
              <p className="notice ok">{t("Vous êtes inscrit à cet événement.")}</p>
              <p className="muted">
                {reg.benefits.length === 0
                  ? t("Vous n'avez accepté aucune prestation.")
                  : t("Prestations acceptées : {list} ({total}).", { list: reg.benefits.map((b) => t(b.benefit.label)).join(", "), total: fmtEur(locale, reg.benefits.reduce((s, b) => s + b.valueCents, 0)) })}
              </p>
              {!reg.declared && !past && (
                <form action={cancelRegistration}><input type="hidden" name="eventId" value={id} /><button className="btn ghost">{t("Annuler mon inscription")}</button></form>
              )}
            </>
          ) : past ? (
            <p className="muted">{t("Cet événement a eu lieu.")}</p>
          ) : !event.registrationOpen ? (
            <p className="muted">{t("Les inscriptions sont closes.")}</p>
          ) : full ? (
            <p className="muted">{t("L'événement est complet.")}</p>
          ) : !user ? (
            <>
              <p className="notice ok">{t("Inscription réservée aux membres KolBase : elle est nominative, car les hospitalités acceptées sont rattachées à votre nom. Créez votre compte en une minute, vous reviendrez ici pour vous inscrire.")}</p>
              <div className="actions">
                <Link className="btn" href={`/inscription?next=${back}`}>{t("Créer mon compte et m'inscrire")}</Link>
                <Link className="btn ghost" href={`/connexion?next=${back}`}>{t("J'ai déjà un compte")}</Link>
              </div>
            </>
          ) : (
            <RegisterForm
              eventId={id}
              hcp={isHcp(user)}
              defaultStructure={user.practitioner?.hospital ?? ""}
              benefits={event.benefits.map((b) => ({ id: b.id, label: t(b.label), valueCents: b.valueCents }))}
            />
          )}
        </section>
      </main>
    </>
  );
}
