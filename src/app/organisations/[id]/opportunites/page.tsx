import { EmptyState, PageHead } from "@/components/UI";
import { CalendarOff, SearchX } from "lucide-react";
import { ActiveFilters, FilterChips, FilterSelect } from "@/components/Filters";
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


export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ evenement?: string; statut?: string; type?: string; lien?: string; q?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { evenement, statut = "", type = "", lien = "", q = "" } = await searchParams;
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
  // Filtres : statut (pastilles avec décompte), type, avec ou sans événement, recherche.
  const isClosed = (c: (typeof calls)[number]) => c.status !== "open" || (c.deadline != null && c.deadline < now);
  const toReview = (c: (typeof calls)[number]) => c.applications.some((a) => a.status === "pending");
  const byStatus = { ouvertes: calls.filter((c) => !isClosed(c)), "a-examiner": calls.filter(toReview), cloturees: calls.filter(isClosed) } as const;
  const needle = q.trim().toLowerCase();
  const shown = (statut in byStatus ? byStatus[statut as keyof typeof byStatus] : calls)
    .filter((c) => !type || c.typeId === type)
    .filter((c) => (lien === "avec" ? !!c.event : lien === "sans" ? !c.event : true))
    .filter((c) => !needle || [c.title, c.specialty, c.description, c.event?.title].some((x) => x?.toLowerCase().includes(needle)));
  const fparams = { statut, type, lien, q };
  const types = COLLAB_TYPES.filter((x) => calls.some((c) => c.typeId === x.id));
  const path = `/organisations/${id}/opportunites`;
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <BillingNotice orgId={id} motive="appel" />
        <SectionNav tabs={sectionTabs} active="appels" label={t("Rubrique Praticiens")} />
        <PageHead title={t("Opportunités")} desc={t("Publiez une collaboration ou une intervention : les experts référencés candidatent, vous retenez et proposez vos honoraires.")}>
          <a className="btn" href="#nouvel-appel">{t("Nouvelle opportunité")}</a>
        </PageHead>
        <p className="muted">
          {t("Une opportunité invite les experts référencés à candidater, pour une collaboration (board, étude, rédaction…) ou pour intervenir à l'un de vos événements (formation, symposium…). Vous retenez qui vous voulez ; chaque personne retenue reçoit une proposition d'honoraires et un dossier s'ouvre.")}
        </p>
        {calls.length > 0 && (
          <>
            <FilterChips
              path={path}
              params={fparams}
              name="statut"
              value={statut}
              options={[
                { value: "", label: t("Toutes"), count: calls.length },
                { value: "ouvertes", label: t("Ouvertes"), count: byStatus.ouvertes.length },
                { value: "a-examiner", label: t("Candidatures à examiner"), count: byStatus["a-examiner"].length },
                { value: "cloturees", label: t("Clôturées"), count: byStatus.cloturees.length },
              ]}
            />
            <form className="filter-bar boxed" role="search" action={path}>
              {statut && <input type="hidden" name="statut" value={statut} />}
              <label htmlFor="calls-q" className="sr-only">{t("Recherche")}</label>
              <input id="calls-q" name="q" type="search" defaultValue={q} placeholder={t("Titre, spécialité, événement…")} />
              <FilterSelect name="type" label={t("Type")} value={type} all={t("Tous les types")} options={types.map((x) => ({ value: x.id, label: t(x.label) }))} />
              <FilterSelect name="lien" label={t("Événement")} value={lien} all={t("Avec ou sans événement")} options={[{ value: "avec", label: t("Rattachées à un événement") }, { value: "sans", label: t("Hors événement") }]} />
              <button className="btn secondary">{t("Filtrer")}</button>
            </form>
            <ActiveFilters
              path={path}
              params={fparams}
              ariaLabel={t("Filtres actifs")}
              clearLabel={t("Tout effacer")}
              labels={{
                q: q && t("Recherche : {value}", { value: q }),
                type: type && t("Type : {value}", { value: t(collabType(type)?.label ?? type) }),
                lien: lien && (lien === "avec" ? t("Rattachées à un événement") : t("Hors événement")),
              }}
            />
          </>
        )}
        {calls.length > 0 && shown.length === 0 && <div className="card empty"><EmptyState icon={SearchX} title={t("Aucune opportunité pour ces critères.")} action={<Link className="btn secondary small" href={path}>{t("Tout afficher")}</Link>} /></div>}
        {shown.length > 0 && (
          <section className="card row-list">
            {shown.map((c) => {
              const pending = c.applications.filter((a) => a.status === "pending").length;
              const retained = c.applications.filter((a) => a.status === "retained").length;
              const closed = c.status !== "open" || (c.deadline != null && c.deadline < now);
              return (
                <Link key={c.id} href={`/organisations/${id}/opportunites/${c.id}`} className="row-item">
                  {c.event ? (
                    <span className="date-block" aria-hidden><strong>{fmtDate(locale, c.event.startsAt, { day: "numeric" })}</strong><small>{fmtDate(locale, c.event.startsAt, { month: "short" })}</small></span>
                  ) : (
                    <span className="date-block muted-block" title={t("Sans événement")}><CalendarOff size={20} strokeWidth={1.7} aria-hidden /><span className="sr-only">{t("Sans événement")}</span></span>
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
