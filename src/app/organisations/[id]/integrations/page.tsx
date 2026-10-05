import Link from "next/link";
import { CalendarDays, FileSignature, FileSpreadsheet, Info, Link2, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";

export const metadata = { title: "Intégrations — Kolbase" };

type Integration = { name: string; icon: typeof Link2; status: "actif" | "export" | "a-configurer"; detail: string; scope: string; action?: { href: string; label: string; download?: boolean } };
const STATUS = { actif: { label: "Actif", tone: "ok" }, export: { label: "Par export", tone: "electric" }, "a-configurer": { label: "À configurer", tone: "done" } } as const;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { org, roles } = await requireMembership(id, ["ADMIN", "EDUCATION", "CUMUL", "CONFORMITE"]);
  const isCompliance = roles.some((r) => COMPLIANCE_ROLES.includes(r));
  const orcidExperts = await db.practitionerProfile.count({ where: { listed: true, orcidSyncedAt: { not: null } } });

  const items: Integration[] = [
    {
      name: "Agenda (iCalendar)", icon: CalendarDays, status: "actif",
      detail: "Vos événements s'importent dans Outlook, Google Agenda ou Apple Calendrier. Chaque fiche d'événement propose aussi « Ajouter à mon agenda » aux inscrits.",
      scope: "Événements de l'organisation (90 derniers jours et à venir)",
      action: { href: `/organisations/${id}/evenements/calendrier`, label: "Télécharger le calendrier (.ics)", download: true },
    },
    {
      name: "ORCID", icon: Users, status: "actif",
      detail: `Les experts importent leurs publications depuis leur profil ORCID public, ce qui alimente les fiches de l'annuaire. ${orcidExperts} expert${orcidExperts > 1 ? "s ont" : " a"} déjà synchronisé ${orcidExperts > 1 ? "leur" : "son"} profil.`,
      scope: "Publications des experts (lecture seule, API publique)",
    },
    {
      name: "Transparence Santé", icon: FileSpreadsheet, status: "export",
      detail: "Kolbase prépare les fichiers de déclaration (conventions, rémunérations, hospitalités). Le dépôt se fait ensuite sur la plateforme publique Transparence Santé.",
      scope: "Registre des conventions et hospitalités",
      action: isCompliance ? { href: `/organisations/${id}/conformite?onglet=transparence`, label: "Ouvrir l'espace conformité" } : undefined,
    },
    {
      name: "Signature électronique", icon: FileSignature, status: "a-configurer",
      detail: "Envoi des conventions en signature (Yousign, DocuSign…) et retour automatique du statut « signé » dans le dossier. Nécessite un compte chez le prestataire de signature et sa clé d'API.",
      scope: "Conventions de collaboration et d'hospitalité",
    },
    {
      name: "CRM (Veeva, Salesforce…)", icon: Link2, status: "a-configurer",
      detail: "Synchronisation des experts et des interactions avec votre CRM. Nécessite un accès API fourni par votre équipe informatique.",
      scope: "Experts, dossiers et interactions",
    },
  ];

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / Intégrations</p>
        <h1>Intégrations</h1>
        <p className="muted">Kolbase s&apos;interface avec les outils déjà en place plutôt que de les remplacer.</p>
        <div className="grid-2">
          {items.map((i) => (
            <section key={i.name} className="card stack-sm">
              <div className="card-head">
                <h2 className="actions" style={{ gap: 8 }}><i.icon size={16} /> {i.name}</h2>
                <span className={`pill ${STATUS[i.status].tone}`}>{STATUS[i.status].label}</span>
              </div>
              <p>{i.detail}</p>
              <p className="muted text-sm">Périmètre : {i.scope}</p>
              {i.action && (i.action.download ? <a className="btn ghost small" href={i.action.href}>{i.action.label}</a> : <Link className="btn ghost small" href={i.action.href}>{i.action.label}</Link>)}
            </section>
          ))}
        </div>
        <div className="info-note">
          <Info size={15} />
          <span>Les connecteurs « À configurer » demandent un contrat et des identifiants propres à votre organisation : contactez-nous pour les activer.</span>
        </div>
      </main>
    </>
  );
}
