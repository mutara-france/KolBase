import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { NewEventForm } from "@/components/EventForms";
import { requireMembership } from "@/lib/orgs";
import { db } from "@/lib/db";
import { BillingNotice } from "@/components/BillingNotice";
import { BENEFIT_CATALOG, EVENT_ORGANIZER_ROLES, EVENT_TYPES, FORMAT_LABEL } from "@/lib/events";

export const metadata = { title: "Nouvel événement — KolBase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dossier?: string }> }) {
  const { id } = await params;
  const { dossier } = await searchParams;
  const { org } = await requireMembership(id, EVENT_ORGANIZER_ROLES);
  const project = dossier ? await db.project.findFirst({ where: { id: dossier, organizationId: id }, select: { id: true, title: true, therapeuticArea: true } }) : null;
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <BillingNotice orgId={id} motive="evenement" />
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/evenements`}>Événements</Link></p>
        <NewEventForm
          orgId={id}
          types={EVENT_TYPES.map((t) => ({ value: t.id, label: t.label }))}
          formats={Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label }))}
          catalog={BENEFIT_CATALOG}
          project={project ? { id: project.id, title: project.title, area: project.therapeuticArea } : undefined}
        />
      </main>
    </>
  );
}
