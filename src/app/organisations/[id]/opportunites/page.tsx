import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { NewCallForm } from "@/components/OpportunityForms";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate } from "@/lib/events";
import { COLLAB_TYPES, collabType, SOURCING_ROLES } from "@/lib/projects";

export const metadata = { title: "Opportunités — KolBase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org } = await requireMembership(id, SOURCING_ROLES);
  const calls = await db.openCall.findMany({
    where: { organizationId: id },
    include: { applications: { select: { status: true } } },
    orderBy: { createdAt: "desc" },
  });
  const sectionTabs = await orgTabs("praticiens", id);
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="appels" label="Rubrique Praticiens" />
        <h1>Appels publiés</h1>
        {calls.length > 0 && (
          <section className="card">
            <table className="table">
              <thead><tr><th>Titre</th><th>Type</th><th>Date limite</th><th>Candidatures</th><th>Statut</th></tr></thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/organisations/${id}/opportunites/${c.id}`}>{c.title}</Link></td>
                    <td>{collabType(c.typeId)?.label ?? c.typeId}</td>
                    <td>{c.deadline ? formatDate(c.deadline) : "—"}</td>
                    <td>{c.applications.length}{c.applications.some((a) => a.status === "pending") ? ` (${c.applications.filter((a) => a.status === "pending").length} à traiter)` : ""}</td>
                    <td>{c.status === "open" ? "Ouverte" : "Clôturée"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        <div id="nouvel-appel"><NewCallForm orgId={id} types={COLLAB_TYPES} /></div>
      </main>
    </>
  );
}
