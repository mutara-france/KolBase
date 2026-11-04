import Link from "next/link";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { EventCard } from "@/components/PublicCards";
import { publicEvents } from "@/lib/public-data";
import { EVENT_TYPES, eventTypeLabel, FORMAT_LABEL } from "@/lib/events";
import { agendaHref, disciplinesOf, filterAgenda, hasFilters, PERIODS, readAgendaFilters } from "@/lib/agenda";
import { normalize } from "@/lib/search";
import { getT } from "@/lib/i18n/server";

type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams: SP }) {
  const [{ t }, f] = await Promise.all([getT(), searchParams.then(readAgendaFilters)]);
  // Une discipline choisie a sa propre adresse : son titre la nomme (partage, moteurs de recherche).
  return { title: f.discipline ? t("Agenda {discipline} — KolBase", { discipline: t(f.discipline) }) : t("Agenda des événements — KolBase") };
}
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: SP }) {
  const f = readAgendaFilters(await searchParams);
  const [all, { t, locale }] = await Promise.all([publicEvents(100), getT()]);
  // En anglais, la recherche porte aussi sur les libellés traduits (type d'événement, domaine).
  const translated = (e: (typeof all)[number]) => (locale === "fr" ? [] : [t(eventTypeLabel(e.typeId)), e.therapeuticArea && t(e.therapeuticArea)]);
  const events = filterAgenda(all, f, new Date(), translated);
  const filtered = hasFilters(f);
  // Disciplines des événements à venir ; celle de l'adresse reste affichée même sans événement.
  const disciplines = disciplinesOf(all);
  if (f.discipline && !disciplines.some((d) => normalize(d.name) === normalize(f.discipline))) disciplines.push({ name: f.discipline, count: 0 });
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
            <input id="events-q" name="q" type="search" className="wide" defaultValue={f.q} placeholder={t("Thème, organisateur, type d'événement")} />
            <label htmlFor="events-ville" className="sr-only">{t("Ville")}</label>
            <input id="events-ville" name="ville" className="short" defaultValue={f.ville} placeholder={t("Ville")} />
            {f.discipline && <input type="hidden" name="discipline" value={f.discipline} />}
            <label htmlFor="events-type" className="sr-only">{t("Type d'événement")}</label>
            <select id="events-type" name="type" defaultValue={f.type}>
              <option value="">{t("Tous les types")}</option>
              {EVENT_TYPES.map((ty) => <option key={ty.id} value={ty.id}>{t(ty.label)}</option>)}
            </select>
            <label htmlFor="events-format" className="sr-only">{t("Format")}</label>
            <select id="events-format" name="format" defaultValue={f.format}>
              <option value="">{t("Tous les formats")}</option>
              {Object.entries(FORMAT_LABEL).map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
            </select>
            <label htmlFor="events-periode" className="sr-only">{t("Période")}</label>
            <select id="events-periode" name="periode" defaultValue={f.periode}>
              <option value="">{t("Toutes les dates")}</option>
              {PERIODS.map((p) => <option key={p.id} value={p.id}>{t(p.label)}</option>)}
            </select>
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> {t("Rechercher")}</button>
          </form>
          {disciplines.length > 0 && (
            <nav className="chips mb-4" aria-label={t("Disciplines")}>
              <Link href={agendaHref({ ...f, discipline: "" })} className={`chip${f.discipline ? "" : " active"}`}>{t("Toutes")}</Link>
              {disciplines.map((d) => (
                <Link key={d.name} href={agendaHref({ ...f, discipline: d.name })} className={`chip${normalize(f.discipline) === normalize(d.name) ? " active" : ""}`}>{t(d.name)}</Link>
              ))}
            </nav>
          )}
          <div className="flex-between mb-4">
            <h2 className="card-title" style={{ margin: 0 }}>{events.length === 0 ? t("Aucun événement") : t(events.length > 1 ? "{n} événements" : "{n} événement", { n: events.length })}</h2>
            {filtered && <Link href="/evenements" className="text-sm">{t("Effacer les filtres")}</Link>}
          </div>
          {events.length === 0 && <p className="muted">{filtered ? t("Aucun événement ne correspond à cette recherche.") : t("Aucun événement à venir pour le moment.")}</p>}
          <div className="event-grid">{events.map((ev) => <EventCard key={ev.id} ev={ev} />)}</div>
        </section>
      </main>
    </>
  );
}
