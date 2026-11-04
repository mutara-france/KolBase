import Link from "next/link";
import { attended, eventEnded } from "@/lib/event-followup";
import { CalendarDays, CalendarPlus, Gift, MapPin, Users } from "lucide-react";
import { PageHero } from "@/components/PageHero";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { RegisterForm } from "@/components/EventForms";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { EVENT_STATE_LABEL, eventState, eventTypeLabel, formatDuration, FORMAT_LABEL, isHcp } from "@/lib/events";
import { cancelRegistration } from "@/lib/event-actions";
import type { Metadata } from "next";
import { fmtDate, fmtEur, intlLocale, type Locale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { appUrl } from "@/lib/ics";
import { jsonLd } from "@/lib/jsonld";
import { orgIsPublic } from "@/lib/org-roles";
import { ConfirmButton } from "@/components/ConfirmButton";
import { isDemoOrgId } from "@/lib/demo";

/** « lundi 3 novembre 2026 à 14:00 » / « Monday, 3 November 2026 at 14:00 » (heure de Paris). */
const dateTime = (locale: Locale, d: Date) => fmtDate(locale, d, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { t, locale } = await getT();
  const e = await db.event.findFirst({ where: { id, OR: [{ publishedAt: { not: null } }, { cancelledAt: { not: null } }], organization: { verification: "VERIFIED" } }, include: { organization: { select: { name: true } } } });
  if (!e) return { title: t("Événement — KolBase"), robots: { index: false } };
  if (e.cancelledAt) return { title: `${t("Événement annulé")} : ${e.title} — KolBase`, robots: { index: false } };
  const description = `${t(eventTypeLabel(e.typeId))} · ${dateTime(locale, e.startsAt)}${e.city ? ` · ${e.city}` : ""}. ${e.description ?? ""}`.trim().slice(0, 160);
  return {
    title: `${e.title} — ${e.organization.name} — KolBase`,
    description,
    alternates: { canonical: `/evenements/${e.id}` },
    // Aperçu de partage (LinkedIn, WhatsApp…) : l'image est générée par opengraph-image.tsx.
    openGraph: { type: "website", siteName: "KolBase", url: `/evenements/${e.id}`, title: `${e.title} — ${e.organization.name}`, description },
    ...(isDemoOrgId(e.organizationId) ? { robots: { index: false } } : {}),
  };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ annulee?: string }> }) {
  const { id } = await params;
  const { annulee } = await searchParams;
  const [event, user] = await Promise.all([
    db.event.findFirst({
      // Un événement annulé reste lisible à son adresse (mention « Événement annulé »), hors de l'agenda.
      where: { id, OR: [{ publishedAt: { not: null } }, { cancelledAt: { not: null } }], organization: { verification: "VERIFIED" } },
      // Le lien de connexion n'est lu que pour une personne inscrite (plus bas).
      omit: { onlineUrl: true },
      include: {
        organization: true, benefits: true, _count: { select: { registrations: true } },
        calls: { where: { status: "open" }, include: { _count: { select: { applications: { where: { status: "retained" } } } } }, orderBy: { createdAt: "asc" } },
      },
    }),
    getCurrentUser(),
  ]);
  if (!event) notFound();
  const { t, locale } = await getT();
  const reg = user
    ? await db.registration.findUnique({ where: { eventId_userId: { eventId: id, userId: user.id } }, include: { benefits: { include: { benefit: true } }, survey: { select: { id: true } } } })
    : null;
  const canReview = !!reg && !reg.survey && eventEnded(event) && (await attended(reg));
  const onlineUrl = reg && event.format !== "PRESENTIEL" ? (await db.event.findUnique({ where: { id }, select: { onlineUrl: true } }))?.onlineUrl ?? null : null;
  // États communs (src/lib/events.ts) : inscriptions closes dès le début, « passé » après la fin.
  const st = eventState(event, event._count.registrations);
  const full = st.full;
  // Commencé (inscriptions closes) puis terminé : le badge reste utile aux retardataires pendant l'événement.
  const past = st.moment !== "a_venir";
  const ended = st.moment === "passe";
  const back = encodeURIComponent(`/evenements/${id}`);

  // Places restantes et prix « par personne » : seulement tant que l'on peut s'inscrire (ni passé, ni en cours, ni annulé).
  const left = event.capacity != null && st.upcoming ? Math.max(0, event.capacity - event._count.registrations) : null;
  const cancelled = !!event.cancelledAt;
  const status = { label: t(EVENT_STATE_LABEL[st.state].label), tone: EVENT_STATE_LABEL[st.state].tone };
  const benefitsTotal = event.benefits.reduce((s, b) => s + b.valueCents, 0);
  // Appels à candidatures rattachés à l'événement, encore ouverts (date limite, places).
  const openCalls = past || cancelled ? [] : event.calls.filter((c) => (!c.deadline || c.deadline >= new Date()) && (!c.slots || c._count.applications < c.slots));

  // Données structurées schema.org (résultats enrichis des moteurs de recherche).
  const base = appUrl();
  const end = event.durationMinutes ? new Date(event.startsAt.getTime() + event.durationMinutes * 60_000) : null;
  const structured = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.description ?? undefined,
    startDate: event.startsAt.toISOString(),
    endDate: end?.toISOString(),
    eventStatus: `https://schema.org/${cancelled ? "EventCancelled" : "EventScheduled"}`,
    // Offre (inscription) : seulement tant qu'elle est possible, sinon complet ; aucune pour un événement passé ou annulé.
    eventAttendanceMode: `https://schema.org/${event.format === "DISTANCIEL" ? "Online" : event.format === "HYBRIDE" ? "Mixed" : "Offline"}EventAttendanceMode`,
    location: event.format === "DISTANCIEL"
      ? { "@type": "VirtualLocation", url: `${base}/evenements/${id}` }
      : { "@type": "Place", name: event.venue ?? event.city ?? undefined, address: { "@type": "PostalAddress", addressLocality: event.city ?? undefined, addressCountry: "FR" } },
    image: [`${base}/evenements/${id}/opengraph-image`],
    organizer: { "@type": "Organization", name: event.organization.name, url: orgIsPublic(event.organization) ? `${base}/structures/${event.organization.id}` : undefined },
    offers: st.upcoming ? { "@type": "Offer", price: 0, priceCurrency: "EUR", url: `${base}/evenements/${id}`, availability: `https://schema.org/${st.canRegister ? "InStock" : "SoldOut"}`, validFrom: event.publishedAt?.toISOString() } : undefined,
    maximumAttendeeCapacity: event.capacity ?? undefined,
  };

  return (
    <>
      <SiteHeader variant="public" />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />
      <main className="stack">
        <PageHero
          eyebrow={`${t(eventTypeLabel(event.typeId))}${event.therapeuticArea ? ` · ${t(event.therapeuticArea)}` : ""} · ${t(FORMAT_LABEL[event.format])}`}
          status={<span className={`pill ${status.tone}`}>{status.label}</span>}
          title={event.title}
          lead={t("Organisé par {name}", { name: event.organization.name })}
          facts={[
            { icon: <CalendarDays size={13} />, label: t("Date"), value: fmtDate(locale, event.startsAt, { day: "numeric", month: "long", year: "numeric" }), sub: `${event.startsAt.toLocaleTimeString(intlLocale(locale), { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}${event.durationMinutes ? ` · ${formatDuration(event.durationMinutes, locale)}` : ""}` },
            { icon: <MapPin size={13} />, label: t("Lieu"), value: event.format === "DISTANCIEL" ? t("En ligne") : event.city ?? t("À préciser"), sub: event.venue ?? undefined },
            ...(left != null && !cancelled ? [{ icon: <Users size={13} />, label: t("Places"), value: t("{n} restantes", { n: left }), sub: t("sur {capacity}", { capacity: event.capacity! }) }] : []),
            ...(st.upcoming ? [{ icon: <Gift size={13} />, label: t("Prise en charge"), value: event.benefits.length ? t("{amount} par personne", { amount: fmtEur(locale, benefitsTotal) }) : t("Aucune"), sub: event.benefits.length ? t("au plus, selon vos choix") : t("à vos frais") }] : []),
          ]}
        />
        {cancelled && (
          <p className="notice error" role="status">
            {t("Événement annulé par {org}.", { org: event.organization.name })}{event.cancelReason ? ` ${t("Motif : {note}", { note: event.cancelReason })}` : ""}
          </p>
        )}
        <div className="page-grid">
          <div className="page-main">
            {event.description && <section className="card"><h2>{t("Présentation")}</h2><p className="pre-line">{event.description}</p></section>}
            {event.program && <section className="card"><h2>{t("Programme")}</h2><p className="program">{event.program}</p></section>}
            <section className="card">
              <h2>{t("Prestations proposées")}</h2>
              {event.benefits.length === 0 ? (
                <p className="muted">{t("Aucune prise en charge : les participants viennent à leurs frais.")}</p>
              ) : (
                <ul className="plain stack-sm">{event.benefits.map((b) => <li key={b.id} className="flex-between"><span>{t(b.label)}</span>{st.upcoming && <span className="muted">{t("{amount} par personne", { amount: fmtEur(locale, b.valueCents) })}</span>}</li>)}</ul>
              )}
              {event.benefits.length > 0 && <p className="hint">{t("Chaque prestation acceptée par un professionnel de santé est un avantage déclaré, rattaché à votre nom.")}</p>}
            </section>
            {openCalls.map((c) => (
              <section key={c.id} className="card stack-sm">
                <h2>{t("Appel à candidatures")}</h2>
                <p><strong>{c.title}</strong></p>
                <p className="muted">
                  {[
                    c.slots ? t(c.slots > 1 ? "{n} places" : "{n} place", { n: c.slots }) : null,
                    c.deadline ? t("candidatures jusqu'au {date}", { date: fmtDate(locale, c.deadline, { day: "numeric", month: "long", year: "numeric" }) }) : null,
                  ].filter(Boolean).join(" · ")}
                </p>
                {c.description && <p className="pre-line clamp-4">{c.description}</p>}
                {/* « Candidater » : aux experts référencés ; un visiteur se connecte d'abord (retour à l'appel). */}
                {user?.practitioner?.listed ? (
                  <Link className="btn ghost small" href={`/opportunites/${c.id}`}>{t("Candidater")}</Link>
                ) : !user ? (
                  <>
                    <Link className="btn ghost small" href={`/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`}>{t("Se connecter pour candidater")}</Link>
                    <p className="hint">{t("Réservé aux experts référencés.")}</p>
                  </>
                ) : (
                  <p className="hint">{t("Réservé aux experts référencés.")}</p>
                )}
              </section>
            ))}
          </div>
          <aside className="page-aside">
            <section className="card next-step">
              <span className="eyebrow-sm">{t("Inscription")}</span>
              {annulee && !reg && <p className="notice ok">{t("Inscription annulée. Un e-mail vous le confirme.")}</p>}
              {cancelled ? (
                <p className="muted">{reg ? t("Vous étiez inscrit : votre inscription est annulée, ainsi que les prestations prévues.") : t("Cet événement est annulé : les inscriptions sont fermées.")}</p>
              ) : reg ? (
                <>
                  <p className="notice ok">{t("Vous êtes inscrit à cet événement.")}</p>
                  {/* Lien de connexion : affiché aux seuls inscrits, jusqu'à la fin de l'événement. */}
                  {event.format !== "PRESENTIEL" && !ended && (
                    onlineUrl
                      ? <p className="online-link text-sm">{t("Lien de connexion :")} <a href={onlineUrl} target="_blank" rel="noopener noreferrer">{onlineUrl}</a></p>
                      : <p className="muted text-sm">{t("Le lien de connexion vous sera communiqué par l'organisateur avant l'événement.")}</p>
                  )}
                  <p className="muted text-sm">
                    {reg.benefits.length === 0
                      ? t("Vous n'avez accepté aucune prestation.")
                      : t("Prestations acceptées : {list} ({total}).", { list: reg.benefits.map((b) => t(b.benefit.label)).join(", "), total: fmtEur(locale, reg.benefits.reduce((s, b) => s + b.valueCents, 0)) })}
                  </p>
                  {!ended && event.format !== "DISTANCIEL" && <Link className="btn secondary" href={`/inscriptions/${reg.id}/badge`}>{t("Mon badge d'accueil")}</Link>}
                  {ended && reg.checkedInAt && <a className="btn secondary" href={`/inscriptions/${reg.id}/attestation`}>{t("Mon attestation de présence")}</a>}
                  {canReview && <Link className="btn ghost" href={`/evenements/${id}/avis`}>{t("Donner mon avis")}</Link>}
                  {!reg.declared && !past && (
                    <form action={cancelRegistration}>
                      <input type="hidden" name="eventId" value={id} />
                      <ConfirmButton localized className="btn ghost" confirm={t("annuler mon inscription")} summary={reg.benefits.length > 0 ? t("Votre place est libérée et les prestations acceptées sont retirées. Un e-mail vous confirme l'annulation.") : t("Votre place est libérée. Un e-mail vous confirme l'annulation.")}>
                        {t("Annuler mon inscription")}
                      </ConfirmButton>
                    </form>
                  )}
                </>
              ) : past ? (
                <p className="muted">{ended ? t("Cet événement a eu lieu.") : t("Cet événement a commencé : les inscriptions sont closes.")}</p>
              ) : !event.registrationOpen ? (
                <p className="muted">{t("Les inscriptions sont closes.")}</p>
              ) : full ? (
                <p className="muted">{t("L'événement est complet.")}</p>
              ) : !user ? (
                <>
                  <p className="next-hint">{t("Inscription réservée aux membres KolBase : elle est nominative, car les hospitalités acceptées sont rattachées à votre nom. Créez votre compte en une minute, vous reviendrez ici pour vous inscrire.")}</p>
                  <div className="transitions-stack">
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
              {!past && !cancelled && <a className="link" href={`/evenements/${id}/calendrier`}><CalendarPlus size={14} /> {t("Ajouter à mon agenda")}</a>}
            </section>
            <section className="card stack-sm">
              <h2 className="section-title">{event.organization.name}</h2>
              {event.organization.about && <p className="text-sm clamp-4">{event.organization.about}</p>}
              {orgIsPublic(event.organization) && <Link className="link" href={`/structures/${event.organizationId}`}>{t("Voir la page de l'organisation")}</Link>}
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
