import { SiteHeader } from "@/components/SiteHeader";
import { EditOrgForm, InviteForm, LogoForm, VerificationCard } from "@/components/OrgForms";
import { logoSrc } from "@/lib/logos";
import { db } from "@/lib/db";
import { ORG_KIND_LABEL, invitableRoles, requireMembership, roleLabel } from "@/lib/orgs";
import { removeMembership, revokeInvitation } from "@/lib/org-actions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OrgVisibilityForm } from "@/components/ProfileForms";
import { companyVisibility } from "@/lib/visibility";

export const metadata = { title: "Membres et réglages — KolBase" };

const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, roles, isAdmin, user } = await requireMembership(id);
  // Un prestataire mandaté (externe) ne voit pas l'équipe ni les réglages de l'organisation.
  if (roles.every((r) => r === "PRESTATAIRE")) redirect(`/organisations/${id}`);
  const [members, invitations] = await Promise.all([
    db.membership.findMany({ where: { organizationId: id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    isAdmin
      ? db.invitation.findMany({ where: { organizationId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);
  const roleOpts = invitableRoles(org.kind).map((value) => ({ value, label: roleLabel(value, org.kind) }));
  const isSupplier = org.kind === "PRESTATAIRE";

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div>
          <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Membres et réglages</p>
          <h1>Membres et réglages</h1>
          <p className="muted">{ORG_KIND_LABEL[org.kind]} · vos rôles : {roles.map((r) => roleLabel(r, org.kind)).join(", ")}</p>
        </div>

        <VerificationCard orgId={id} canEdit={isAdmin} v={{ status: org.verification, siren: org.siren, legalName: org.legalName, note: org.verificationNote }} />

        <section className="card">
          <h2>Membres ({members.length})</h2>
          <table className="table" tabIndex={0}>
            <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Depuis</th>{isAdmin && <th />}</tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.user.firstName} {m.user.lastName}{m.userId === user.id && " (vous)"}</td>
                  <td>{m.user.email}</td>
                  <td>{roleLabel(m.role, org.kind)}</td>
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
                <table className="table" tabIndex={0}>
                  <thead><tr><th>Rôle</th><th>Mémo</th><th>Expire le</th><th /></tr></thead>
                  <tbody>
                    {invitations.map((i) => (
                      <tr key={i.id}>
                        <td>{roleLabel(i.role, org.kind)}</td>
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
            {/* Le référencement d'un prestataire se règle avec sa fiche prestataire (page Demandes de devis). */}
            {!isSupplier && <OrgVisibilityForm orgId={id} v={companyVisibility(org.visibility)} listed={org.listed} />}
            <LogoForm orgId={id} name={org.name} src={logoSrc(org)} verified={org.verification === "VERIFIED"} />
            <EditOrgForm org={{ id: org.id, name: org.name, sector: org.sector, headquarters: org.headquarters, contactEmail: org.contactEmail, about: org.about, policy: org.policy, areas: org.areas }} />
          </>
        )}
      </main>
    </>
  );
}
