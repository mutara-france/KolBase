import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, BadgeCheck, Building2, CalendarDays, CircleCheck, Folder, Megaphone, Receipt, ScrollText, Ticket, Users, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/platform";
import { formatEUR } from "@/lib/events";
import { adminCounts, dashboardFigures, launchItems, tasksState } from "@/lib/admin-data";
import { auditLabel, auditTone } from "@/lib/admin-labels";
import { SectionHead, StateTile } from "@/components/UI";
import { AdminFrame } from "./_parts/frame";

export const metadata = { title: "Administration — KolBase" };
export const dynamic = "force-dynamic";

/** Anciennes adresses à onglets (liens des e-mails, favoris) : chaque onglet a désormais sa page. */
const LEGACY: Record<string, string> = {
  organisations: "/admin/organisations",
  praticiens: "/admin/identites",
  services: "/admin/services",
  abonnements: "/admin/abonnements",
  actualites: "/admin/actualites",
  lancement: "/admin/exploitation#lancement",
};

const nf = new Intl.NumberFormat("fr-FR");
const time = (d: Date) => d.toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Tableau de bord de l'administration : ce qui attend une décision, l'activité des 30 derniers jours, le journal récent. */
export default async function Page({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  await requirePlatformAdmin();
  const { onglet } = await searchParams;
  if (onglet && LEGACY[onglet]) redirect(LEGACY[onglet]);

  const tasks = await tasksState();
  const [counts, f, launch, toInvoice, recentPhotos, recent] = await Promise.all([
    adminCounts(),
    dashboardFigures(),
    launchItems(tasks),
    db.serviceOrder.count({ where: { status: "realisee", invoicedAt: null, priceCents: { gt: 0 } } }),
    db.practitionerProfile.count({ where: { photoUpdatedAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
    db.auditLog.findMany({ include: { actor: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const launchLeft = launch.filter((i) => !i.ok && !i.optional).length;

  const todo = [
    { n: counts.orgs, href: "/admin/organisations?statut=a-valider", label: counts.orgs > 1 ? "organisations à valider" : "organisation à valider", icon: Building2 },
    { n: counts.identities, href: "/admin/identites", label: counts.identities > 1 ? "identités à vérifier" : "identité à vérifier", icon: BadgeCheck },
    { n: counts.services, href: "/admin/services", label: counts.services > 1 ? "services commandés à traiter" : "service commandé à traiter", icon: Megaphone },
    { n: toInvoice, href: "/admin/services", label: toInvoice > 1 ? "services réalisés à facturer hors Stripe" : "service réalisé à facturer hors Stripe", icon: Receipt },
    { n: recentPhotos, href: "/admin/identites#photos", label: recentPhotos > 1 ? "photos de praticiens publiées cette semaine, à contrôler" : "photo de praticien publiée cette semaine, à contrôler", icon: Users },
    { n: f.unpaid, href: "/admin/abonnements", label: f.unpaid > 1 ? "abonnements impayés" : "abonnement impayé", icon: Wallet },
    { n: launchLeft, href: "/admin/exploitation#lancement", label: launchLeft > 1 ? "prérequis d'ouverture encore à faire" : "prérequis d'ouverture encore à faire", icon: Activity },
  ].filter((x) => x.n > 0);

  return (
    <AdminFrame title="Administration KolBase" desc="Décisions en attente, activité de la plateforme et journal.">
      <section className="card stack-sm" aria-labelledby="a-traiter">
        <SectionHead icon={CircleCheck} id="a-traiter" title="À traiter" desc={todo.length ? "Par ordre d'urgence : chaque ligne mène à la page où décider." : undefined} tone={todo.length ? "warn" : "ok"} />
        {todo.length === 0 && !(tasks && !tasks.ok) ? (
          <p className="muted">Rien à traiter.</p>
        ) : (
          <ul className="admin-todo">
            {tasks && !tasks.ok && (
              <li>
                <Link href="/admin/exploitation#taches" className="admin-todo-row bad">
                  <Activity size={18} aria-hidden /><strong>!</strong><span>Tâches planifiées arrêtées ou en échec</span>
                </Link>
              </li>
            )}
            {todo.map((x) => (
              <li key={x.label}>
                <Link href={x.href} className="admin-todo-row">
                  <x.icon size={18} aria-hidden /><strong>{x.n}</strong><span>{x.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack-sm" aria-labelledby="activite">
        <SectionHead
          icon={Activity}
          id="activite"
          title="Activité"
          desc={<>30 derniers jours, hors données de démonstration{f.demoOrgs || f.demoUsers ? ` (${f.demoOrgs} organisations et ${f.demoUsers} comptes fictifs exclus)` : ""}.</>}
        />
        <div className="state-grid">
          <StateTile href="/admin/comptes?origine=reels" icon={Users} label="Comptes" value={nf.format(f.users)} detail={`+${nf.format(f.newUsers)} en 30 jours`} />
          <StateTile href="/admin/comptes?origine=reels&profil=expert" icon={BadgeCheck} label="Experts référencés" value={nf.format(f.experts)} detail={`+${nf.format(f.newExperts)} en 30 jours`} />
          <StateTile href="/admin/organisations?origine=reelles&statut=validees" icon={Building2} label="Organisations validées" value={nf.format(f.orgs)} detail={`dont ${nf.format(f.suppliers)} prestataire${f.suppliers > 1 ? "s" : ""}`} />
          <StateTile href="/evenements" icon={CalendarDays} label="Événements à venir" value={nf.format(f.upcoming)} detail="publiés, non annulés" />
          <StateTile href="/admin/journal?domaine=evenements" icon={Ticket} label="Inscriptions" value={nf.format(f.registrations)} detail="en 30 jours" />
          <StateTile href="/admin/journal?domaine=dossiers" icon={Folder} label="Dossiers ouverts" value={nf.format(f.projects)} detail="en 30 jours" />
          <StateTile href="/admin/journal?domaine=prestataires" icon={Receipt} label="Demandes de devis" value={nf.format(f.rfqs)} detail="envoyées en 30 jours" />
          <StateTile href="/admin/services" icon={Megaphone} label="Services commandés" value={nf.format(f.services)} detail="en 30 jours" />
          <StateTile href="/admin/abonnements" icon={Wallet} label="Abonnements payants" value={nf.format(f.paying)} detail={`${formatEUR(f.mrr)} HT par mois, hors essais`} tone={f.unpaid ? "warn" : "neutral"} />
        </div>
      </section>

      <section className="card stack-sm" aria-labelledby="journal-recent">
        <SectionHead icon={ScrollText} id="journal-recent" title="Journal récent">
          <Link href="/admin/journal" className="btn ghost small">Tout le journal</Link>
        </SectionHead>
        {recent.length === 0 ? <p className="muted">Aucune activité enregistrée.</p> : (
          <ul className="journal-list">
            {recent.map((e) => (
              <li key={e.id}>
                <span className="text-xs muted mono">{time(e.createdAt)}</span>
                <span><span className={`pill ${auditTone(e.action)}`}>{auditLabel(e.action)}</span></span>
                <span className="text-sm">{e.actor ? <Link href={`/admin/comptes/${e.actor.id}`}>{e.actor.firstName} {e.actor.lastName}</Link> : <span className="muted">Système</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminFrame>
  );
}
