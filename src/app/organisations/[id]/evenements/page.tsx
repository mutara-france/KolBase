import { CalendarClock, CalendarDays, History, PlayCircle } from "lucide-react";
import { SectionHead, PageHead, EmptyState } from "@/components/UI";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { needsReview, REVIEW_LABEL } from "@/lib/event-review";
import { EVENT_MANAGER_ROLES, EVENT_ORGANIZER_ROLES, eventMoment, eventScope, eventTypeLabel, FORMAT_LABEL, orgEventStatus } from "@/lib/events";
import { isSuspendedOrg } from "@/lib/org-roles";
import { getT } from "@/lib/i18n/server";
import { fmtDate } from "@/lib/i18n";
import { PROJECT_VIEW_ROLES } from "@/lib/projects";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Événements")} — KolBase` };
}


export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const { id } = await params;
  const { roles, user, org } = await requireMembership(id, EVENT_MANAGER_ROLES);
  const isOrganizer = roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r));
  const events = await db.event.findMany({
    where: { organizationId: id, ...eventScope(user, roles) },
    include: {
      _count: { select: { registrations: true } },
      agency: { select: { name: true } },
      project: { select: { title: true, _count: { select: { experts: { where: { status: { not: "DECLINE" } } } } } } },
      rfqs: { where: { status: { not: "cancelled" } }, select: { status: true, _count: { select: { quotes: true } } } },
    },
    orderBy: { startsAt: "asc" },
  });
  const now = new Date();
  // Même découpage que l'accueil et les pages publiques : commencé n'est pas terminé (« En cours »).
  const upcoming = events.filter((e) => eventMoment(e, now) === "a_venir");
  const ongoing = events.filter((e) => eventMoment(e, now) === "en_cours");
  const past = events.filter((e) => eventMoment(e, now) === "passe").reverse();
  const sectionTabs = await orgTabs("evenements", id);
  // Événement d'un dossier : il se gère dans l'onglet « Événement » du dossier (sauf pour une agence mandatée).
  const seesProjects = roles.some((r) => PROJECT_VIEW_ROLES.includes(r));
  const perProject = new Map<string, number>();
  for (const e of events) if (e.projectId) perProject.set(e.projectId, (perProject.get(e.projectId) ?? 0) + 1);
  const multi = new Set([...perProject].filter(([, n]) => n > 1).map(([k]) => k));

  const Row = async ({ e }: { e: (typeof events)[number] }) => {
    const { t, locale } = await getT();
    const status = orgEventStatus(e, e._count.registrations, { suspended: isSuspendedOrg(org) }, now);
    const toCompare = e.rfqs.filter((r) => r.status === "sent" && r._count.quotes > 0).length;
    const awarded = e.rfqs.filter((r) => r.status === "awarded").length;
    const logistics = e.rfqs.length === 0
      ? null
      : toCompare
        ? t(toCompare > 1 ? "{n} demandes de devis à comparer" : "{n} demande de devis à comparer", { n: toCompare })
        : t(e.rfqs.length > 1 ? (awarded > 1 ? "{n}/{m} prestations attribuées" : "{n}/{m} prestations attribuée") : "{n}/{m} prestation attribuée", { n: awarded, m: e.rfqs.length });
    const participants = e.internal ? e.project?._count.experts ?? 0 : e._count.registrations;
    return (
      <Link href={e.projectId && seesProjects ? `/organisations/${id}/dossiers/${e.projectId}?onglet=evenement${e.project && multi.has(e.projectId) ? `&evenement=${e.id}` : ""}` : `/organisations/${id}/evenements/${e.id}`} className="row-item">
        <span className="date-block" aria-hidden><strong>{fmtDate(locale, e.startsAt, { day: "numeric" })}</strong><small>{fmtDate(locale, e.startsAt, { month: "short" })}</small></span>
        <span className="row-main">
          <strong>{e.title}</strong>
          <span className="muted text-sm">{fmtDate(locale, e.startsAt)} · {t(eventTypeLabel(e.typeId))} · {e.format === "DISTANCIEL" ? t("en ligne") : e.city ?? t(FORMAT_LABEL[e.format])}{e.agency && isOrganizer ? ` ${t("· confié à {name}", { name: e.agency.name })}` : ""}</span>
        </span>
        <span className="row-status">
          <span className={`pill ${status.tone}`}>{t(status.label)}</span>
          {/* Validation par la conformité en cours ou à reprendre (avant publication, ou après une modification). */}
          {needsReview(org, e) && !e.cancelledAt && (e.reviewStatus === "submitted" || e.reviewStatus === "changes") && <span className={`text-xs ${e.reviewStatus === "changes" ? "warn-text" : "muted"}`}>{t(REVIEW_LABEL[e.reviewStatus])}</span>}
          {logistics && <span className={`text-xs ${toCompare ? "warn-text" : "muted"}`}>{logistics}</span>}
        </span>
        <span className="row-figures">
          <strong>{participants}{e.capacity ? ` / ${e.capacity}` : ""}</strong>
          <span className="text-xs muted">{e.internal ? t("participants") : t("inscrits")}</span>
        </span>
      </Link>
    );
  };

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="evenements" label={t("Rubrique Événements")} />
        <PageHead title={isOrganizer ? t("Événements") : t("Événements confiés")} desc={isOrganizer ? t("Vos réunions, formations et symposiums : logistique, inscriptions, présence et bilan.") : t("Les événements que des organisations ont confiés à votre agence.")}>
          <a className="link" href={`/organisations/${id}/evenements/calendrier`}>{t("Ajouter à mon agenda (.ics)")}</a>
          {isOrganizer && <Link className="btn" href={`/organisations/${id}/evenements/nouveau`}>{t("Nouvel événement")}</Link>}
        </PageHead>
        {events.length === 0 ? (
          <div className="card empty">
            <EmptyState icon={CalendarDays} title={t("Aucun événement pour l'instant.")} action={isOrganizer ? <Link className="btn secondary small" href={`/organisations/${id}/evenements/nouveau`}>{t("Nouvel événement")}</Link> : undefined}>
              {isOrganizer ? t("Réunion, formation ou symposium : créez-le, préparez la logistique, puis publiez-le dans l'agenda.") : t("Les événements que les organisations vous confient apparaîtront ici.")}
            </EmptyState>
          </div>
        ) : (
          <>
            {ongoing.length > 0 && (
              <section className="card row-list" aria-label={t("Événements en cours")}>
                <SectionHead icon={PlayCircle} title={t("En cours ({ongoing})", { ongoing: ongoing.length })} />
                {ongoing.map((e) => <Row key={e.id} e={e} />)}
              </section>
            )}
            <section className="card row-list" aria-label={t("Événements à venir")}>
              <SectionHead icon={CalendarClock} title={t("À venir ({upcoming})", { upcoming: upcoming.length })} />
              {upcoming.length === 0 ? <p className="muted">{t("Aucun événement à venir.")}</p> : upcoming.map((e) => <Row key={e.id} e={e} />)}
            </section>
            {past.length > 0 && (
              <section className="card row-list" aria-label={t("Événements passés")}>
                <SectionHead icon={History} title={t("Passés ({past})", { past: past.length })} />
                {past.map((e) => <Row key={e.id} e={e} />)}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
