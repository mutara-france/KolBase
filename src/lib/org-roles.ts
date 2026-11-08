import type { OrgKind, OrgRole } from "@/generated/prisma/client";
import { SUPPLIER_CATEGORIES } from "@/lib/suppliers";

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  INDUSTRIEL: "Industriel",
  SOCIETE_SAVANTE: "Société savante",
  ASSOCIATION_PRO: "Association professionnelle",
  ORGANISME_FORMATION: "Organisme de formation",
  PRESTATAIRE: "Prestataire (agence, logistique…)",
};

/**
 * Type d'organisation tel qu'affiché (pages publiques, en-têtes, administration) : un prestataire est présenté par sa
 * catégorie principale (« Restauration et traiteur », « Hébergement »…), sinon « Prestataire ». Le libellé long
 * (« Prestataire (agence, logistique…) ») reste celui des formulaires, où il aide à choisir.
 */
export function orgKindDisplay(o: { kind: OrgKind; supplierCategories?: readonly string[] | null }) {
  if (o.kind !== "PRESTATAIRE") return ORG_KIND_LABEL[o.kind];
  return SUPPLIER_CATEGORIES.find((c) => c.id === o.supplierCategories?.[0])?.label ?? "Prestataire";
}

/** Familles affichées sur la page publique des organisations (les sociétés savantes et associations vont ensemble). */
export const ORG_FAMILIES = [
  { id: "industriels", label: "Industriels", kinds: ["INDUSTRIEL"], desc: "Fabricants et distributeurs de dispositifs, produits et solutions dentaires." },
  { id: "societes-savantes", label: "Sociétés savantes et associations", kinds: ["SOCIETE_SAVANTE", "ASSOCIATION_PRO"], desc: "Sociétés savantes, collèges et associations professionnelles." },
  { id: "formation", label: "Organismes de formation", kinds: ["ORGANISME_FORMATION"], desc: "Formation continue, DPC et travaux pratiques." },
  { id: "prestataires", label: "Prestataires", kinds: ["PRESTATAIRE"], desc: "Agences, traiteurs, lieux, hébergement et transport pour les événements." },
] as const satisfies readonly { id: string; label: string; kinds: readonly OrgKind[]; desc: string }[];
export type OrgFamily = (typeof ORG_FAMILIES)[number]["id"];
export const orgFamily = (kind: OrgKind): OrgFamily => ORG_FAMILIES.find((f) => (f.kinds as readonly OrgKind[]).includes(kind))!.id;

/** Ce que les contrôles d'accès lisent d'un compte : ses appartenances (avec l'exigence de l'organisation) et sa 2FA. */
export type AccessUser = { totpEnabledAt: Date | null; memberships: { organizationId: string; role: OrgRole; organization: { require2fa: boolean } }[] };

/**
 * Rôles de l'utilisateur dans une organisation, pour tout contrôle d'accès fait hors de requireMembership (téléchargements,
 * actions partagées entre l'expert et l'organisation). Aucun tant que l'organisation exige la double authentification et
 * que l'utilisateur ne l'a pas activée : même règle que requireMembership, qui renvoie alors vers Mon compte › Sécurité.
 * Sans elle, un document, une convention signée ou un devis restaient téléchargeables par adresse directe avec le seul
 * mot de passe.
 */
export function memberRoles(user: AccessUser, orgId: string): OrgRole[] {
  const ms = user.memberships.filter((m) => m.organizationId === orgId);
  if (!user.totpEnabledAt && ms.some((m) => m.organization.require2fa)) return [];
  return ms.map((m) => m.role);
}

/** L'utilisateur a-t-il, dans cette organisation, l'un de ces rôles (ou n'importe lequel sans liste) ? Voir memberRoles. */
export function hasMemberRole(user: AccessUser, orgId: string, roles?: readonly OrgRole[]) {
  const mine = memberRoles(user, orgId);
  return roles ? mine.some((r) => roles.includes(r)) : mine.length > 0;
}

/**
 * Quatre rôles. Le cloisonnement des décisions repose surtout sur le contrôle à quatre yeux : la personne qui monte
 * ou soumet un dossier ne le valide pas, celle qui soumet un support ne l'approuve pas (voir lib/four-eyes).
 */
export const ROLE_LABEL: Record<OrgRole, string> = {
  ADMIN: "Administrateur",
  PROJETS: "Projets",
  CONFORMITE: "Conformité",
  PRESTATAIRE: "Agence mandatée",
};
/** Ce que chaque rôle permet, pour l'écran des membres. */
export const ROLE_DESC: Record<OrgRole, string> = {
  ADMIN: "Équipe, fiche, réglages et abonnement de l'organisation ; dossiers et événements. La conformité demande en plus le rôle Conformité.",
  PROJETS: "Sollicite les experts, conduit les dossiers, organise les événements et consulte les prestataires.",
  CONFORMITE: "Valide les dossiers, relit les supports, suit les déclarations et les hospitalités.",
  PRESTATAIRE: "Agence externe : accès limité aux événements que l'organisation lui confie.",
};

export const INTERVENTION_TYPES = [
  "Conférence", "Formation / atelier pratique", "Board scientifique", "Rédaction scientifique",
  "Étude clinique", "Webinaire", "Démonstration produit", "Relecture de supports",
];

/** Rôles proposés à l'invitation : une organisation prestataire n'a que des administrateurs et des membres d'équipe. */
export const SUPPLIER_ROLES: OrgRole[] = ["ADMIN", "PRESTATAIRE"];
/** Rôles qui voient les statistiques de l'organisation (pilotage, budget, conformité). */
export const STATS_ROLES: OrgRole[] = ["ADMIN", "PROJETS", "CONFORMITE"];
/** Organisation cliente : trois rôles internes. Une agence n'est pas invitée : son mandat donne accès à ses membres. */
export const invitableRoles = (kind: OrgKind): OrgRole[] => (kind === "PRESTATAIRE" ? SUPPLIER_ROLES : ["ADMIN", "PROJETS", "CONFORMITE"]);

/** Libellé d'un rôle selon le type d'organisation (dans une agence, « Prestataire » désigne un membre de l'équipe). */
export const roleLabel = (role: OrgRole, kind: OrgKind) => (kind === "PRESTATAIRE" && role === "PRESTATAIRE" ? "Membre de l'équipe" : ROLE_LABEL[role]);

/**
 * Agence mandatée dans l'espace d'une organisation cliente : son seul rôle y est « Agence mandatée » (appartenance
 * déduite du mandat). Elle n'y voit ni l'abonnement, ni la gestion de la fiche, ni la page publique « de l'organisation ».
 */
export const isAgencyOnly = (roles: OrgRole[], kind: OrgKind | string) => kind !== "PRESTATAIRE" && roles.length > 0 && roles.every((r) => r === "PRESTATAIRE");

/** Une organisation n'agit auprès des praticiens qu'une fois validée par KolBase. */
export const isVerifiedOrg = (org: { verification: string }) => org.verification === "VERIFIED";
/** Page publique de l'organisation visible (/structures/[id]) : validée et présente dans l'annuaire. */
export const orgIsPublic = (org: { verification: string; listed: boolean }) => org.listed && isVerifiedOrg(org);
export const ORG_NOT_VERIFIED =
  "Votre organisation doit d'abord être validée par KolBase (SIREN contrôlé). Un administrateur de l'organisation peut compléter la demande dans « Membres et réglages ».";

/** Types d'organisation pour lesquels le SIREN est obligatoire (les sociétés savantes et associations n'en ont pas toujours). */
export const SIREN_REQUIRED: OrgKind[] = ["INDUSTRIEL", "ORGANISME_FORMATION", "PRESTATAIRE"];
/** Société savante ou association : SIREN facultatif, numéro RNA accepté à la place. */
export const rnaAccepted = (kind: OrgKind) => !SIREN_REQUIRED.includes(kind);

export const VERIFICATION_LABEL = { PENDING: "En attente de validation", VERIFIED: "Validée", REJECTED: "Refusée", SUSPENDED: "Suspendue" } as const;
/** Organisation suspendue par KolBase : masquée et sans action nouvelle, jusqu'à sa réactivation. */
export const isSuspendedOrg = (org: { verification: string }) => org.verification === "SUSPENDED";
export const ORG_SUSPENDED = "Votre organisation est suspendue par KolBase : aucune nouvelle action n'est possible jusqu'à sa réactivation.";
/** Pourquoi une organisation non validée ne peut pas agir : en attente de validation, ou suspendue. */
export const notVerified = (org: { verification: string }) => (isSuspendedOrg(org) ? ORG_SUSPENDED : ORG_NOT_VERIFIED);
