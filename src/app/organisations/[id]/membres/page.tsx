import { SiteHeader } from "@/components/SiteHeader";
import { EditOrgForm, InviteForm, LogoForm, MemberRolesForm, VerificationCard } from "@/components/OrgForms";
import { Avatar } from "@/components/Avatar";
import type { OrgRole } from "@/generated/prisma/client";
import { logoSrc } from "@/lib/logos";
import { db } from "@/lib/db";
import { ORG_KIND_LABEL, invitableRoles, requireMembership, roleLabel } from "@/lib/orgs";
import { ROLE_DESC } from "@/lib/org-roles";
import { revokeInvitation } from "@/lib/org-actions";
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
  const roleOpts = invitableRoles(org.kind).map((value) => ({ value, label: roleLabel(value, org.kind), desc: org.kind === "PRESTATAIRE" ? (value === "ADMIN" ? "Équipe, fiche prestataire et devis." : "Répond aux demandes de devis.") : ROLE_DESC[value] }));
  // Une ligne par personne, avec l'ensemble de ses rôles.
  const people = [...members.reduce((acc, m) => {
    const p = acc.get(m.userId) ?? { userId: m.userId, user: m.user, roles: [] as OrgRole[], since: m.createdAt };
    p.roles.push(m.role);
    if (m.createdAt < p.since) p.since = m.createdAt;
    return acc.set(m.userId, p);
  }, new Map<string, { userId: string; user: (typeof members)[number]["user"]; roles: OrgRole[]; since: Date }>()).values()];
  const adminCount = people.filter((p) => p.roles.includes("ADMIN")).length;
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
          <h2>Membres ({people.length})</h2>
          {isAdmin && (
            <ul className="role-legend">
              {roleOpts.map((r) => <li key={r.value}><strong>{r.label}</strong> : {r.desc}</li>)}
            </ul>
          )}
          <ul className="member-list">
            {people.map((p) => (
              <li key={p.userId} className="member-row">
                <Avatar name={`${p.user.firstName} ${p.user.lastName}`} size={40} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <strong>{p.user.firstName} {p.user.lastName}</strong>{p.userId === user.id && <span className="muted"> (vous)</span>}
                  <div className="text-xs muted">{p.user.email} · membre depuis le {fmt(p.since)}</div>
                  {isAdmin ? (
                    <MemberRolesForm orgId={id} userId={p.userId} roles={p.roles} options={roleOpts} canRemove={!(p.roles.includes("ADMIN") && adminCount <= 1)} />
                  ) : (
                    <div className="role-chips mt-1">{p.roles.map((r) => <span key={r} className="pill">{roleLabel(r, org.kind)}</span>)}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
