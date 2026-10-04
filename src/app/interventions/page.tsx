import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Clock, Megaphone, Users, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SpeakerApplyForm } from "@/components/SpeakerForms";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { eventTypeLabel, formatDate, formatDateTime, formatEUR } from "@/lib/events";
import { SPEAKER_STATUS } from "@/lib/suppliers";
import { withdrawSpeaker } from "@/lib/speaker-actions";

export const metadata = { title: "Mes interventions — Kolbase" };

export default async function Page({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p?.listed) redirect("/compte");
  const now = new Date();

  const mine = await db.speakerApplication.findMany({
    where: { practitionerId: p.id },
    include: { event: { include: { organization: true, _count: { select: { registrations: true } } } } },
    orderBy: { event: { startsAt: "asc" } },
  });
  const speaking = mine.filter((a) => a.status === "retained");
  const links = await db.projectExpert.findMany({ where: { practitionerId: p.id, projectId: { in: speaking.map((a) => a.projectId).filter((x): x is string => !!x) } } });
  const linkOf = (projectId: string | null) => links.find((l) => l.projectId === projectId)?.id;
  const calls = await db.event.findMany({
    where: {
      speakerCallOpen: true,
      publishedAt: { not: null },
      startsAt: { gte: now },
      OR: [{ speakerDeadline: null }, { speakerDeadline: { gte: now } }],
    },
    include: { organization: true, speakerApplications: { select: { practitionerId: true, status: true } } },
    orderBy: { startsAt: "asc" },
  });
  const { onglet = speaking.length ? "interventions" : "appels" } = await searchParams;
  const tabs = [["interventions", `J'interviens (${speaking.length})`], ["appels", `Appels à intervenants (${calls.length})`], ["candidatures", `Mes candidatures (${mine.length})`]] as const;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <h1>Mes interventions</h1>
        <p className="muted">
          Les événements où vous intervenez, et les appels ouverts auxquels vous pouvez vous porter candidat. Vos participations en tant que public sont
          dans <Link href="/inscriptions">Mes inscriptions</Link>.
        </p>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "interventions" && (
          <div className="grid-2">
            {speaking.length === 0 && <div className="card empty"><Megaphone size={22} /><p>Vous n&apos;intervenez sur aucun événement pour l&apos;instant.</p></div>}
            {speaking.map((a) => (
              <div key={a.id} className="card stack-sm">
                <div className="eyebrow-sm">{a.event.organization.name} · {eventTypeLabel(a.event.typeId)}</div>
                <h3><Link href={`/evenements/${a.eventId}`}>{a.event.title}</Link></h3>
                <span className="muted"><Clock size={12} /> {formatDateTime(a.event.startsAt)}{a.event.city ? ` · ${a.event.city}` : ""}</span>
                <span className="pill electric"><Megaphone size={12} /> Vous intervenez — {a.event._count.registrations} inscrit{a.event._count.registrations > 1 ? "s" : ""}</span>
                {linkOf(a.projectId) && <Link href={`/sollicitations/${linkOf(a.projectId)}`}>Dossier de collaboration</Link>}
              </div>
            ))}
          </div>
        )}

        {onglet === "appels" && (
          <div className="grid-2">
            {calls.length === 0 && <div className="card empty"><Megaphone size={22} /><p>Aucun appel à intervenants ouvert.</p></div>}
            {calls.map((ev) => {
              const retained = ev.speakerApplications.filter((a) => a.status === "retained").length;
              const applied = ev.speakerApplications.some((a) => a.practitionerId === p.id);
              const left = ev.speakerSlots != null ? ev.speakerSlots - retained : null;
              return (
                <div key={ev.id} className="card stack-sm">
                  <div className="card-head">
                    <div>
                      <div className="eyebrow-sm">{ev.organization.name} · {eventTypeLabel(ev.typeId)}</div>
                      <h3><Link href={`/evenements/${ev.id}`}>{ev.title}</Link></h3>
                    </div>
                    <span className="pill ok">Appel ouvert</span>
                  </div>
                  <span className="muted"><Clock size={12} /> {formatDateTime(ev.startsAt)}{ev.city ? ` · ${ev.city}` : ""}</span>
                  <span className="muted"><Users size={12} /> {left != null ? `${left} place${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""}` : "Places à définir"}{ev.speakerDeadline ? ` · candidatures jusqu'au ${formatDate(ev.speakerDeadline)}` : ""}</span>
                  {(ev.speakerBudgetMinCents != null || ev.speakerBudgetMaxCents != null) && (
                    <span className="muted"><Wallet size={12} /> {[ev.speakerBudgetMinCents, ev.speakerBudgetMaxCents].filter((c) => c != null).map((c) => formatEUR(c!)).join(" – ")} HT</span>
                  )}
                  {ev.speakerProfile && <p>{ev.speakerProfile}</p>}
                  {applied ? <span className="pill ok"><Check size={12} /> Candidature envoyée</span> : left === 0 ? <span className="muted">Places pourvues</span> : <SpeakerApplyForm eventId={ev.id} />}
                </div>
              );
            })}
          </div>
        )}

        {onglet === "candidatures" && (
          <section className="card">
            {mine.length === 0 && <p className="muted">Aucune candidature.</p>}
            <ul className="applications">
              {mine.map((a) => (
                <li key={a.id}>
                  <div className="actions spread">
                    <strong><Link href={`/evenements/${a.eventId}`}>{a.event.title}</Link></strong>
                    <span className={`pill ${a.status === "retained" ? "ok" : a.status === "rejected" ? "done" : "wait"}`}>{a.status === "pending" ? "En attente" : SPEAKER_STATUS[a.status]}</span>
                  </div>
                  <span className="muted">{a.event.organization.name} · {formatDate(a.event.startsAt)} · envoyée le {formatDate(a.createdAt)}</span>
                  {a.message && <p>{a.message}</p>}
                  {a.status === "pending" && (
                    <form action={withdrawSpeaker}>
                      <input type="hidden" name="eventId" value={a.eventId} />
                      <button className="link danger">Retirer ma candidature</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
