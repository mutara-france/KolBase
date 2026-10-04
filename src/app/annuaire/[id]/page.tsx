import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { requireDirectoryAccess } from "@/lib/orgs";
import { PROJECT_ROLES } from "@/lib/projects";

export const metadata = { title: "Fiche expert — Kolbase" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireDirectoryAccess();
  const { id } = await params;
  const e = await db.practitionerProfile.findFirst({
    where: { id, listed: true },
    include: { user: { select: { firstName: true, lastName: true } } },
  });
  if (!e) notFound();
  const isOrgViewer = viewer.memberships.length > 0;
  const projectOrg = viewer.memberships.find((m) => PROJECT_ROLES.includes(m.role));

  return (
    <>
      <SiteHeader />
      <main className="narrow stack">
        <div className="tile-head">
          <Avatar name={`${e.user.firstName} ${e.user.lastName}`} size={64} />
          <div>
          <h1>Dr {e.user.firstName} {e.user.lastName}</h1>
          <p className="muted">{[e.profession, e.specialty, e.subspecialty].filter(Boolean).join(" · ")}</p>
          {projectOrg && (
            <Link className="btn" href={`/organisations/${projectOrg.organizationId}/dossiers/nouveau?expert=${e.id}`}>
              Solliciter{viewer.memberships.length > 1 ? ` au nom de ${projectOrg.organization.name}` : ""}
            </Link>
          )}
          </div>
        </div>
        <section className="card">
          <dl className="facts">
            {e.city && (<><dt>Ville</dt><dd>{e.city}</dd></>)}
            {e.hospital && (<><dt>Établissement</dt><dd>{e.hospital}</dd></>)}
            {e.languages.length > 0 && (<><dt>Langues</dt><dd>{e.languages.join(", ")}</dd></>)}
            <dt>RPPS</dt><dd>{e.rpps ? (e.rppsVerified ? "Vérifié" : "Déclaré, non vérifié") : "Non renseigné"}</dd>
            {e.orcid && (<><dt>ORCID</dt><dd><a href={`https://orcid.org/${e.orcid}`} target="_blank" rel="noreferrer">{e.orcid}</a></dd></>)}
            {isOrgViewer && e.dayRateCents != null && (<><dt>Tarif journalier indicatif</dt><dd>{(e.dayRateCents / 100).toLocaleString("fr-FR")} € HT</dd></>)}
          </dl>
        </section>
        {e.bio && <section className="card"><h2>Présentation</h2><p>{e.bio}</p></section>}
        {e.interventionTypes.length > 0 && (
          <section className="card"><h2>Interventions proposées</h2><span className="tags">{e.interventionTypes.map((t) => <span key={t} className="tag">{t}</span>)}</span></section>
        )}
      </main>
    </>
  );
}
