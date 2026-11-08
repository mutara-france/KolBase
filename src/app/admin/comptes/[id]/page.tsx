import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, ExternalLink, History, KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { platformAdminEmails, requirePlatformAdmin } from "@/lib/platform";
import { formatDate } from "@/lib/events";
import { roleLabel } from "@/lib/orgs";
import { mailEnabled } from "@/lib/mail";
import { country, practicesInFrance } from "@/lib/countries";
import { DEMO_EMAIL_DOMAIN } from "@/lib/demo";
import { auditLabel, auditTone, ENTITY_LABELS, entityHref } from "@/lib/admin-labels";
import { resendAccountVerification, resetAccountTwoFactor, setAccountDisabled } from "@/lib/admin-account-actions";
import { SectionHead } from "@/components/UI";
import { ConfirmButton } from "@/components/ConfirmButton";
import { AdminFrame, ADMIN_HOME } from "../../_parts/frame";
import { EMAIL_LOG_DAYS, EMAIL_STATUS } from "@/lib/email-log";
import type { OrgKind } from "@/generated/prisma/client";

export const metadata = { title: "Compte — Administration KolBase" };
export const dynamic = "force-dynamic";

const time = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const DONE: Record<string, string> = {
  lien: "Lien de confirmation envoyé.",
  "sans-envoi": "L'envoi d'e-mails n'est pas configuré : aucun lien n'est parti (voir Exploitation).",
  "2fa": "Double authentification réinitialisée ; ses sessions sont fermées et la personne est prévenue par e-mail.",
  desactive: "Compte désactivé ; ses sessions sont fermées et la personne est prévenue par e-mail.",
  reactive: "Compte réactivé ; la personne est prévenue par e-mail.",
};

/** Fiche d'un compte : identité, sécurité, profil praticien, organisations, actions de l'équipe KolBase et journal. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fait?: string }> }) {
  const admin = await requirePlatformAdmin();
  const { id } = await params;
  const { fait } = await searchParams;
  const u = await db.user.findUnique({
    where: { id },
    include: {
      practitioner: true,
      memberships: { include: { organization: { select: { id: true, name: true, kind: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  // Compte anonymisé après suppression : plus de fiche.
  if (!u || u.email.endsWith("@kolbase.invalid")) notFound();
  const now = new Date();
  const [sessions, lastSession, journal, soleAdmin] = await Promise.all([
    db.session.count({ where: { userId: u.id, expiresAt: { gt: now } } }),
    db.session.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, userAgent: true } }),
    db.auditLog.findMany({
      where: { OR: [{ actorId: u.id }, { entityType: "User", entityId: u.id }, ...(u.practitioner ? [{ entityType: "PractitionerProfile", entityId: u.practitioner.id }] : [])] },
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    // Organisations dont la personne est le seul administrateur : à signaler avant une désactivation.
    Promise.all(
      u.memberships.filter((m) => m.role === "ADMIN").map(async (m) => ((await db.membership.count({ where: { organizationId: m.organizationId, role: "ADMIN" } })) === 1 ? m.organization.name : null)),
    ).then((l) => l.filter((x): x is string => !!x)),
  ]);
  const emails = await db.emailLog.findMany({ where: { to: u.email.toLowerCase() }, orderBy: { createdAt: "desc" }, take: 20 });
  const orgs = new Map<string, { org: { id: string; name: string; kind: OrgKind }; roles: string[] }>();
  for (const m of u.memberships) {
    const o = orgs.get(m.organizationId) ?? { org: m.organization, roles: [] };
    o.roles.push(roleLabel(m.role, m.organization.kind));
    orgs.set(m.organizationId, o);
  }
  const self = u.id === admin.id;
  const kolbaseAdmin = platformAdminEmails().includes(u.email.toLowerCase());
  const p = u.practitioner;
  const name = `${u.firstName} ${u.lastName}`;
  const fr = p ? practicesInFrance(p.country) : true;
  const identifier = p ? (fr ? p.rpps : p.licenseNumber) : null;

  return (
    <AdminFrame
      title={name}
      desc={<>{u.email}{u.email.endsWith(DEMO_EMAIL_DOMAIN) ? " · compte de démonstration" : ""}{kolbaseAdmin ? " · administrateur KolBase" : ""}</>}
      crumbs={[ADMIN_HOME, { href: "/admin/comptes", label: "Comptes" }]}
      actions={p?.listed ? <Link className="btn ghost small" href={`/experts/${p.id}`}>Fiche publique <ExternalLink size={14} aria-hidden /></Link> : undefined}
    >
      {fait && DONE[fait] && <p className={`notice ${fait === "sans-envoi" ? "warn" : "ok"}`} role="status">{DONE[fait]}</p>}
      {u.disabledAt && <p className="notice warn">Compte désactivé le {formatDate(u.disabledAt)}{u.disabledNote ? ` : ${u.disabledNote}` : ""}. Connexion refusée, liens reçus par e-mail inutilisables.</p>}

      <section className="card stack-sm" aria-labelledby="compte-securite">
        <SectionHead icon={ShieldCheck} id="compte-securite" title="Identité et sécurité" />
        <dl className="facts">
          <dt>Adresse e-mail</dt>
          <dd>{u.email} · {u.emailVerifiedAt ? `confirmée le ${formatDate(u.emailVerifiedAt)}` : <span className="pill wait">non confirmée</span>}</dd>
          <dt>Inscription</dt><dd>{formatDate(u.createdAt)}</dd>
          <dt>Dernière connexion</dt><dd>{lastSession ? time(lastSession.createdAt) : "—"}</dd>
          <dt>Sessions ouvertes</dt><dd>{sessions}</dd>
          <dt>Double authentification</dt>
          <dd>{u.totpEnabledAt ? `activée le ${formatDate(u.totpEnabledAt)} · ${u.recoveryCodes.length} code${u.recoveryCodes.length > 1 ? "s" : ""} de secours restant${u.recoveryCodes.length > 1 ? "s" : ""}` : "non activée"}</dd>
          <dt>Langue</dt><dd>{u.locale === "en" ? "anglais" : "français"}</dd>
          {u.phone && (<><dt>Téléphone</dt><dd>{u.phone}</dd></>)}
        </dl>
      </section>

      {/* Derniers e-mails envoyés à ce compte (journal, sans le contenu) : assistance « je n'ai rien reçu ». */}
      <section className="card stack-sm" aria-labelledby="compte-emails">
        <SectionHead icon={Mail} id="compte-emails" title="Derniers e-mails" desc={`Journal des ${EMAIL_LOG_DAYS} derniers jours, sans le contenu.`}>
          <Link className="btn ghost small" href={`/admin/emails?q=${encodeURIComponent(u.email)}`}>Tout l&apos;historique</Link>
        </SectionHead>
        {emails.length === 0 ? <p className="muted text-sm">Aucun e-mail envoyé à cette adresse.</p> : (
          <ul className="plain stack-xs text-sm">
            {emails.map((m) => <li key={m.id} className="flex-between"><span>{m.subject}</span><span className="muted nowrap">{time(m.createdAt)} · <span className={`pill ${EMAIL_STATUS[m.status]?.tone ?? ""}`}>{EMAIL_STATUS[m.status]?.label ?? m.status}</span></span></li>)}
          </ul>
        )}
      </section>

      {p && (
        <section className="card stack-sm" aria-labelledby="compte-praticien">
          <SectionHead icon={UserRound} id="compte-praticien" title="Profil praticien" />
          <dl className="facts">
            <dt>Profession</dt><dd>{p.profession}{p.specialty ? ` · ${p.specialty}` : ""}</dd>
            <dt>Exercice</dt><dd>{[p.city, country(p.country).name].filter(Boolean).join(" · ")}</dd>
            <dt>{fr ? "RPPS" : "Identifiant"}</dt>
            <dd>
              {identifier ? <span className="mono">{identifier}</span> : "non renseigné"}
              {identifier && <> · {p.rppsVerified ? <span className="pill ok">identité vérifiée</span> : p.rppsCheckedAt ? <span className="pill bad">refusée{p.rppsCheckNote ? ` : ${p.rppsCheckNote}` : ""}</span> : <Link href="/admin/identites" className="pill wait">à vérifier</Link>}</>}
            </dd>
            <dt>Référencement</dt><dd>{p.listed ? <Link href={`/experts/${p.id}`}>expert référencé, fiche publique</Link> : "non référencé"}</dd>
          </dl>
        </section>
      )}

      <section className="card stack-sm" aria-labelledby="compte-orgs">
        <SectionHead icon={Building2} id="compte-orgs" title={`Organisations (${orgs.size})`} />
        {orgs.size === 0 ? <p className="muted">Membre d&apos;aucune organisation.</p> : (
          <ul className="pub-list">
            {[...orgs.values()].map((o) => (
              <li key={o.org.id}>
                <strong><Link href={`/admin/organisations/${o.org.id}`}>{o.org.name}</Link></strong>
                <span className="text-xs">{o.roles.join(", ")}{soleAdmin.includes(o.org.name) ? " · seul administrateur" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="compte-actions">
        <SectionHead icon={KeyRound} id="compte-actions" title="Actions de l'équipe KolBase" desc="Chaque action est inscrite au journal d'activité." />
        {self ? (
          <p className="muted">Votre propre compte se gère depuis <Link href="/compte">Mon compte</Link>.</p>
        ) : (
          <div className="stack-sm">
            {!u.emailVerifiedAt && !u.disabledAt && (
              <form action={resendAccountVerification} className="inline wrap">
                <input type="hidden" name="userId" value={u.id} />
                <button className="btn small secondary" disabled={!mailEnabled()}>Renvoyer le lien de confirmation</button>
                <span className="hint">{mailEnabled() ? `Un nouveau lien, valable 7 jours, part à ${u.email}.` : "Envoi d'e-mails non configuré : aucun lien ne peut partir (voir Exploitation)."}</span>
              </form>
            )}
            {u.totpEnabledAt && (
              <form action={resetAccountTwoFactor} className="inline wrap">
                <input type="hidden" name="userId" value={u.id} />
                <input name="note" required maxLength={300} placeholder="Motif (obligatoire, envoyé à la personne)" aria-label="Motif de la réinitialisation" style={{ minWidth: "min(280px, 100%)" }} />
                <ConfirmButton className="btn small ghost" confirm={`réinitialiser la double authentification de ${name}`} summary={<>Son application d&apos;authentification et ses codes de secours ne servent plus ; ses sessions sont fermées. La personne se reconnecte avec son mot de passe et réactive la double authentification ; elle est prévenue par e-mail, avec le motif.</>}>
                  Réinitialiser la double authentification
                </ConfirmButton>
              </form>
            )}
            {u.disabledAt ? (
              <form action={setAccountDisabled} className="inline wrap">
                <input type="hidden" name="userId" value={u.id} />
                <input name="note" maxLength={300} placeholder="Note (facultatif, pour le journal)" aria-label="Note de réactivation" />
                <button className="btn small" name="decision" value="enable">Réactiver le compte</button>
              </form>
            ) : kolbaseAdmin ? (
              <p className="hint">Administrateur KolBase : le retirer d&apos;abord de PLATFORM_ADMIN_EMAILS pour pouvoir désactiver son compte.</p>
            ) : (
              <form action={setAccountDisabled} className="inline wrap">
                <input type="hidden" name="userId" value={u.id} />
                <input name="note" required maxLength={300} placeholder="Motif de la désactivation (obligatoire, envoyé à la personne)" aria-label="Motif de la désactivation" style={{ minWidth: "min(320px, 100%)" }} />
                <ConfirmButton
                  className="btn small ghost"
                  name="decision"
                  value="disable"
                  confirm={`désactiver le compte de ${name}`}
                  summary={
                    <>
                      Connexion refusée, sessions fermées, liens reçus par e-mail inutilisables ; rien n&apos;est supprimé et « Réactiver » rend l&apos;accès.
                      {p?.listed ? " Sa fiche d'expert est retirée de l'annuaire public ; la personne la republiera après réactivation." : ""}
                      {soleAdmin.length ? ` Seul administrateur de ${soleAdmin.join(", ")} : personne d'autre ne pourra y gérer l'équipe.` : ""}
                      {" "}La personne est prévenue par e-mail, avec le motif.
                    </>
                  }
                >
                  Désactiver le compte
                </ConfirmButton>
              </form>
            )}
          </div>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="compte-journal">
        <SectionHead icon={History} id="compte-journal" title="Journal du compte" desc="Ses actions, et celles qui le concernent.">
          <Link href={`/admin/journal?acteur=${u.id}`} className="btn ghost small">Toutes ses actions</Link>
        </SectionHead>
        {journal.length === 0 ? <p className="muted">Aucune entrée.</p> : (
          <ul className="journal-list">
            {journal.map((e) => {
              const href = entityHref(e.entityType, e.entityId);
              return (
                <li key={e.id}>
                  <span className="text-xs muted mono">{time(e.createdAt)}</span>
                  <span>
                    <span className={`pill ${auditTone(e.action)}`}>{auditLabel(e.action)}</span>
                    {e.entityType !== "User" && <span className="text-xs muted"> · {href ? <Link href={href}>{ENTITY_LABELS[e.entityType] ?? e.entityType}</Link> : ENTITY_LABELS[e.entityType] ?? e.entityType}</span>}
                    {e.data && typeof e.data === "object" && "note" in e.data && e.data.note ? <span className="text-xs muted"> « {String(e.data.note)} »</span> : null}
                  </span>
                  <span className="text-sm">{e.actor ? (e.actor.id === u.id ? null : <Link href={`/admin/comptes/${e.actor.id}`}>{e.actor.firstName} {e.actor.lastName}</Link>) : <span className="muted">Système</span>}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminFrame>
  );
}
