import { SiteHeader } from "@/components/SiteHeader";
import { EditOrgForm, InviteForm, LogoForm, MemberRolesForm, VerificationCard } from "@/components/OrgForms";
import { Avatar } from "@/components/Avatar";
import type { OrgRole } from "@/generated/prisma/client";
import { logoSrc } from "@/lib/logos";
import { db } from "@/lib/db";
import { ORG_KIND_LABEL, invitableRoles, requireMembership, roleLabel } from "@/lib/orgs";
import { ROLE_DESC } from "@/lib/org-roles";
import { acceptDpa, revokeInvitation } from "@/lib/org-actions";
import { setEventFlag } from "@/lib/event-actions";
import { asMotive, asObjectId, ENGAGING, resumeAction } from "@/lib/billing-plans";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OrgVisibilityForm } from "@/components/ProfileForms";
import { DPA_VERSION } from "@/lib/dpa";
import { formatDate } from "@/lib/events";
import { ShieldCheck } from "lucide-react";
import { companyVisibility } from "@/lib/visibility";
import { OrgTwoFactorForm } from "@/components/TwoFactorForms";

export const metadata = { title: "Membres et réglages — KolBase" };

const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; motif?: string; objet?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const onglet = sp.onglet === "organisation" ? "organisation" : "equipe";
  const { org, roles, isAdmin, user } = await requireMembership(id);
  const dpaBy = org.dpaAcceptedById ? await db.user.findUnique({ where: { id: org.dpaAcceptedById }, select: { firstName: true, lastName: true } }).then((u) => (u ? `${u.firstName} ${u.lastName}` : null)) : null;
  // Un prestataire mandaté (externe) ne voit pas l'équipe ni les réglages de l'organisation.
  if (roles.every((r) => r === "PRESTATAIRE")) redirect(`/organisations/${id}`);
  const [members, invitations, mandates] = await Promise.all([
    db.membership.findMany({ where: { organizationId: id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    isAdmin
      ? db.invitation.findMany({ where: { organizationId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
    // Agences mandatées : leur équipe accède aux événements confiés par le mandat, sans invitation.
    org.kind === "PRESTATAIRE"
      ? Promise.resolve([])
      : db.mandate.findMany({
          where: { mandatorId: id, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
          include: { agency: { select: { id: true, name: true, _count: { select: { members: true } } } } },
          orderBy: { startsAt: "asc" },
        }),
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
  // Arrivée depuis une action refusée faute de contrat : rappel du motif, puis reprise de l'action une fois accepté.
  const motive = asMotive(sp.motif);
  const dpaOk = org.dpaVersion === DPA_VERSION && !!org.dpaAcceptedAt;
  const resume = motive && dpaOk ? resumeAction(id, motive, asObjectId(sp.objet)) : null;

  const tabs = [["equipe", `Équipe (${people.length})`], ["organisation", "Organisation"]] as const;
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div>
          <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Membres et réglages</p>
          <h1>Membres et réglages</h1>
        </div>
        <nav className="tabs" aria-label="Membres et réglages">
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "equipe" ? (
          <>
            <section className="card">
              <h2>Membres ({people.length})</h2>
              {isAdmin && (
                <ul className="role-legend">
                  {roleOpts.map((r) => <li key={r.value}><strong>{r.label}</strong> : {r.desc}</li>)}
                </ul>
              )}
              {isAdmin && <p className="hint">Cochez ou décochez un rôle : la modification est enregistrée aussitôt.</p>}
              <ul className="member-list">
                {people.map((p) => (
                  <li key={p.userId} className="member-row">
                    <Avatar name={`${p.user.firstName} ${p.user.lastName}`} size={40} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <strong>{p.user.firstName} {p.user.lastName}</strong>{p.userId === user.id && <span className="muted"> (vous)</span>}
                      <div className="text-xs muted">{p.user.email} · membre depuis le {fmt(p.since)}{isAdmin ? (p.user.totpEnabledAt ? " · double authentification activée" : " · sans double authentification") : ""}</div>
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

            {!isSupplier && (
              <section className="card stack-sm">
                <h2>Agences mandatées ({mandates.length})</h2>
                <p className="muted text-sm">L&apos;équipe d&apos;une agence mandatée accède avec son propre compte aux seuls événements que vous lui confiez, sans invitation ; l&apos;accès cesse à la fin du mandat.</p>
                {mandates.length > 0 && (
                  <ul className="plain stack-sm">
                    {mandates.map((m) => (
                      <li key={m.id} className="flex-between">
                        <span><strong>{m.agency.name}</strong> <span className="muted text-sm">· {m.agency._count.members} personne{m.agency._count.members > 1 ? "s" : ""} · depuis le {fmt(m.startsAt)}</span></span>
                        <span className="pill">Agence mandatée</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link className="link" href={`/organisations/${id}/prestataires?onglet=agences`}>Gérer les mandats</Link>
              </section>
            )}

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
              </>
            )}
          </>
        ) : (
          <>
            <VerificationCard orgId={id} canEdit={isAdmin} v={{ status: org.verification, siren: org.siren, legalName: org.legalName, note: org.verificationNote }} />
            <section className="card stack-sm" id="double-authentification">
              <h2 className="section-title"><ShieldCheck size={15} /> Double authentification</h2>
              {isAdmin ? (
                <OrgTwoFactorForm orgId={id} required={org.require2fa} adminReady={!!user.totpEnabledAt} missing={people.filter((p) => !p.user.totpEnabledAt).length} />
              ) : (
                <p className="muted">{org.require2fa ? "Exigée par l'organisation pour tous ses membres." : "Facultative : vous pouvez l'activer depuis « Mon compte »."}</p>
              )}
            </section>
            {!isSupplier && (
              <section className="card stack-sm" id="sous-traitance">
                <h2 className="section-title"><ShieldCheck size={15} /> Contrat de sous-traitance (RGPD)</h2>
                <p className="muted">
                  Votre organisation est responsable des données qu&apos;elle traite dans KolBase (experts, inscrits, conventions) ; l&apos;éditeur de KolBase agit comme sous-traitant.{" "}
                  <Link href="/sous-traitance" target="_blank">Lire le contrat (version {DPA_VERSION})</Link>
                </p>
                {motive && !dpaOk && <p className="notice warn">Pour {ENGAGING[motive]}, ce contrat doit d&apos;abord être accepté{isAdmin ? "" : " par un administrateur de l'organisation"}.</p>}
                {dpaOk ? (
                  <p className="pill ok">Accepté le {formatDate(org.dpaAcceptedAt!)}{dpaBy ? ` par ${dpaBy}` : ""}</p>
                ) : isAdmin ? (
                  <form action={acceptDpa} className="inline wrap">
                    <input type="hidden" name="orgId" value={id} />
                    {org.dpaVersion && <span className="text-sm warn-text">Le contrat a changé depuis la version {org.dpaVersion} acceptée.</span>}
                    <button className="btn small">Accepter au nom de {org.name}</button>
                  </form>
                ) : (
                  <p className="hint">À accepter par un administrateur de l&apos;organisation.</p>
                )}
                {resume && (
                  <div className="notice ok inline wrap" role="status">
                    <span>Contrat accepté : vous pouvez reprendre votre action.</span>
                    {resume.publish ? (
                      <form action={setEventFlag}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="eventId" value={resume.publish} />
                        <input type="hidden" name="flag" value="publish" />
                        <button className="btn small">{resume.label}</button>
                      </form>
                    ) : <Link className="btn small" href={resume.href}>{resume.label}</Link>}
                  </div>
                )}
              </section>
            )}
            {isAdmin ? (
              <>
                <EditOrgForm org={{ id: org.id, name: org.name, sector: org.sector, headquarters: org.headquarters, contactEmail: org.contactEmail, about: org.about, policy: org.policy, areas: org.areas }} />
                <LogoForm orgId={id} name={org.name} src={logoSrc(org)} verified={org.verification === "VERIFIED"} />
                {/* Le référencement d'un prestataire se règle avec sa fiche prestataire (page Demandes de devis). */}
                {!isSupplier && <OrgVisibilityForm orgId={id} v={companyVisibility(org.visibility)} listed={org.listed} />}
              </>
            ) : (
              <p className="muted">Seuls les administrateurs modifient la fiche, le logo et la page publique de l&apos;organisation.</p>
            )}
          </>
        )}
      </main>
    </>
  );
}
