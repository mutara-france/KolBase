import { SiteHeader } from "@/components/SiteHeader";
import { EditOrgForm, InviteForm } from "@/components/OrgForms";
import { db } from "@/lib/db";
import { ORG_KIND_LABEL, ROLE_LABEL, requireMembership } from "@/lib/orgs";
import { removeMembership, revokeInvitation } from "@/lib/org-actions";
import Link from "next/link";
import { COMPLIANCE_ROLES, EVENT_MANAGER_ROLES } from "@/lib/events";
import { PROJECT_VIEW_ROLES } from "@/lib/projects";

export const metadata = { title: "Organisation — Kolbase" };

const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, roles, isAdmin, user } = await requireMembership(id);
  const [members, invitations] = await Promise.all([
    db.membership.findMany({ where: { organizationId: id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    isAdmin
      ? db.invitation.findMany({ where: { organizationId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);
  const roleOpts = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div>
          <h1>{org.name}</h1>
          <p className="muted">{ORG_KIND_LABEL[org.kind]} · vos rôles : {roles.map((r) => ROLE_LABEL[r]).join(", ")}</p>
        </div>

        <div className="actions">
          {roles.some((r) => PROJECT_VIEW_ROLES.includes(r)) && <Link className="btn" href={`/organisations/${id}/dossiers`}>Dossiers</Link>}
          {roles.some((r) => EVENT_MANAGER_ROLES.includes(r)) && <Link className="btn" href={`/organisations/${id}/evenements`}>Événements</Link>}
          {roles.some((r) => COMPLIANCE_ROLES.includes(r)) && <Link className="btn ghost" href={`/organisations/${id}/hospitalites`}>Hospitalités</Link>}
          <Link className="btn ghost" href="/annuaire">Annuaire des experts</Link>
        </div>

        <section className="card">
          <h2>Membres ({members.length})</h2>
          <table className="table">
            <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Depuis</th>{isAdmin && <th />}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.user.firstName} {m.user.lastName}{m.userId === user.id && " (vous)"}</td>
                  <td>{m.user.email}</td>
                  <td>{ROLE_LABEL[m.role]}</td>
                  <td>{fmt(m.createdAt)}</td>
                  {isAdmin && (
                    <td>
                      {!(m.role === "ADMIN" && members.filter((x) => x.role === "ADMIN").length <= 1) && (
                        <form action={removeMembership}>
                          <input type="hidden" name="orgId" value={id} />
                          <input type="hidden" name="membershipId" value={m.id} />
                          <button className="link danger">Retirer</button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {isAdmin && (
          <>
            <InviteForm orgId={id} roles={roleOpts} />
            {invitations.length > 0 && (
              <section className="card">
                <h2>Invitations en attente</h2>
                <table className="table">
                  <thead><tr><th>Rôle</th><th>Mémo</th><th>Expire le</th><th /></tr></thead>
                  <tbody>
                    {invitations.map((i) => (
                      <tr key={i.id}>
                        <td>{ROLE_LABEL[i.role]}</td>
                        <td>{i.email ?? "—"}</td>
                        <td>{fmt(i.expiresAt)}</td>
                        <td>
                          <form action={revokeInvitation}>
                            <input type="hidden" name="orgId" value={id} />
                            <input type="hidden" name="invitationId" value={i.id} />
                            <button className="link danger">Révoquer</button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
            <EditOrgForm org={{ id: org.id, name: org.name, sector: org.sector, headquarters: org.headquarters, contactEmail: org.contactEmail, about: org.about, policy: org.policy, areas: org.areas }} />
          </>
        )}
      </main>
    </>
  );
}
