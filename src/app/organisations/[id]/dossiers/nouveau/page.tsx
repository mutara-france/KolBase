import { aiEnabled } from "@/lib/ai";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { NewProjectForm } from "@/components/ProjectForms";
import { db } from "@/lib/db";
import { isVerifiedOrg, notVerified, requireMembership } from "@/lib/orgs";
import { COLLAB_TYPES, SOURCING_ROLES } from "@/lib/projects";
import { BillingNotice } from "@/components/BillingNotice";
import { engagementBlock } from "@/lib/billing";
import { canSee, kolVisibility } from "@/lib/visibility";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Nouveau dossier")} — KolBase` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ expert?: string }> }) {
  const { t } = await getT();
  const { id } = await params;
  const { expert } = await searchParams;
  const { org } = await requireMembership(id, SOURCING_ROLES);
  if (!isVerifiedOrg(org)) {
    return (
      <>
        <SiteHeader />
        <main className="narrow stack">
          <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/dossiers`}>{t("Dossiers")}</Link></p>
          <section className="card stack-sm">
            <h1>{t("Nouveau dossier")}</h1>
            <p>{t(notVerified(org))}</p>
            <p><Link className="btn secondary" href={`/organisations/${id}/membres?onglet=organisation`}>{t("Suivre la validation")}</Link></p>
          </section>
        </main>
      </>
    );
  }
  const include = { user: { select: { firstName: true, lastName: true } } } as const;
  const [list, chosen] = await Promise.all([
    db.practitionerProfile.findMany({ where: { listed: true }, include, orderBy: { user: { lastName: "asc" } }, take: 500 }),
    // L'expert choisi depuis l'annuaire figure toujours dans la liste, même au-delà des 500 premiers.
    expert ? db.practitionerProfile.findFirst({ where: { id: expert, listed: true }, include }) : null,
  ]);
  const experts = chosen && !list.some((e) => e.id === chosen.id) ? [chosen, ...list] : list;
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <BillingNotice orgId={id} motive="sollicitation" />
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/dossiers`}>{t("Dossiers")}</Link></p>
        <NewProjectForm
          ai={aiEnabled()}
          blocked={await engagementBlock(id, "sollicitation")}
          orgId={id}
          types={COLLAB_TYPES}
          preselected={expert && experts.some((e) => e.id === expert) ? [expert] : []}
          experts={experts.map((e) => {
            // Réglages de visibilité du praticien, vus par un membre d'organisation.
            const v = kolVisibility(e.visibility);
            return {
              id: e.id,
              name: `Dr ${e.user.firstName} ${e.user.lastName}`,
              detail: [t(e.specialty || e.profession), canSee(v.contact, "membre") ? e.city : null].filter(Boolean).join(" · "),
              dayRateCents: canSee(v.tarif, "membre") ? e.dayRateCents : null,
            };
          })}
        />
      </main>
    </>
  );
}
