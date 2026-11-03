import "server-only";
import { db } from "@/lib/db";
import { DPA_VERSION } from "@/lib/dpa";

export type OnboardingStep = { key: string; label: string; hint: string; href: string; done: boolean };

/** « Prise en main » d'une organisation : ce qu'un administrateur règle une fois, dans l'ordre. */
export async function orgOnboarding(orgId: string): Promise<OnboardingStep[]> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      kind: true, verification: true, logoUpdatedAt: true, dpaVersion: true, complianceSettings: true, supplierCategories: true, priceHint: true,
      _count: { select: { members: true, invitations: true, projects: true, events: true, photos: true, offers: true } },
    },
  });
  if (!org) return [];
  const base = `/organisations/${orgId}`;
  const settings = org.complianceSettings && typeof org.complianceSettings === "object" && Object.keys(org.complianceSettings as object).length > 0;
  const team = org._count.members > 1 || org._count.invitations > 0;
  if (org.kind === "PRESTATAIRE") {
    return [
      { key: "validation", label: "Faire valider votre société", hint: "Le SIREN est contrôlé par KolBase avant votre référencement.", href: `${base}/membres?onglet=organisation`, done: org.verification === "VERIFIED" },
      { key: "logo", label: "Ajouter votre logo", hint: "Il apparaît dans l'annuaire et sur vos devis.", href: `${base}/membres?onglet=organisation`, done: !!org.logoUpdatedAt },
      { key: "fiche", label: "Choisir vos catégories et votre zone", hint: "Les organisations consultent l'annuaire par catégorie.", href: `${base}/devis?onglet=fiche`, done: org.supplierCategories.length > 0 },
      { key: "book", label: "Compléter votre book", hint: "Photos, capacités, équipements et prix indicatif.", href: `${base}/devis?onglet=fiche`, done: org._count.photos > 0 || !!org.priceHint },
      { key: "catalogue", label: "Créer votre catalogue de forfaits", hint: "Vos prestations courantes s'ajoutent à un devis en un clic.", href: `${base}/devis?onglet=fiche`, done: org._count.offers > 0 },
      { key: "equipe", label: "Inviter votre équipe", hint: "Plusieurs personnes peuvent répondre aux demandes.", href: `${base}/membres`, done: team },
    ];
  }
  return [
    { key: "validation", label: "Faire valider votre organisation", hint: "Indispensable pour solliciter des praticiens et publier des événements.", href: `${base}/membres?onglet=organisation`, done: org.verification === "VERIFIED" },
    { key: "dpa", label: "Accepter le contrat de sous-traitance (RGPD)", hint: "Il encadre les données que vous traitez dans KolBase.", href: `${base}/membres?onglet=organisation#sous-traitance`, done: org.dpaVersion === DPA_VERSION },
    { key: "equipe", label: "Inviter vos collègues", hint: "Projets et conformité : la double validation des dossiers suppose deux personnes.", href: `${base}/membres`, done: team },
    { key: "conformite", label: "Régler vos paramètres de conformité", hint: "Seuils d'hospitalité, délais de déclaration et d'autorisation.", href: `${base}/conformite?onglet=parametres`, done: !!settings },
    { key: "logo", label: "Ajouter votre logo", hint: "Il figure sur votre page publique et sur les attestations de présence.", href: `${base}/membres?onglet=organisation`, done: !!org.logoUpdatedAt },
    { key: "premier", label: "Lancer un premier dossier ou événement", hint: "Sollicitez des experts ou publiez un événement dans l'agenda.", href: `${base}/dossiers/nouveau`, done: org._count.projects + org._count.events > 0 },
  ];
}
