import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { NewProjectForm } from "@/components/ProjectForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COLLAB_TYPES, PROJECT_ROLES } from "@/lib/projects";

export const metadata = { title: "Nouveau dossier — Kolbase" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ expert?: string }> }) {
  const { id } = await params;
  const { expert } = await searchParams;
  const { org } = await requireMembership(id, PROJECT_ROLES);
  const experts = await db.practitionerProfile.findMany({
    where: { listed: true },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { user: { lastName: "asc" } },
    take: 500,
  });
  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / <Link href={`/organisations/${id}/dossiers`}>Dossiers</Link></p>
        <NewProjectForm
          orgId={id}
          types={COLLAB_TYPES}
          preselected={expert && experts.some((e) => e.id === expert) ? [expert] : []}
          experts={experts.map((e) => ({
            id: e.id,
            name: `Dr ${e.user.firstName} ${e.user.lastName}`,
            detail: [e.specialty || e.profession, e.city].filter(Boolean).join(" · "),
            dayRateCents: e.dayRateCents,
          }))}
        />
      </main>
    </>
  );
}
