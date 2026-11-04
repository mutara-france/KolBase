import type { OrgKind, OrgRole } from "@/generated/prisma/client";

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  INDUSTRIEL: "Industriel",
  SOCIETE_SAVANTE: "Société savante",
  ASSOCIATION_PRO: "Association professionnelle",
  ORGANISME_FORMATION: "Organisme de formation",
  PRESTATAIRE: "Prestataire (agence, logistique…)",
};

/** Familles affichées sur la page publique des organisations (les sociétés savantes et associations vont ensemble). */
export const ORG_FAMILIES = [
  { id: "industriels", label: "Industriels", kinds: ["INDUSTRIEL"], desc: "Fabricants et distributeurs de dispositifs, produits et solutions dentaires." },
  { id: "societes-savantes", label: "Sociétés savantes et associations", kinds: ["SOCIETE_SAVANTE", "ASSOCIATION_PRO"], desc: "Sociétés savantes, collèges et associations professionnelles." },
  { id: "formation", label: "Organismes de formation", kinds: ["ORGANISME_FORMATION"], desc: "Formation continue, DPC et travaux pratiques." },
  { id: "prestataires", label: "Prestataires", kinds: ["PRESTATAIRE"], desc: "Agences, traiteurs, lieux, hébergement et transport pour les événements." },
] as const satisfies readonly { id: string; label: string; kinds: readonly OrgKind[]; desc: string }[];
export type OrgFamily = (typeof ORG_FAMILIES)[number]["id"];
export const orgFamily = (kind: OrgKind): OrgFamily => ORG_FAMILIES.find((f) => (f.kinds as readonly OrgKind[]).includes(kind))!.id;

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
  ADMIN: "Équipe, fiche et réglages de l'organisation ; accès à toutes les rubriques.",
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

/** Une organisation n'agit auprès des praticiens qu'une fois validée par KolBase. */
export const isVerifiedOrg = (org: { verification: string }) => org.verification === "VERIFIED";
/** Page publique de l'organisation visible (/structures/[id]) : validée et présente dans l'annuaire. */
export const orgIsPublic = (org: { verification: string; listed: boolean }) => org.listed && isVerifiedOrg(org);
export const ORG_NOT_VERIFIED =
  "Votre organisation doit d'abord être validée par KolBase (SIREN contrôlé). Un administrateur de l'organisation peut compléter la demande dans « Membres et réglages ».";

/** Types d'organisation pour lesquels le SIREN est obligatoire (les sociétés savantes et associations n'en ont pas toujours). */
export const SIREN_REQUIRED: OrgKind[] = ["INDUSTRIEL", "ORGANISME_FORMATION", "PRESTATAIRE"];

export const VERIFICATION_LABEL = { PENDING: "En attente de validation", VERIFIED: "Validée", REJECTED: "Refusée" } as const;
