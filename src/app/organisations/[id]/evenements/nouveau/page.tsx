import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { NewEventForm } from "@/components/EventForms";
import { requireMembership } from "@/lib/orgs";
import { db } from "@/lib/db";
import { BillingNotice } from "@/components/BillingNotice";
import { engagementBlock } from "@/lib/billing";
import { BENEFIT_CATALOG, EVENT_ORGANIZER_ROLES, EVENT_TYPES, FORMAT_LABEL } from "@/lib/events";
import { complianceSettings } from "@/lib/compliance";
import { getT } from "@/lib/i18n/server";
import { eventPublishable } from "@/lib/projects";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Nouvel événement")} — KolBase` };
}

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dossier?: string }> }) {
  const { t } = await getT();
  const { id } = await params;
  const { dossier } = await searchParams;
  const { org } = await requireMembership(id, EVENT_ORGANIZER_ROLES);
  const project = dossier ? await db.project.findFirst({ where: { id: dossier, organizationId: id }, select: { id: true, title: true, therapeuticArea: true, status: true } }) : null;
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <BillingNotice orgId={id} motive="evenement" />
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/evenements`}>{t("Événements")}</Link></p>
        <NewEventForm
          orgId={id}
          blocked={await engagementBlock(id, "evenement")}
          types={EVENT_TYPES.map((tk) => ({ value: tk.id, label: t(tk.label) }))}
          formats={Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label: t(label) }))}
          catalog={BENEFIT_CATALOG}
          limits={complianceSettings(org.complianceSettings)}
          review={org.eventReview}
          project={project ? { id: project.id, title: project.title, area: project.therapeuticArea, publishable: eventPublishable(project.status) } : undefined}
        />
      </main>
    </>
  );
}
