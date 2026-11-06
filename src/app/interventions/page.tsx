import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Clock, Megaphone } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { practitionerSectionTabs } from "@/lib/nav";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { eventTypeLabel, TZ } from "@/lib/events";
import { SPEAKER_STATUS } from "@/lib/suppliers";
import { withdrawApplication } from "@/lib/opportunity-actions";
import { collabType } from "@/lib/projects";
import { speakerConfirmed } from "@/lib/indicators";
import { fmtDate, intlLocale } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes interventions")} — KolBase` };
}

/**
 * Mes interventions (événements où l'expert a été retenu) et Mes candidatures (tous les appels à candidatures).
 * Les appels eux-mêmes sont dans « Opportunités » (/opportunites).
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const user = await requireUser();
  const p = user.practitioner;
  if (!p?.listed) redirect("/compte");
  const { onglet: raw } = await searchParams;
  // Ancien onglet « Appels à intervenants » : les appels liés à un événement sont dans la liste unique.
  if (raw === "appels") redirect("/opportunites?evenement=avec");
  const { t, locale } = await getT();
  const formatDateTime = (d: Date) =>
    d.toLocaleString(intlLocale(locale), { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const mine = await db.application.findMany({
    where: { practitionerId: p.id },
    include: { openCall: { include: { organization: true, event: { include: { _count: { select: { registrations: true } } } } } } },
    orderBy: { createdAt: "desc" },
  });
  const links = await db.projectExpert.findMany({ where: { practitionerId: p.id, projectId: { in: mine.map((a) => a.projectId).filter((x): x is string => !!x) } } });
  const linkFor = (projectId: string | null) => links.find((l) => l.projectId === projectId);
  const linkOf = (projectId: string | null) => linkFor(projectId)?.id;
  // Retenu : l'intervention est confirmée quand l'expert accepte les honoraires proposés (pas s'il les décline).
  const speaking = mine
    .filter((a) => a.status === "retained" && a.openCall.event && linkFor(a.projectId)?.status !== "DECLINE")
    .sort((a, b) => a.openCall.event!.startsAt.getTime() - b.openCall.event!.startsAt.getTime());
  const onglet = raw === "candidatures" ? "candidatures" : raw === "interventions" ? "interventions" : speaking.length ? "interventions" : "candidatures";
  const group = onglet === "interventions" ? "agenda" : "opportunites";
  const heading = onglet === "interventions"
    ? [t("Mes interventions"), t("Les événements où vous intervenez. Vos participations en tant que public sont dans Mes inscriptions.")]
    : [t("Mes candidatures"), null];

  return (
    <>
      <SiteHeader section={group} />
      <main className="stack">
        <SectionNav tabs={practitionerSectionTabs(group).map((tab) => ({ ...tab, label: t(tab.label) }))} active={onglet} label={group === "agenda" ? t("Rubrique Mes inscriptions") : t("Rubrique Opportunités")} />
        <h1>{heading[0]}</h1>
        {heading[1] && <p className="muted">{heading[1]}</p>}

        {onglet === "interventions" && (
          <div className="grid-2">
            {speaking.length === 0 && <div className="card empty"><Megaphone size={22} /><p>{t("Vous n'intervenez sur aucun événement pour l'instant.")}</p></div>}
            {speaking.map((a) => {
              const ev = a.openCall.event!;
              return (
                <div key={a.id} className="card stack-sm">
                  <div className="eyebrow-sm">{a.openCall.organization.name} · {t(eventTypeLabel(ev.typeId))}</div>
                  <h3><Link href={`/evenements/${ev.id}`}>{ev.title}</Link></h3>
                  <span className="muted"><Clock size={12} /> {formatDateTime(ev.startsAt)}{ev.city ? ` · ${ev.city}` : ""}</span>
                  {speakerConfirmed(a, linkFor(a.projectId)) ? (
                    <span className="pill electric"><Megaphone size={12} /> {t(ev._count.registrations > 1 ? "Vous intervenez — {n} inscrits" : "Vous intervenez — {n} inscrit", { n: ev._count.registrations })}</span>
                  ) : (
                    <span className="pill wait">{t("Honoraires proposés, à accepter")}</span>
                  )}
                  {linkOf(a.projectId) && <Link href={`/sollicitations/${linkOf(a.projectId)}`}>{speakerConfirmed(a, linkFor(a.projectId)) ? t("Dossier de collaboration") : t("Voir la proposition et répondre")}</Link>}
                </div>
              );
            })}
          </div>
        )}

        {onglet === "candidatures" && (
          <section className="card">
            {mine.length === 0 && <p className="muted">{t("Aucune candidature.")} <Link href="/opportunites">{t("Voir les opportunités")}</Link></p>}
            <ul className="applications">
              {mine.map((a) => (
                <li key={a.id}>
                  <div className="actions spread">
                    <strong><Link href={`/opportunites/${a.openCallId}`}>{a.openCall.title}</Link></strong>
                    <span className={`pill ${a.status === "retained" ? "ok" : ["rejected", "declined"].includes(a.status) ? "done" : "wait"}`}>{t(a.status === "pending" ? "En attente" : SPEAKER_STATUS[a.status])}</span>
                  </div>
                  <span className="muted">
                    {a.openCall.organization.name} · {t(collabType(a.openCall.typeId)?.label ?? a.openCall.typeId)}
                    {a.openCall.event ? <> · <CalendarDays size={12} /> {t("{title}, le {date}", { title: a.openCall.event.title, date: fmtDate(locale, a.openCall.event.startsAt) })}</> : null}
                    {" · "}{t("envoyée le {date}", { date: fmtDate(locale, a.createdAt) })}
                  </span>
                  {a.message && <p>{a.message}</p>}
                  {a.status === "pending" && (
                    <form action={withdrawApplication}>
                      <input type="hidden" name="callId" value={a.openCallId} />
                      <button className="link danger">{t("Retirer ma candidature")}</button>
                    </form>
                  )}
                  {a.status === "retained" && linkOf(a.projectId) && <Link href={`/sollicitations/${linkOf(a.projectId)}`}>{t("Dossier de collaboration")}</Link>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
