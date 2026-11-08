import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, History, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { formatDate } from "@/lib/events";
import { roleLabel } from "@/lib/orgs";
import { displayStatus, STATUS_LABEL } from "@/lib/billing-plans";
import { auditLabel, auditTone } from "@/lib/admin-labels";
import { SectionHead } from "@/components/UI";
import { TableWrap } from "@/components/TableWrap";
import { AdminFrame, ADMIN_HOME } from "../../_parts/frame";
import { OrgCard } from "../../_parts/org-card";

export const metadata = { title: "Organisation — Administration KolBase" };
export const dynamic = "force-dynamic";

const time = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Fiche d'une organisation : contrôle et décision, membres, activité, abonnement, journal. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const o = await db.organization.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, email: true, firstName: true, lastName: true, totpEnabledAt: true, emailVerifiedAt: true, disabledAt: true } } }, orderBy: { createdAt: "asc" } },
      subscription: true,
      mandatesGiven: { include: { agency: { select: { id: true, name: true } } } },
      mandatesReceived: { include: { mandator: { select: { id: true, name: true } } } },
      _count: { select: { events: true, projects: true, openCalls: true, rfqs: true, quotes: true, serviceOrders: true } },
    },
  });
  if (!o) notFound();
  const [twins, published, sent, journal] = await Promise.all([
    o.siren ? db.organization.findMany({ where: { siren: o.siren, NOT: { id: o.id } }, select: { name: true, verification: true } }) : [],
    db.event.count({ where: { organizationId: o.id, publishedAt: { not: null } } }),
    db.rfq.count({ where: { organizationId: o.id, sentAt: { not: null } } }),
    db.auditLog.findMany({ where: { entityType: "Organization", entityId: o.id }, include: { actor: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  // Membres par personne (les rôles se cumulent).
  const people = new Map<string, { user: (typeof o.members)[number]["user"]; roles: string[]; since: Date }>();
  for (const m of o.members) {
    const p = people.get(m.userId) ?? { user: m.user, roles: [], since: m.createdAt };
    p.roles.push(roleLabel(m.role, o.kind));
    people.set(m.userId, p);
  }
  const admins = o.members.filter((m) => m.role === "ADMIN");
  const sub = displayStatus(o.subscription, new Date());
  const supplier = o.kind === "PRESTATAIRE";

  return (
    <AdminFrame
      title={o.name}
      desc={o.id.startsWith("demo-") ? "Organisation de démonstration (données fictives)." : undefined}
      crumbs={[ADMIN_HOME, { href: "/admin/organisations", label: "Organisations" }]}
      actions={o.listed && o.verification === "VERIFIED" ? <Link className="btn ghost small" href={`/structures/${o.id}`}>Page publique <ExternalLink size={14} aria-hidden /></Link> : undefined}
    >
      <OrgCard o={o} admins={admins} twins={twins} link={false} />

      <section className="card stack-sm" aria-labelledby="org-activite">
        <SectionHead icon={History} id="org-activite" title="Activité et abonnement" />
        <dl className="facts">
          {supplier ? (
            <>
              <dt>Devis envoyés</dt><dd>{o._count.quotes}</dd>
            </>
          ) : (
            <>
              <dt>Événements</dt><dd>{o._count.events} dont {published} publié{published > 1 ? "s" : ""}</dd>
              <dt>Dossiers</dt><dd>{o._count.projects}</dd>
              <dt>Opportunités</dt><dd>{o._count.openCalls}</dd>
              <dt>Demandes de devis</dt><dd>{sent} envoyée{sent > 1 ? "s" : ""}{o._count.rfqs > sent ? ` (+ ${o._count.rfqs - sent} brouillon${o._count.rfqs - sent > 1 ? "s" : ""})` : ""}</dd>
              <dt>Services KolBase</dt><dd>{o._count.serviceOrders} commande{o._count.serviceOrders > 1 ? "s" : ""}</dd>
            </>
          )}
          <dt>Abonnement</dt>
          <dd>
            {STATUS_LABEL[sub]}
            {o.subscription?.exemptUntil && sub === "offerte" ? ` jusqu'au ${formatDate(o.subscription.exemptUntil)}${o.subscription.exemptNote ? ` · ${o.subscription.exemptNote}` : ""}` : ""}
            {o.subscription?.currentPeriodEnd && ["active", "impayee"].includes(sub) ? ` · échéance ${formatDate(o.subscription.currentPeriodEnd)}` : ""}{" "}
            <Link href="/admin/abonnements" className="text-sm">Abonnements</Link>
          </dd>
          {o.mandatesGiven.length > 0 && (<><dt>Agences mandatées</dt><dd>{o.mandatesGiven.map((m) => <span key={m.id}><Link href={`/admin/organisations/${m.agency.id}`}>{m.agency.name}</Link>{m.endsAt && m.endsAt < new Date() ? " (terminé)" : ""} </span>)}</dd></>)}
          {o.mandatesReceived.length > 0 && (<><dt>Mandatée par</dt><dd>{o.mandatesReceived.map((m) => <span key={m.id}><Link href={`/admin/organisations/${m.mandator.id}`}>{m.mandator.name}</Link>{m.endsAt && m.endsAt < new Date() ? " (terminé)" : ""} </span>)}</dd></>)}
          <dt>Contrat de sous-traitance</dt><dd>{o.dpaAcceptedAt ? `accepté le ${formatDate(o.dpaAcceptedAt)} (version ${o.dpaVersion})` : supplier ? "sans objet" : "non accepté"}</dd>
          <dt>Double authentification</dt><dd>{o.require2fa ? "exigée de tous les membres" : "au choix de chaque membre"}</dd>
        </dl>
      </section>

      <section className="card stack-sm" aria-labelledby="org-membres">
        <SectionHead icon={Users} id="org-membres" title={`Membres (${people.size})`} />
        {people.size === 0 ? <p className="muted">Aucun membre.</p> : (
          <TableWrap label="Membres de l'organisation">
            <table className="table">
              <thead><tr><th>Personne</th><th>Rôles</th><th>Sécurité</th><th>Depuis</th></tr></thead>
              <tbody>
                {[...people.values()].map((p) => (
                  <tr key={p.user.id}>
                    <td data-label="Personne"><Link href={`/admin/comptes/${p.user.id}`}>{p.user.firstName} {p.user.lastName}</Link><div className="text-xs muted">{p.user.email}</div></td>
                    <td data-label="Rôles">{p.roles.join(", ")}</td>
                    <td data-label="Sécurité">
                      {p.user.disabledAt ? <span className="pill bad">Désactivé</span> : (
                        <>
                          <span className={`pill ${p.user.totpEnabledAt ? "ok" : o.require2fa ? "wait" : ""}`}>{p.user.totpEnabledAt ? "Double authentification" : "Mot de passe seul"}</span>
                          {!p.user.emailVerifiedAt && <div className="text-xs muted">adresse non confirmée</div>}
                        </>
                      )}
                    </td>
                    <td data-label="Depuis">{formatDate(p.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="org-journal">
        <SectionHead icon={History} id="org-journal" title="Journal de l'organisation">
          <Link href={`/admin/journal?objet=${o.id}`} className="btn ghost small">Tout son journal</Link>
        </SectionHead>
        {journal.length === 0 ? <p className="muted">Aucune entrée.</p> : (
          <ul className="journal-list">
            {journal.map((e) => (
              <li key={e.id}>
                <span className="text-xs muted mono">{time(e.createdAt)}</span>
                <span><span className={`pill ${auditTone(e.action)}`}>{auditLabel(e.action)}</span>{e.data && typeof e.data === "object" && "note" in e.data && e.data.note ? <span className="text-xs muted"> « {String(e.data.note)} »</span> : null}</span>
                <span className="text-sm">{e.actor ? <Link href={`/admin/comptes/${e.actor.id}`}>{e.actor.firstName} {e.actor.lastName}</Link> : <span className="muted">Système</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminFrame>
  );
}
