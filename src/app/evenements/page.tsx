import Link from "next/link";
import { Search } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { EventCard } from "@/components/PublicCards";
import { publicEvents } from "@/lib/public-data";
import { eventTypeLabel } from "@/lib/events";
import { matches } from "@/lib/search";

export const metadata = { title: "Agenda des événements — KolBase" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; ville?: string }> }) {
  const { q = "", ville = "" } = await searchParams;
  const all = await publicEvents(100);
  const events = all.filter((e) => matches(q, e.title, e.therapeuticArea, eventTypeLabel(e.typeId), e.organization.name, e.city) && matches(ville, e.city));
  const filtered = Boolean(q || ville);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="page-band">
          <div className="page-band-inner">
            <span className="kicker">Ouvert à tous</span>
            <h1>Agenda</h1>
            <p>Symposiums, webinaires, formations et tables rondes — l&apos;inscription se fait avec votre compte KolBase, que vous soyez référencé ou non.</p>
          </div>
        </section>
        <section className="public-section">
          <form className="filter-bar" action="/evenements" method="get" role="search">
            <label htmlFor="events-q" className="sr-only">Rechercher un événement</label>
            <input id="events-q" name="q" type="search" defaultValue={q} placeholder="Thème, organisateur, type d'événement" />
            {ville && <input type="hidden" name="ville" value={ville} />}
            <button type="submit" className="btn lg"><Search size={16} aria-hidden /> Rechercher</button>
            {filtered && <Link href="/evenements" className="text-sm">Effacer les filtres</Link>}
          </form>
          {events.length === 0 && <p className="muted">{filtered ? "Aucun événement ne correspond à cette recherche." : "Aucun événement à venir pour le moment."}</p>}
          <div className="event-grid">{events.map((ev) => <EventCard key={ev.id} ev={ev} />)}</div>
        </section>
      </main>
    </>
  );
}
