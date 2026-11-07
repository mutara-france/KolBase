import { SectionHead, PageHead } from "@/components/UI";
import { SiteHeader } from "@/components/SiteHeader";
import { EditOrgForm, InviteForm, LogoForm, MemberRolesForm, VerificationCard } from "@/components/OrgForms";
import { Avatar } from "@/components/Avatar";
import type { OrgRole } from "@/generated/prisma/client";
import { logoSrc } from "@/lib/logos";
import { db } from "@/lib/db";
import { invitableRoles, requireMembership, roleLabel } from "@/lib/orgs";
import { rnaAccepted, ROLE_DESC } from "@/lib/org-roles";
import { acceptDpa, revokeInvitation } from "@/lib/org-actions";
import { setEventFlag } from "@/lib/event-actions";
import { asMotive, asObjectId, ENGAGING, resumeAction } from "@/lib/billing-plans";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OrgVisibilityForm } from "@/components/ProfileForms";
import { DPA_VERSION } from "@/lib/dpa";
import { Building2, MailPlus, ShieldCheck, Users } from "lucide-react";
import { companyVisibility } from "@/lib/visibility";
import { OrgTwoFactorForm } from "@/components/TwoFactorForms";
import { TableWrap } from "@/components/TableWrap";
import { getT } from "@/lib/i18n/server";
import { fmtDate } from "@/lib/i18n";
import { accountPhoto, expertPhotoSrc } from "@/lib/expert-photo";
import { kolViewer } from "@/lib/visibility";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Membres et réglages")} — KolBase` };
}


export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ onglet?: string; motif?: string; objet?: string }> }) {
  const { t, locale } = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const onglet = sp.onglet === "organisation" ? "organisation" : "equipe";
  const { org, roles, isAdmin, user } = await requireMembership(id);
  const dpaBy = org.dpaAcceptedById ? await db.user.findUnique({ where: { id: org.dpaAcceptedById }, select: { firstName: true, lastName: true } }).then((u) => (u ? `${u.firstName} ${u.lastName}` : null)) : null;
  // Un prestataire mandaté (externe) ne voit pas l'équipe ni les réglages de l'organisation.
  if (roles.every((r) => r === "PRESTATAIRE")) redirect(`/organisations/${id}`);
  const [members, invitations, mandates] = await Promise.all([
    db.membership.findMany({ where: { organizationId: id }, include: { user: { include: { practitioner: { select: { id: true, photoUpdatedAt: true, visibility: true, listed: true } } } } }, orderBy: { createdAt: "asc" } }),
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
  const roleOpts = invitableRoles(org.kind).map((value) => ({ value, label: t(roleLabel(value, org.kind)), desc: t(org.kind === "PRESTATAIRE" ? (value === "ADMIN" ? "Équipe, fiche prestataire et devis." : "Répond aux demandes de devis.") : ROLE_DESC[value]) }));
  // Une ligne par personne, avec l'ensemble de ses rôles.
  const people = [...members.reduce((acc, m) => {
    const p = acc.get(m.userId) ?? { userId: m.userId, user: m.user, roles: [] as OrgRole[], since: m.createdAt };
    p.roles.push(m.role);
    if (m.createdAt < p.since) p.since = m.createdAt;
    return acc.set(m.userId, p);
  }, new Map<string, { userId: string; user: (typeof members)[number]["user"]; roles: OrgRole[]; since: Date }>()).values()];
  // Photo d'un membre : la sienne toujours ; celle d'un collègue praticien selon son réglage « Photo » (expert référencé).
  const memberPhoto = (u: (typeof members)[number]["user"]) => {
    if (u.id === user.id || !u.practitioner) return accountPhoto(u);
    return u.practitioner.listed ? expertPhotoSrc(u.practitioner, kolViewer(user, u.practitioner.id)) : null;
  };
  const adminCount = people.filter((p) => p.roles.includes("ADMIN")).length;
  const isSupplier = org.kind === "PRESTATAIRE";
  // Arrivée depuis une action refusée faute de contrat : rappel du motif, puis reprise de l'action une fois accepté.
  const motive = asMotive(sp.motif);
  const dpaOk = org.dpaVersion === DPA_VERSION && !!org.dpaAcceptedAt;
  const resume = motive && dpaOk ? resumeAction(id, motive, asObjectId(sp.objet)) : null;

  const tabs = [["equipe", t("Équipe ({n})", { n: people.length })], ["organisation", t("Organisation")]] as const;
  return (
    <>
      <SiteHeader />
      <main className="stack">
        <div>
          <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / {t("Membres et réglages")}</p>
          <PageHead title={t("Membres et réglages")} desc={t("L'équipe, ses rôles et les réglages de l'organisation.")} />
        </div>
        <nav className="tabs" aria-label={t("Membres et réglages")}>
          {tabs.map(([k, l]) => <Link key={k} href={`?onglet=${k}`} className={k === onglet ? "active" : ""}>{l}</Link>)}
        </nav>

        {onglet === "equipe" ? (
          <>
            <section className="card">
              <SectionHead icon={Users} title={t("Membres ({people})", { people: people.length })} />
              {isAdmin && (
                <ul className="role-legend">
                  {roleOpts.map((r) => <li key={r.value}><strong>{r.label}</strong> : {r.desc}</li>)}
                </ul>
              )}
              {isAdmin && <p className="hint">{t("Cochez ou décochez un rôle : la modification est enregistrée aussitôt.")}</p>}
              {!isSupplier && !people.some((p) => p.roles.includes("CONFORMITE")) && (
                <p className="notice warn" id="sans-conformite">{t("Personne n'a le rôle Conformité : les dossiers soumis ne pourront pas être validés. Cochez ce rôle pour un membre, vous-même au besoin.")}</p>
              )}
              <ul className="member-list">
                {people.map((p) => (
                  <li key={p.userId} className="member-row">
                    <Avatar name={`${p.user.firstName} ${p.user.lastName}`} size={40} photo={memberPhoto(p.user)} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <strong>{p.user.firstName} {p.user.lastName}</strong>{p.userId === user.id && <span className="muted">{" "}{t("(vous)")}</span>}
                      <div className="text-xs muted">{t("{email} · membre depuis le {v}", { email: p.user.email, v: fmtDate(locale, p.since) })}{isAdmin ? (p.user.totpEnabledAt ? t(" · double authentification activée") : t(" · sans double authentification")) : ""}</div>
                      {isAdmin ? (
                        <MemberRolesForm orgId={id} userId={p.userId} roles={p.roles} options={roleOpts} canRemove={!(p.roles.includes("ADMIN") && adminCount <= 1)} />
                      ) : (
                        <div className="role-chips mt-1">{p.roles.map((r) => <span key={r} className="pill">{t(roleLabel(r, org.kind))}</span>)}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {!isSupplier && (
              <section className="card stack-sm">
                <SectionHead icon={Building2} title={t("Agences mandatées ({mandates})", { mandates: mandates.length })} desc={t("L'équipe d'une agence mandatée accède avec son propre compte aux seuls événements que vous lui confiez, sans invitation ; l'accès cesse à la fin du mandat.")} />
                {mandates.length > 0 && (
                  <ul className="plain stack-sm">
                    {mandates.map((m) => (
                      <li key={m.id} className="flex-between">
                        <span><strong>{m.agency.name}</strong> <span className="muted text-sm">{t(m.agency._count.members > 1 ? "· {members} personnes · depuis le {v}" : "· {members} personne · depuis le {v}", { members: m.agency._count.members, v: fmtDate(locale, m.startsAt) })}</span></span>
                        <span className="pill">{t("Agence mandatée")}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link className="link" href={`/organisations/${id}/prestataires?onglet=agences`}>{t("Gérer les mandats")}</Link>
              </section>
            )}

            {isAdmin && (
              <>
                <InviteForm orgId={id} roles={roleOpts} />
                {invitations.length > 0 && (
                  <section className="card">
                    <SectionHead icon={MailPlus} title={t("Invitations en attente")} />
                    <TableWrap label={t("Invitations en attente")}>
                      <table className="table">
                        <thead><tr><th>{t("Rôle")}</th><th>{t("Mémo")}</th><th>{t("Expire le")}</th><th /></tr></thead>
                        <tbody>
                          {invitations.map((i) => (
                            <tr key={i.id}>
                              <td data-label="Rôle">{t(roleLabel(i.role, org.kind))}</td>
                              <td data-label="Mémo">{i.email ?? "—"}</td>
                              <td data-label="Expire le">{fmtDate(locale, i.expiresAt)}</td>
                              <td>
                                <form action={revokeInvitation}>
                                  <input type="hidden" name="orgId" value={id} />
                                  <input type="hidden" name="invitationId" value={i.id} />
                                  <button className="link danger">{t("Révoquer")}</button>
                                </form>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  </section>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <VerificationCard
              orgId={id}
              canEdit={isAdmin}
              v={{
                status: org.verification, siren: org.siren, legalName: org.legalName, note: org.verificationNote, rna: org.rna, rnaAccepted: rnaAccepted(org.kind), supplier: org.kind === "PRESTATAIRE",
                requestedAt: org.verification === "PENDING" && org.verificationRequestedAt ? fmtDate(locale, org.verificationRequestedAt) : null,
              }}
            />
            <section className="card stack-sm" id="double-authentification">
              <SectionHead icon={ShieldCheck} title={t("Double authentification")} />
              {isAdmin ? (
                <OrgTwoFactorForm orgId={id} required={org.require2fa} adminReady={!!user.totpEnabledAt} missing={people.filter((p) => !p.user.totpEnabledAt).length} />
              ) : (
                <p className="muted">{org.require2fa ? t("Exigée par l'organisation pour tous ses membres.") : t("Facultative : vous pouvez l'activer depuis « Mon compte ».")}</p>
              )}
            </section>
            {!isSupplier && (
              <section className="card stack-sm" id="sous-traitance">
                <SectionHead icon={ShieldCheck} title={t("Contrat de sous-traitance (RGPD)")} />
                <p className="muted">
                  {t("Votre organisation est responsable des données qu'elle traite dans KolBase (experts, inscrits, conventions) ; l'éditeur de KolBase agit comme sous-traitant.")}
                  <Link href="/sous-traitance" target="_blank">{t("Lire le contrat (version {DPA_VERSION})", { DPA_VERSION })}</Link>
                </p>
                {motive && !dpaOk && <p className="notice warn">{t("Pour {motive}, ce contrat doit d'abord être accepté", { motive: t(ENGAGING[motive]) })}{isAdmin ? "" : t(" par un administrateur de l'organisation")}.</p>}
                {dpaOk ? (
                  <p className="pill ok">{t("Accepté le {date}", { date: fmtDate(locale, org.dpaAcceptedAt!) })}{dpaBy ? ` ${t("par {dpaBy}", { dpaBy })}` : ""}</p>
                ) : isAdmin ? (
                  <form action={acceptDpa} className="inline wrap">
                    <input type="hidden" name="orgId" value={id} />
                    {org.dpaVersion && <span className="text-sm warn-text">{t("Le contrat a changé depuis la version {dpaVersion} acceptée.", { dpaVersion: org.dpaVersion })}</span>}
                    <button className="btn small">{t("Accepter au nom de {name}", { name: org.name })}</button>
                  </form>
                ) : (
                  <p className="hint">{t("À accepter par un administrateur de l'organisation.")}</p>
                )}
                {resume && (
                  <div className="notice ok inline wrap" role="status">
                    <span>{t("Contrat accepté : vous pouvez reprendre votre action.")}</span>
                    {resume.publish ? (
                      <form action={setEventFlag}>
                        <input type="hidden" name="orgId" value={id} />
                        <input type="hidden" name="eventId" value={resume.publish} />
                        <input type="hidden" name="flag" value="publish" />
                        <button className="btn small">{t(resume.label)}</button>
                      </form>
                    ) : <Link className="btn small" href={resume.href}>{t(resume.label)}</Link>}
                  </div>
                )}
              </section>
            )}
            {isAdmin ? (
              <>
                <EditOrgForm supplier={isSupplier} org={{ id: org.id, name: org.name, sector: org.sector, headquarters: org.headquarters, contactEmail: org.contactEmail, about: org.about, policy: org.policy, areas: org.areas }} />
                <LogoForm supplier={isSupplier} orgId={id} name={org.name} src={logoSrc(org)} verified={org.verification === "VERIFIED"} />
                {/* Le référencement d'un prestataire se règle avec sa fiche prestataire (page Demandes de devis). */}
                {!isSupplier && <OrgVisibilityForm orgId={id} v={companyVisibility(org.visibility)} listed={org.listed} />}
              </>
            ) : (
              <p className="muted">{t("Seuls les administrateurs modifient la fiche, le logo et la page publique de l'organisation.")}</p>
            )}
          </>
        )}
      </main>
    </>
  );
}
