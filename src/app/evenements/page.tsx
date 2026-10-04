import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { eventTypeLabel, formatDateTime, FORMAT_LABEL } from "@/lib/events";

export const metadata = { title: "Agenda des événements — Kolbase" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const events = await db.event.findMany({
    where: { publishedAt: { not: null }, startsAt: { gte: new Date() } },
    include: { organization: { select: { name: true } }, benefits: { select: { id: true } } },
    orderBy: { startsAt: "asc" },
    take: 100,
  });
  return (
    <>
      <SiteHeader variant="public" />
      <main className="stack">
        <div>
          <h1>Agenda</h1>
          <p className="muted">Congrès, formations et rencontres organisés par les acteurs du secteur dentaire. L&apos;inscription se fait avec votre compte Kolbase.</p>
        </div>
        {events.length === 0 && <p className="muted">Aucun événement à venir pour le moment.</p>}
        <div className="grid">
          {events.map((e) => (
            <Link key={e.id} href={`/evenements/${e.id}`} className="card tile">
              <span className="tag">{eventTypeLabel(e.typeId)}</span>
              <strong>{e.title}</strong>
              <span className="muted">{formatDateTime(e.startsAt)}</span>
              <span className="muted">{e.format === "DISTANCIEL" ? FORMAT_LABEL.DISTANCIEL : [e.city, FORMAT_LABEL[e.format]].filter(Boolean).join(" · ")}</span>
              <span className="muted">Organisé par {e.organization.name}</span>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
