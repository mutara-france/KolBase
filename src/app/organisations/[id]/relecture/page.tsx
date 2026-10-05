import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { MaterialsPanel } from "@/components/DossierSections";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { collabType, PROJECT_VIEW_ROLES, REVIEW_ROLES } from "@/lib/projects";

export const metadata = { title: "Revue documentaire — Kolbase" };

/** Espace de la relecture médico-réglementaire (MLR) : les supports à relire, sans le reste du dossier (budget, honoraires, conflits). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string }> }) {
  const { id } = await params;
  const { onglet = "a-relire" } = await searchParams;
  const { org, roles } = await requireMembership(id, REVIEW_ROLES);
  const canOpenDossier = roles.some((r) => PROJECT_VIEW_ROLES.includes(r));

  const projects = await db.project.findMany({
    where: { organizationId: id, materials: { some: {} } },
    include: { materials: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } } },
    orderBy: { updatedAt: "desc" },
  });
  const pending = (p: (typeof projects)[number]) => p.materials.filter((m) => m.versions[0]?.status === "submitted").length;
  const toReview = projects.filter((p) => pending(p) > 0);
  const shown = onglet === "a-relire" ? toReview : projects;
  const tabs = [["a-relire", `À relire (${toReview.reduce((s, p) => s + pending(p), 0)})`], ["tous", `Tous les supports (${projects.reduce((s, p) => s + p.materials.length, 0)})`]] as const;

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Revue documentaire</p>
        <h1>Revue documentaire</h1>
        <p className="muted">Supports soumis par les experts et les équipes : approuvez-les ou demandez des modifications avant toute diffusion.</p>
        <nav className="tabs">
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>
        {shown.length === 0 && <div className="card empty"><FlaskConical size={22} /><p>Aucun support {onglet === "a-relire" ? "en attente de relecture" : "soumis"}.</p></div>}
        {shown.map((p) => (
          <section key={p.id} className="stack-sm">
            <div className="eyebrow-sm">
              {collabType(p.typeId)?.label ?? p.typeId}{p.therapeuticArea ? ` · ${p.therapeuticArea}` : ""}
            </div>
            <h2 style={{ margin: 0 }}>{canOpenDossier ? <Link href={`/organisations/${id}/dossiers/${p.id}`}>{p.title}</Link> : p.title}</h2>
            <MaterialsPanel orgId={id} projectId={p.id} canSubmit={false} canReview />
          </section>
        ))}
      </main>
    </>
  );
}
