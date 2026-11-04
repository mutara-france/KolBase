import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Avatar } from "@/components/Avatar";
import { HomeSearch } from "@/components/HomeSearch";
import { CallCard, EventCard, KolCard } from "@/components/PublicCards";
import { INTERVENTION_TYPES, ORG_KIND_LABEL } from "@/lib/orgs";
import { specialtyVisual } from "@/lib/specialties";
import { publicCalls, publicCounts, publicEvents, publicExperts, publicOrgAgenda, publicOrgs, publicSpecialties, publishingOrgIds } from "@/lib/public-data";
import { fmtDate } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { NewsCard } from "@/components/News";
import { publishedArticles } from "@/lib/news";
import { appUrl } from "@/lib/ics";
import { jsonLd } from "@/lib/jsonld";
import { getCurrentUser } from "@/lib/auth";
import { orgJoinHref } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** Accueil — portail : recherche d'abord, puis le réseau (spécialités, agenda, praticiens, organisations, appels). */
export default async function Home({ searchParams }: { searchParams: Promise<{ compte?: string }> }) {
  const deleted = (await searchParams).compte === "supprime";
  const [{ t, locale }, user] = await Promise.all([getT(), getCurrentUser()]);
  const [events, experts, orgs, calls, n, specialties, news, publishing] = await Promise.all([
    publicEvents(3, { tracked: true }), publicExperts(4), publicOrgs(), publicCalls(2), publicCounts(), publicSpecialties(), publishedArticles(3), publishingOrgIds(),
  ]);
  // Les prestataires (agences, logistique) ne sont pas mis en avant sur l'accueil.
  const ranked = orgs
    .filter((o) => o.kind !== ORG_KIND_LABEL.PRESTATAIRE)
    .sort((a, b) => b.collaborations + b.openCalls - (a.collaborations + a.openCalls));
  const featured = ranked[0];
  const others = ranked.slice(1, 4);
  const agenda = featured ? await publicOrgAgenda(featured.id) : null;
  const nextDate = agenda?.next ? fmtDate(locale, agenda.next.startsAt, { day: "2-digit", month: "2-digit" }) : undefined;
  // Phrase traduite autour de la date, mise en forme à part.
  const [nextBefore, nextAfter] = agenda?.next
    ? t("Prochain rendez-vous : {event}, le {date}", { event: `${agenda.next.title}${agenda.next.city ? `, ${agenda.next.city}` : ""}` }).split("{date}")
    : [];

  const base = appUrl();
  const structured = [
    { "@context": "https://schema.org", "@type": "Organization", name: "KolBase", url: base, logo: `${base}/brand/kolbase-logo-outremer.svg` },
    { "@context": "https://schema.org", "@type": "WebSite", name: "KolBase", url: base, inLanguage: "fr-FR" },
  ];
  return (
    <>
      <SiteHeader variant="public" />
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structured)} />
      <main className="landing home">
        {deleted && <p className="notice ok" role="status" style={{ margin: "16px auto", maxWidth: 1180 }}>{t("Votre compte a été supprimé. Merci d'avoir utilisé KolBase.")}</p>}
        <section className="home-hero" aria-labelledby="home-titre">
          <div className="home-wrap home-hero-inner">
            <div className="home-hero-text">
              <p className="home-pill">{t("Le réseau scientifique de la chirurgie dentaire")}</p>
              <h1 id="home-titre" className="home-title">{t("Trouvez le bon praticien. Montez la collaboration.")} <em>{t("Le reste suit.")}</em></h1>
              <p className="home-lede">{t("Experts référencés, événements ouverts, appels en cours : tout le réseau au même endroit.")}</p>
            </div>
            <div className="home-hero-art" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/visuels/implant.webp" alt="" />
            </div>
          </div>
        </section>

        <section className="home-search" aria-label={t("Recherche")}>
          <div className="home-wrap">
            <HomeSearch counts={n} interventionTypes={INTERVENTION_TYPES} />
          </div>
        </section>

        {/* Seulement les organisations qui publient vraiment : au moins un événement ou un appel visible. */}
        {ranked.some((o) => publishing.has(o.id)) && (
          <section className="home-trust" aria-labelledby="home-confiance">
            <div className="home-wrap">
              <h2 id="home-confiance">{t("Ils publient sur KolBase")}</h2>
              <ul className="trust-list">
                {ranked.filter((o) => publishing.has(o.id)).slice(0, 5).map((o) => (
                  <li key={o.id}><Link href={`/structures/${o.id}`}><Avatar name={o.name} size={36} square src={o.logo} />{o.name}</Link></li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {specialties.length > 0 && (
          <section className="home-section" aria-labelledby="home-specialites">
            <div className="home-wrap">
              <div className="home-head">
                <div>
                  <span className="kicker">{t("Spécialités")}</span>
                  <h2 id="home-specialites">{t("Explorer par spécialité")}</h2>
                </div>
                <Link href="/experts" className="home-more">{t("Les {n} experts", { n: n.experts })} <ArrowRight size={16} /></Link>
              </div>
              <div className="spec-grid">
                {specialties.slice(0, 9).map((s) => {
                  const img = specialtyVisual(s.name);
                  return (
                    <Link key={s.name} href={`/experts?specialite=${encodeURIComponent(s.name)}`} className="spec-tile">
                      <span><strong>{t(s.name)}</strong><small>{t(s.count > 1 ? "{n} praticiens" : "{n} praticien", { n: s.count })}</small></span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {img && <img src={img} alt="" aria-hidden />}
                    </Link>
                  );
                })}
                <Link href="/experts" className="spec-tile all">
                  <span><strong>{t("Toutes les spécialités")}</strong><small>{t("{n} identités vérifiées", { n: n.verified })}</small></span>
                  <span className="spec-arrow" aria-hidden><ArrowRight size={18} /></span>
                </Link>
              </div>
            </div>
          </section>
        )}

        <section className="home-section tinted" aria-labelledby="home-agenda">
          <div className="home-wrap">
            <div className="home-head">
              <div>
                <span className="kicker">{t("Agenda")}</span>
                <h2 id="home-agenda">{t("Événements et formations à l'affiche")}</h2>
              </div>
              <Link href="/evenements" className="home-more">{t("Tous les événements")} <ArrowRight size={16} /></Link>
            </div>
            <div className="event-grid">
              {events.map((ev) => <EventCard key={ev.id} ev={ev} />)}
              <article className="publish-card">
                <span className="plus" aria-hidden><Plus size={22} /></span>
                <div>
                  <h3>{t("Vous organisez un congrès, une formation, un TP ?")}</h3>
                  <p>{t("Publiez-le sur KolBase et ouvrez les inscriptions aux praticiens, référencés ou non.")}</p>
                  <p className="hint">{t("Publier vos événements est gratuit pour les sociétés savantes, associations et organismes de formation.")}</p>
                </div>
                <Link href={orgJoinHref(user, "evenement")} className="btn" style={{ background: "var(--ink)" }}>{t("Publier un événement")}</Link>
              </article>
            </div>
          </div>
        </section>

        {experts.length > 0 && (
          <section className="home-section" aria-labelledby="home-praticiens">
            <div className="home-wrap">
              <div className="home-head">
                <div>
                  <span className="kicker">{t("Réseau vérifié")}</span>
                  <h2 id="home-praticiens">{t("Des praticiens qui interviennent")}</h2>
                </div>
                <Link href="/experts" className="home-more">{t("Les {n} experts", { n: n.experts })} <ArrowRight size={16} /></Link>
              </div>
              <div className="event-grid">{experts.map((k) => <KolCard key={k.id} k={k} />)}</div>
            </div>
          </section>
        )}

        {featured && (
          <section className="home-orgs" aria-labelledby="home-organisations">
            <div className="home-wrap">
              <div className="home-head">
                <div>
                  <span className="kicker">{t("Organisations")}</span>
                  <h2 id="home-organisations">{t("Industriels, sociétés savantes, organismes de formation, associations")}</h2>
                </div>
                <Link href="/structures" className="btn white">{t("Toutes les organisations")}</Link>
              </div>
              <div className="orgs-layout">
                <article className="org-feature">
                  <div className="org-feature-head">
                    <Avatar name={featured.name} size={76} square src={featured.logo} />
                    <div>
                      <div className="eyebrow">{t("À la une")}</div>
                      <h3>{featured.name}</h3>
                      <p className="text-sm">{[t(featured.kind), featured.sector, featured.hq].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                  <dl className="org-stats">
                    <div><dt>{t(featured.collaborations > 1 ? "collaborations" : "collaboration")}</dt><dd>{featured.collaborations}</dd></div>
                    <div><dt>{t(featured.openCalls > 1 ? "appels ouverts" : "appel ouvert")}</dt><dd>{featured.openCalls}</dd></div>
                    <div><dt>{t((agenda?.upcoming ?? 0) > 1 ? "événements à venir" : "événement à venir")}</dt><dd>{agenda?.upcoming ?? 0}</dd></div>
                  </dl>
                  <div className="flex-between">
                    <p className="text-sm" style={{ margin: 0 }}>
                      {agenda?.next ? <>{nextBefore}<span className="mono ink">{nextDate}</span>{nextAfter}</> : featured.about}
                    </p>
                    <Link href={`/structures/${featured.id}`} className="btn">{t("Voir la fiche")}</Link>
                  </div>
                </article>
                <div className="org-list">
                  {others.map((o) => (
                    <Link key={o.id} href={`/structures/${o.id}`} className="org-row">
                      <Avatar name={o.name} size={56} square src={o.logo} />
                      <span style={{ minWidth: 0 }}><strong>{o.name}</strong><small>{[t(o.kind), o.hq].filter(Boolean).join(" · ")}</small></span>
                      <span className="go" aria-hidden><ArrowRight size={18} /></span>
                    </Link>
                  ))}
                  <Link href={orgJoinHref(user, "organisation")} className="org-join">{t("Créer l'espace de votre organisation : gratuit jusqu'à votre première action")} <ArrowRight size={18} /></Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {calls.length > 0 && (
          <section className="home-section" aria-labelledby="home-appels">
            <div className="home-wrap">
              <div className="home-head">
                <div>
                  <span className="kicker">{t("Opportunités")}</span>
                  <h2 id="home-appels">{t("Appels ouverts aux praticiens")}</h2>
                </div>
                <Link href="/appels" className="home-more">{t("Toutes les opportunités")} <ArrowRight size={16} /></Link>
              </div>
              <div className="grid-2">
                {calls.map((c) => (
                  // « Candidater » aux praticiens seulement ; un compte d'organisation ne candidate pas.
                  <CallCard key={c.id} c={c} action={c.full ? undefined : user?.practitioner ? <Link href={`/opportunites/${c.id}`} className="btn">{t("Candidater")}</Link> : !user ? <Link href={`/connexion?next=${encodeURIComponent(`/opportunites/${c.id}`)}`} className="btn">{t("Se connecter pour candidater")}</Link> : undefined} />
                ))}
              </div>
            </div>
          </section>
        )}

        {news.length > 0 && (
          <section className="home-section" aria-labelledby="home-actualites">
            <div className="home-wrap">
              <div className="home-head">
                <div>
                  <span className="kicker">{t("Actualités")}</span>
                  <h2 id="home-actualites">{t("Les nouvelles de KolBase")}</h2>
                </div>
                <Link href="/actualites" className="home-more">{t("Toutes les actualités")} <ArrowRight size={16} /></Link>
              </div>
              <div className="news-grid">
                {news.map((a) => <NewsCard key={a.id} a={a} dateLabel={fmtDate(locale, a.publishedAt!, { day: "numeric", month: "long", year: "numeric" })} minutesLabel={t("{n} min de lecture")} />)}
              </div>
            </div>
          </section>
        )}

        <section className="home-section" style={{ paddingTop: 0 }} aria-label={t("Rejoindre KolBase")}>
          <div className="home-wrap join-grid">
            <div className="join-card">
              <span className="eyebrow">{t("Praticiens")}</span>
              <h2>{t("Rendez votre expertise visible.")}</h2>
              <p>{t("Référencez-vous, choisissez ce qui est public, recevez des sollicitations.")}</p>
              <Link href="/inscription" className="btn lg">{t("Se référencer")}</Link>
            </div>
            <div className="join-card aurore">
              <span className="eyebrow">{t("Organisations")}</span>
              <h2>{t("Trouvez vos intervenants.")}</h2>
              <p>{t("Publiez des appels, sollicitez des praticiens, ouvrez vos événements. L'espace de l'organisation est gratuit jusqu'à votre première action qui engage un tiers, puis sur abonnement (premier mois offert).")}</p>
              <Link href={orgJoinHref(user, "organisation")} className="btn lg white">{t("Référencer mon organisation")}</Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
