import Link from "next/link";
import { CalendarDays, FileSignature, FileSpreadsheet, Info, Link2, Users } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/orgs";
import { COMPLIANCE_ROLES } from "@/lib/events";
import { signatureEnabled } from "@/lib/yousign";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: `${t("Intégrations")} — KolBase` };
}

type Integration = { name: string; icon: typeof Link2; status: "actif" | "export" | "prevu"; detail: string; scope: string; action?: { href: string; label: string; download?: boolean } };
const STATUS = { actif: { label: "Actif", tone: "ok" }, export: { label: "Par export", tone: "electric" }, prevu: { label: "Prévu", tone: "done" } } as const;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getT();
  const { id } = await params;
  const { org, roles } = await requireMembership(id, ["ADMIN", "PROJETS", "CONFORMITE"]);
  const isCompliance = roles.some((r) => COMPLIANCE_ROLES.includes(r));
  const orcidExperts = await db.practitionerProfile.count({ where: { listed: true, orcidSyncedAt: { not: null } } });

  const items: Integration[] = [
    {
      name: "Agenda (iCalendar)", icon: CalendarDays, status: "actif",
      detail: t("Vos événements s'importent dans Outlook, Google Agenda ou Apple Calendrier. Chaque fiche d'événement propose aussi « Ajouter à mon agenda » aux inscrits."),
      scope: "Événements de l'organisation (90 derniers jours et à venir)",
      action: { href: `/organisations/${id}/evenements/calendrier`, label: t("Télécharger le calendrier (.ics)"), download: true },
    },
    {
      name: "ORCID", icon: Users, status: "actif",
      detail: t(orcidExperts > 1 ? "Les experts importent leurs publications depuis leur profil ORCID public, ce qui alimente les fiches de l'annuaire. {n} experts ont déjà synchronisé leur profil." : "Les experts importent leurs publications depuis leur profil ORCID public, ce qui alimente les fiches de l'annuaire. {n} expert a déjà synchronisé son profil.", { n: orcidExperts }),
      scope: "Publications des experts (lecture seule, API publique)",
    },
    {
      name: "Transparence Santé", icon: FileSpreadsheet, status: "export",
      detail: t("KolBase prépare les fichiers de déclaration (conventions, rémunérations, hospitalités). Le dépôt se fait ensuite sur la plateforme publique Transparence Santé."),
      scope: "Registre des conventions et hospitalités",
      action: isCompliance ? { href: `/organisations/${id}/conformite?onglet=transparence`, label: t("Ouvrir l'espace conformité") } : undefined,
    },
    // Signature électronique : active dès que le service (Yousign) est configuré sur la plateforme.
    signatureEnabled()
      ? {
          name: "Signature électronique", icon: FileSignature, status: "actif",
          detail: t("Les conventions partent en signature électronique (Yousign) depuis le dossier, quand il est « En signature » : l'expert et votre signataire signent en ligne, le statut « signé » revient automatiquement dans le dossier avec le PDF signé."),
          scope: "Conventions de collaboration",
        }
      : {
          name: "Signature électronique", icon: FileSignature, status: "prevu",
          detail: t("Pas encore disponible. À terme : envoi des conventions en signature (Yousign) et retour automatique du statut « signé » dans le dossier. En attendant, la convention se télécharge en PDF depuis le dossier et le PDF signé s'y dépose."),
          scope: "Conventions de collaboration",
        },
    {
      name: "CRM (Veeva, Salesforce…)", icon: Link2, status: "prevu",
      detail: t("Pas encore disponible. À terme : synchronisation des experts et des interactions avec votre CRM. En attendant, les registres et listes d'inscrits s'exportent en CSV."),
      scope: "Experts, dossiers et interactions",
    },
  ];

  return (
    <>
      <SiteHeader />
      <main className="stack">
        <p className="muted"><Link href={`/organisations/${id}`}>{org.name}</Link> / {t("Intégrations")}</p>
        <h1>{t("Intégrations")}</h1>
        <p className="muted">{t("KolBase s'interface avec les outils déjà en place plutôt que de les remplacer.")}</p>
        <div className="grid-2">
          {items.map((i) => (
            <section key={i.name} className="card stack-sm">
              <div className="card-head">
                <h2 className="actions" style={{ gap: 8 }}><i.icon size={16} /> {t(i.name)}</h2>
                <span className={`pill ${STATUS[i.status].tone}`}>{t(STATUS[i.status].label)}</span>
              </div>
              <p>{i.detail}</p>
              <p className="muted text-sm">{t("Périmètre : {scope}", { scope: t(i.scope) })}</p>
              {i.action && (i.action.download ? <a className="btn ghost small" href={i.action.href}>{i.action.label}</a> : <Link className="btn ghost small" href={i.action.href}>{i.action.label}</Link>)}
            </section>
          ))}
        </div>
        <div className="info-note">
          <Info size={15} />
          <span>{t("Les connecteurs « Prévu » ne sont pas encore disponibles. Dites-nous lesquels vous seraient utiles en priorité.")}</span>
        </div>
      </main>
    </>
  );
}
