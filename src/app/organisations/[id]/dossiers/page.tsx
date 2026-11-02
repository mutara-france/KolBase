import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SectionNav } from "@/components/SectionNav";
import { orgTabs } from "@/lib/org-overview";
import { StatusPill } from "@/components/ProjectBits";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { formatDate } from "@/lib/events";
import { collabType, PROJECT_VIEW_ROLES, SOURCING_ROLES } from "@/lib/projects";

export const metadata = { title: "Dossiers — KolBase" };

const PER_PAGE = 50;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id } = await params;
  const { roles } = await requireMembership(id, PROJECT_VIEW_ROLES);
  const canCreate = roles.some((r) => SOURCING_ROLES.includes(r));
  const total = await db.project.count({ where: { organizationId: id } });
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number((await searchParams).page)) || 1));
  const projects = await db.project.findMany({
    where: { organizationId: id },
    include: { experts: { include: { practitioner: { include: { user: { select: { lastName: true } } } } } } },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
  });
  const pageHref = (n: number) => `/organisations/${id}/dossiers${n > 1 ? `?page=${n}` : ""}`;
  const sectionTabs = await orgTabs("dossiers", id);
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <SectionNav tabs={sectionTabs} active="dossiers" label="Rubrique Dossiers" />
        <div className="actions spread">
          <h1>Dossiers de collaboration</h1>
          {canCreate && <Link className="btn" href={`/organisations/${id}/dossiers/nouveau`}>Nouveau dossier</Link>}
        </div>
        {projects.length === 0 ? (
          <p className="muted">Aucun dossier. Créez-en un, ou sollicitez un expert depuis l&apos;annuaire.</p>
        ) : (
          <section className="card">
            <table className="table" tabIndex={0}>
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
            {pages > 1 && (
              <nav className="pager" aria-label="Pages de dossiers">
                {page > 1 ? <Link href={pageHref(page - 1)} className="btn ghost small" rel="prev">Précédent</Link> : <span />}
                <span className="muted text-sm">{total} dossiers · page {page} sur {pages}</span>
                {page < pages ? <Link href={pageHref(page + 1)} className="btn ghost small" rel="next">Suivant</Link> : <span />}
              </nav>
            )}
          </section>
        )}
      </main>
    </>
  );
}
