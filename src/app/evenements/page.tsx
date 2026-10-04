import { SiteHeader } from "@/components/SiteHeader";
import { EventCard } from "@/components/PublicCards";
import { publicEvents } from "@/lib/public-data";

export const metadata = { title: "Agenda des événements — Kolbase" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const events = await publicEvents(100);
  return (
    <>
      <SiteHeader variant="public" />
      <main className="landing">
        <section className="public-section">
          <div className="section-head">
            <div>
              <div className="eyebrow mb-1">Ouvert à tous</div>
              <h1 className="section-h2">Agenda</h1>
              <p className="text-sm mt-1">Symposiums, webinaires, formations et tables rondes — l&apos;inscription se fait avec votre compte Kolbase.</p>
            </div>
          </div>
          {events.length === 0 && <p className="muted">Aucun événement à venir pour le moment.</p>}
          <div className="grid-3">{events.map((ev) => <EventCard key={ev.id} ev={ev} />)}</div>
        </section>
      </main>
    </>
  );
}
