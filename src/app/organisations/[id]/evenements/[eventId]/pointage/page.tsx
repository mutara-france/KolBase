import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, QrCode } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { CheckinList } from "@/components/CheckinForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventScope, formatDate, formatTime } from "@/lib/events";
import { checkinOpen, CHECKIN_OPENS_MS } from "@/lib/checkin";

export const metadata = { title: "Pointage — KolBase" };

/** Pointage à l'accueil (pensé pour le téléphone) : recherche, « Présent », ou scan du badge avec l'appareil photo. */
export default async function Page({ params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { id, eventId } = await params;
  const { org, roles, user } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: id, ...eventScope(user, roles) },
    include: { registrations: { include: { user: { select: { firstName: true, lastName: true } } }, orderBy: [{ user: { lastName: "asc" } }, { user: { firstName: "asc" } }] } },
  });
  if (!event) notFound();
  const open = checkinOpen(event.startsAt);
  const present = event.registrations.filter((r) => r.checkedInAt).length;
  const total = event.registrations.length;
  const rows = event.registrations.map((r) => ({
    id: r.id,
    name: `${r.user.firstName} ${r.user.lastName}`,
    detail: [r.profession, r.structure].filter(Boolean).join(" · ") || "Participant",
    checkedAt: r.checkedInAt ? formatTime(r.checkedInAt) : null,
  }));
  const base = `/organisations/${id}/evenements/${eventId}`;

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={`/organisations/${id}/evenements`}>{org.name} · Événements</Link> / <Link href={base}>{event.title}</Link></p>
        <div>
          <h1>Pointage</h1>
          <p className="muted">{event.title} · {formatDate(event.startsAt)} à {formatTime(event.startsAt)}{event.venue ? ` · ${event.venue}` : ""}</p>
        </div>
        {event.internal ? (
          <p className="notice">Réunion interne : pas d&apos;inscriptions en ligne, donc pas de pointage.</p>
        ) : (
          <>
            <section className="card stack-sm checkin-summary" aria-live="polite">
              <div className="flex-between">
                <strong className="checkin-count">{present} présent{present > 1 ? "s" : ""} <span className="muted">sur {total} inscrit{total > 1 ? "s" : ""}</span></strong>
                <a className="btn ghost small" href={`${base}/emargement`}><FileDown size={14} /> Feuille d&apos;émargement</a>
              </div>
              <div className="gauge-track"><div className="gauge-fill" style={{ width: `${total ? Math.round((present / total) * 100) : 0}%` }} /></div>
              {open ? (
                <p className="hint"><QrCode size={13} /> Scannez le badge du participant avec l&apos;appareil photo du téléphone : sa fiche s&apos;ouvre, il ne reste qu&apos;à confirmer. Sans badge, cherchez son nom ci-dessous.</p>
              ) : (
                <p className="notice">Le pointage ouvrira le {formatDate(new Date(event.startsAt.getTime() - CHECKIN_OPENS_MS))}, la veille de l&apos;événement.</p>
              )}
            </section>
            {total === 0 ? <p className="muted">Aucune inscription.</p> : <CheckinList rows={rows} open={open} />}
          </>
        )}
      </main>
    </>
  );
}
