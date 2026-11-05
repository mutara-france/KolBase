import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, QrCode } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { CheckinList } from "@/components/CheckinForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { EVENT_MANAGER_ROLES, eventScope } from "@/lib/events";
import { checkinOpen, CHECKIN_OPENS_MS } from "@/lib/checkin";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtTime } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Pointage")} — KolBase` };
}

/** Pointage à l'accueil (pensé pour le téléphone) : recherche, « Présent », ou scan du badge avec l'appareil photo. */
export default async function Page({ params }: { params: Promise<{ id: string; eventId: string }> }) {
  const { t, locale } = await getT();
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
    detail: [r.profession ? t(r.profession) : null, r.structure].filter(Boolean).join(" · ") || t("Participant"),
    checkedAt: r.checkedInAt ? fmtTime(locale, r.checkedInAt) : null,
  }));
  const base = `/organisations/${id}/evenements/${eventId}`;

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={`/organisations/${id}/evenements`}>{t("{name} · Événements", { name: org.name })}</Link> / <Link href={base}>{event.title}</Link></p>
        <div>
          <h1>{t("Pointage")}</h1>
          <p className="muted">{event.title} · {fmtDate(locale, event.startsAt)} à {fmtTime(locale, event.startsAt)}{event.venue ? ` · ${event.venue}` : ""}</p>
        </div>
        {event.internal ? (
          <p className="notice">{t("Réunion interne : pas d'inscriptions en ligne, donc pas de pointage.")}</p>
        ) : (
          <>
            <section className="card stack-sm checkin-summary" aria-live="polite">
              <div className="flex-between">
                <strong className="checkin-count">{t(present > 1 ? "{present} présents" : "{present} présent", { present })}{" "}<span className="muted">{t(total > 1 ? "sur {total} inscrits" : "sur {total} inscrit", { total })}</span></strong>
                <a className="btn ghost small" href={`${base}/emargement`}><FileDown size={14} />{" "}{t("Feuille d'émargement")}</a>
              </div>
              <div className="gauge-track"><div className="gauge-fill" style={{ width: `${total ? Math.round((present / total) * 100) : 0}%` }} /></div>
              {open ? (
                <p className="hint"><QrCode size={13} />{" "}{t("Scannez le badge du participant avec l'appareil photo du téléphone : sa fiche s'ouvre, il ne reste qu'à confirmer. Sans badge, cherchez son nom ci-dessous.")}</p>
              ) : (
                <p className="notice">{t("Le pointage ouvrira le {date}, la veille de l'événement.", { date: fmtDate(locale, new Date(event.startsAt.getTime() - CHECKIN_OPENS_MS)) })}</p>
              )}
            </section>
            {total === 0 ? <p className="muted">{t("Aucune inscription.")}</p> : <CheckinList rows={rows} open={open} />}
          </>
        )}
      </main>
    </>
  );
}
