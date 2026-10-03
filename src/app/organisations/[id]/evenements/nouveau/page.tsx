import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { NewEventForm } from "@/components/EventForms";
import { requireMembership } from "@/lib/orgs";
import { BENEFIT_CATALOG, EVENT_MANAGER_ROLES, EVENT_TYPES, FORMAT_LABEL } from "@/lib/events";

export const metadata = { title: "Nouvel événement — Kolbase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireMembership(id, EVENT_MANAGER_ROLES);
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/evenements`}>Événements</Link></p>
        <NewEventForm
          orgId={id}
          types={EVENT_TYPES.map((t) => ({ value: t.id, label: t.label }))}
          formats={Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label }))}
          catalog={BENEFIT_CATALOG}
        />
      </main>
    </>
  );
}
