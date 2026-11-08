import Link from "next/link";
import { PageHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { PartnershipAnswerForm } from "@/components/CongressForms";
import { orgTabs } from "@/lib/org-overview";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { PARTNER_STATUS, partnerLevelLabel } from "@/lib/congress";
import { getT } from "@/lib/i18n/server";
import { fmtDate, fmtEur } from "@/lib/i18n";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Partenariats")} — KolBase` };
}

/**
 * Partenariats proposés à l'organisation par les organisateurs de congrès (sociétés savantes, associations,
 * organismes de formation) : l'administration ou la conformité signe ou décline ; les conventions signées sont à
 * déclarer sur Transparence Santé (bénéficiaire personne morale).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const { roles } = await requireMembership(id, ["ADMIN", "CONFORMITE", "PROJETS"]);
  const canAnswer = roles.some((r) => r === "ADMIN" || r === "CONFORMITE");
  const list = await db.eventPartner.findMany({
    where: { organizationId: id, status: { not: "draft" } },
    include: { event: { select: { id: true, title: true, startsAt: true, publishedAt: true, inviteOnly: true, organization: { select: { name: true } } } } },
    orderBy: [{ proposedAt: "desc" }],
  });
  const sectionTabs = await orgTabs("conformite", id);
  const pending = list.filter((p) => p.status === "proposed");
  const rest = list.filter((p) => p.status !== "proposed");
  const item = (p: (typeof list)[number]) => {
    const st = PARTNER_STATUS[p.status] ?? PARTNER_STATUS.draft;
    return (
      <li key={p.id} className="card stack-sm">
        <div className="flex-between">
          <strong>{p.event.publishedAt && !p.event.inviteOnly ? <Link href={`/evenements/${p.event.id}`}>{p.event.title}</Link> : p.event.title}</strong>
          <span className={`pill ${st.tone}`}>{t(st.label)}</span>
        </div>
        <p className="text-sm muted">
          {[p.event.organization.name, fmtDate(locale, p.event.startsAt), t(partnerLevelLabel(p.level)), p.amountCents != null ? `${fmtEur(locale, p.amountCents)} ${t("HT")}` : null].filter(Boolean).join(" · ")}
        </p>
        {p.counterparts && <p className="text-sm">{t("Contreparties : {list}", { list: p.counterparts })}</p>}
        {p.status === "proposed" && (canAnswer ? <PartnershipAnswerForm orgId={id} partnerId={p.id} /> : <p className="hint">{t("L'administration ou la conformité de l'organisation signe ou décline.")}</p>)}
        {p.signedAt && <p className="text-xs muted">{t("Signée le {date}", { date: fmtDate(locale, p.signedAt) })}{p.paidAt ? ` · ${t("réglée le {date}", { date: fmtDate(locale, p.paidAt) })}` : ""}</p>}
      </li>
    );
  };
  return (
    <>
      <SiteHeader />
      <main className="stack">
        {roles.includes("CONFORMITE") && <SectionNav tabs={sectionTabs} active="partenariats" label={t("Rubrique Conformité")} />}
        <PageHead title={t("Partenariats")} desc={t("Conventions de partenariat proposées par les organisateurs de congrès et de formations. Signées, elles sont à déclarer sur Transparence Santé (bénéficiaire personne morale).")}>
          {list.some((p) => p.signedAt) && <a className="btn ghost small" href={`/organisations/${id}/partenariats/export`}>{t("Conventions signées (CSV)")}</a>}
        </PageHead>
        {list.length === 0 && <p className="muted">{t("Aucune proposition de partenariat pour l'instant.")}</p>}
        {pending.length > 0 && (
          <section className="stack-sm" aria-labelledby="a-signer">
            <h2 id="a-signer">{t("À signer")}</h2>
            <ul className="plain stack-sm">{pending.map(item)}</ul>
          </section>
        )}
        {rest.length > 0 && (
          <section className="stack-sm" aria-labelledby="historique">
            <h2 id="historique">{t("Historique")}</h2>
            <ul className="plain stack-sm">{rest.map(item)}</ul>
          </section>
        )}
      </main>
    </>
  );
}
