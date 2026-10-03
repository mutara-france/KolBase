import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { StatusPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate } from "@/lib/events";
import { collabType, PROJECT_ROLES, PROJECT_VIEW_ROLES } from "@/lib/projects";

export const metadata = { title: "Dossiers — Kolbase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, roles } = await requireMembership(id, PROJECT_VIEW_ROLES);
  const canCreate = roles.some((r) => PROJECT_ROLES.includes(r));
  const projects = await db.project.findMany({
    where: { organizationId: id },
    include: { experts: { include: { practitioner: { include: { user: { select: { lastName: true } } } } } } },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Dossiers</p>
        <div className="actions spread">
          <h1>Dossiers de collaboration</h1>
          {canCreate && <Link className="btn" href={`/organisations/${id}/dossiers/nouveau`}>Nouveau dossier</Link>}
        </div>
        {projects.length === 0 ? (
          <p className="muted">Aucun dossier. Créez-en un, ou sollicitez un expert depuis l&apos;annuaire.</p>
        ) : (
          <section className="card">
            <table className="table">
              <thead><tr><th>Dossier</th><th>Type</th><th>Experts</th><th>Statut</th><th>Mis à jour</th></tr></thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/organisations/${id}/dossiers/${p.id}`}>{p.title}</Link></td>
                    <td>{collabType(p.typeId)?.label ?? p.typeId}</td>
                    <td>{p.experts.map((e) => `Dr ${e.practitioner.user.lastName}`).join(", ")}</td>
                    <td><StatusPill status={p.status} /></td>
                    <td>{formatDate(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </>
  );
}
