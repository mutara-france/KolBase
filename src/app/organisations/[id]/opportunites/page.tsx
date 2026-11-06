import Link from "next/link";
import { aiEnabled } from "@/lib/ai";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { NewCallForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { BillingNotice } from "@/components/BillingNotice";
import { engagementBlock } from "@/lib/billing";
import { COLLAB_TYPES, collabType, SOURCING_ROLES } from "@/lib/projects";
import { getT } from "@/lib/i18n/server";
import { fmtDate } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Opportunités")} — KolBase` };
}


export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ evenement?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { evenement } = await searchParams;
  await requireMembership(id, SOURCING_ROLES);
  const now = new Date();
  const [calls, events] = await Promise.all([
    db.openCall.findMany({
      where: { organizationId: id },
      include: { applications: { select: { status: true } }, event: { select: { id: true, title: true, startsAt: true } } },
      orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    }),
    db.event.findMany({ where: { organizationId: id, startsAt: { gte: now } }, orderBy: { startsAt: "asc" }, select: { id: true, title: true, startsAt: true, typeId: true, therapeuticArea: true } }),
  ]);
  const sectionTabs = await orgTabs("praticiens", id);
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <BillingNotice orgId={id} motive="appel" />
        <SectionNav tabs={sectionTabs} active="appels" label={t("Rubrique Praticiens")} />
        <div className="actions spread">
          <h1>{t("Opportunités")}</h1>
          <a className="btn" href="#nouvel-appel">{t("Nouvelle opportunité")}</a>
        </div>
        <p className="muted">
          {t("Une opportunité invite les experts référencés à candidater, pour une collaboration (board, étude, rédaction…) ou pour intervenir à l'un de vos événements (formation, symposium…). Vous retenez qui vous voulez ; chaque personne retenue reçoit une proposition d'honoraires et un dossier s'ouvre.")}
        </p>
        {calls.length > 0 && (
          <section className="card row-list">
            {calls.map((c) => {
              const pending = c.applications.filter((a) => a.status === "pending").length;
              const retained = c.applications.filter((a) => a.status === "retained").length;
              const closed = c.status !== "open" || (c.deadline != null && c.deadline < now);
              return (
                <Link key={c.id} href={`/organisations/${id}/opportunites/${c.id}`} className="row-item">
                  {c.event ? (
                    <span className="date-block" aria-hidden><strong>{fmtDate(locale, c.event.startsAt, { day: "numeric" })}</strong><small>{fmtDate(locale, c.event.startsAt, { month: "short" })}</small></span>
                  ) : (
                    <span className="date-block muted-block" aria-hidden><small>{t("sans")}</small><small>{t("événement")}</small></span>
                  )}
                  <span className="row-main">
                    <strong>{c.title}</strong>
                    <span className="muted text-sm">
                      {t(collabType(c.typeId)?.label ?? c.typeId)}
                      {c.event ? ` · ${c.event.title}` : ""}
                      {c.deadline ? ` ${t("· jusqu'au {date}", { date: fmtDate(locale, c.deadline) })}` : ""}
                    </span>
                  </span>
                  <span className="row-status">
                    <span className={`pill ${closed ? "done" : c.slots != null && retained >= c.slots ? "bad" : "ok"}`}>{closed ? t("Clôturé") : c.slots != null && retained >= c.slots ? t("Complet") : t("Ouvert")}</span>
                    {pending > 0 && <span className="text-xs warn-text">{t(pending > 1 ? "{pending} candidatures à examiner" : "{pending} candidature à examiner", { pending })}</span>}
                  </span>
                  <span className="row-figures">
                    <strong>{retained}{c.slots ? ` / ${c.slots}` : ""}</strong>
                    <span className="text-xs muted">{t(retained > 1 ? "retenus" : "retenu")} · {t(c.applications.length > 1 ? "{n} candidatures" : "{n} candidature", { n: c.applications.length })}</span>
                  </span>
                </Link>
              );
            })}
          </section>
        )}
        <div id="nouvel-appel">
          <NewCallForm
            blocked={await engagementBlock(id, "appel")}
            orgId={id}
            types={COLLAB_TYPES}
            ai={aiEnabled()}
            events={events.map((e) => ({ id: e.id, label: `${fmtDate(locale, e.startsAt)} — ${e.title}`, title: e.title, typeId: e.typeId, area: e.therapeuticArea }))}
            defaultEventId={events.some((e) => e.id === evenement) ? evenement : undefined}
          />
        </div>
      </main>
    </>
  );
}
