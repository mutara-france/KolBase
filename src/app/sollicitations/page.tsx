import { SectionHead, PageHead, EmptyState } from "@/components/UI";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { ExpertLinkPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { History, Inbox, Plus } from "lucide-react";
import { SectionNav } from "@/components/SectionNav";
import { practitionerSectionTabs } from "@/lib/nav";
import { awaitingExpert, collabType, expertLinkState, PROPOSAL_ORIGIN } from "@/lib/projects";
import { fmtDate, fmtEur } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Mes sollicitations")} — KolBase` };
}

export default async function Page() {
  const user = await requireUser();
  const { t, locale } = await getT();
  // Projets proposés par l'expert : dans « Mes propositions » tant que l'organisation n'a pas répondu (ou s'ils sont
  // clos sans suite) ; acceptés, ils deviennent des dossiers suivis ici comme les sollicitations.
  const links = user.practitioner
    ? await db.projectExpert.findMany({
        where: { practitionerId: user.practitioner.id, NOT: { project: { origin: PROPOSAL_ORIGIN, status: { in: ["ATT_IND", "DECLINE"] } } } },
        include: { project: { include: { organization: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  // À traiter : la réponse de l'expert est attendue (pas une contre-proposition en attente de l'organisation).
  const pending = links.filter((l) => awaitingExpert(l, l.project.status));
  const others = links.filter((l) => !pending.includes(l));

  /** Une ligne par collaboration, comme la liste des dossiers côté organisation : objet, état, honoraires. */
  const Tile = ({ l }: { l: (typeof links)[number] }) => {
    const label = collabType(l.project.typeId)?.label;
    return (
      <Link href={`/sollicitations/${l.id}`} className="row-item">
        <span className="row-main">
          <strong>{l.project.title}</strong>
          <span className="muted text-sm">{l.project.organization.name}{label ? ` · ${t(label)}` : ""}</span>
          <span className="text-xs muted">{l.project.origin === PROPOSAL_ORIGIN ? t("Votre proposition, acceptée · envoyée le {date}", { date: fmtDate(locale, l.createdAt) }) : t("Reçue le {date}", { date: fmtDate(locale, l.createdAt) })}</span>
        </span>
        <span className="row-status"><ExpertLinkPill state={expertLinkState(l, l.project)} status={l.status} /></span>
        <span className="row-figures">
          <strong>{l.feeCents != null ? t("{amount} HT", { amount: fmtEur(locale, l.feeCents) }) : "—"}</strong>
          <span className="text-xs muted">{t("honoraires proposés")}</span>
        </span>
      </Link>
    );
  };

  return (
    <>
      <SiteHeader />
      <main className="stack">
        {user.practitioner?.listed && <SectionNav tabs={practitionerSectionTabs("sollicitations").map((tab) => ({ ...tab, label: t(tab.label) }))} active="recues" label={t("Rubrique Sollicitations")} />}
        <PageHead title={t("Mes sollicitations")} desc={t("Les collaborations que les organisations vous proposent : répondez, échangez, signez votre convention.")}>
          {user.practitioner?.listed && <Link className="btn secondary" href="/propositions/nouvelle"><Plus size={15} /> {t("Proposer un projet")}</Link>}
        </PageHead>
        {!user.practitioner?.listed && <p className="notice warn">{t("Référencez-vous comme expert dans")} <Link href="/compte">{t("Mon compte")}</Link> {t("pour recevoir des sollicitations.")}</p>}
        {links.length === 0 && (
          <div className="card empty">
            <EmptyState icon={Inbox} title={t("Aucune sollicitation pour l'instant.")} action={user.practitioner?.listed ? <Link className="btn secondary small" href="/opportunites">{t("Voir les opportunités")}</Link> : undefined}>
              {t("Les organisations vous sollicitent depuis l'annuaire des experts ; vous pouvez aussi candidater à leurs opportunités.")}
            </EmptyState>
          </div>
        )}
        {pending.length > 0 && (
          <section className="card row-list" aria-label={t("À traiter")}>
            <SectionHead icon={Inbox} tone="warn" title={t("À traiter ({n})", { n: pending.length })} />
            {pending.map((l) => <Tile key={l.id} l={l} />)}
          </section>
        )}
        {others.length > 0 && (
          <section className="card row-list" aria-label={t("Historique")}>
            <SectionHead icon={History} title={t("Historique")} />
            {others.map((l) => <Tile key={l.id} l={l} />)}
          </section>
        )}
      </main>
    </>
  );
}
