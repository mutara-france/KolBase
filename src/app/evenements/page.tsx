import Link from "next/link";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { EventCard } from "@/components/PublicCards";
import { publicEvents } from "@/lib/public-data";
import { eventTypeLabel } from "@/lib/events";
import { matches } from "@/lib/search";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("Agenda des événements — KolBase") };
}
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; ville?: string }> }) {
  const { q = "", ville = "" } = await searchParams;
  const [all, { t, locale }] = await Promise.all([publicEvents(100), getT()]);
  // En anglais, la recherche porte aussi sur les libellés traduits (type d'événement, domaine).
  const translated = (e: (typeof all)[number]) => (locale === "fr" ? [] : [t(eventTypeLabel(e.typeId)), e.therapeuticArea && t(e.therapeuticArea)]);
  const events = all.filter((e) => matches(q, e.title, e.therapeuticArea, eventTypeLabel(e.typeId), e.organization.name, e.city, ...translated(e)) && matches(ville, e.city));
  const filtered = Boolean(q || ville);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">{t("Ouvert à tous")}</span>
            <h1>{t("Agenda")}</h1>
            <p>{t("Symposiums, webinaires, formations et tables rondes — l'inscription se fait avec votre compte KolBase, que vous soyez référencé ou non.")}</p>
          </div>
        </section>
        <section className="public-section">
          <form className="filter-bar" action="/evenements" method="get" role="search">
            <label htmlFor="events-q" className="sr-only">{t("Rechercher un événement")}</label>
            <input id="events-q" name="q" type="search" defaultValue={q} placeholder={t("Thème, organisateur, type d'événement")} />
            {ville && <input type="hidden" name="ville" value={ville} />}
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> {t("Rechercher")}</button>
            {filtered && <Link href="/evenements" className="text-sm">{t("Effacer les filtres")}</Link>}
          </form>
          {/* Ville choisie dans la recherche de l'accueil : visible et retirable. */}
          {ville && (
            <div className="chips mb-4 active-filters" aria-label={t("Filtres actifs")}>
              <Link href={q ? `/evenements?${new URLSearchParams({ q })}` : "/evenements"} className="chip active">{t("Ville : {value}", { value: ville })} ×</Link>
            </div>
          )}
          {events.length === 0 && <p className="muted">{filtered ? t("Aucun événement ne correspond à cette recherche.") : t("Aucun événement à venir pour le moment.")}</p>}
          <div className="event-grid">{events.map((ev) => <EventCard key={ev.id} ev={ev} />)}</div>
        </section>
      </main>
    </>
  );
}
