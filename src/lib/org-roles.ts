import type { OrgKind, OrgRole } from "@/generated/prisma/client";

export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  INDUSTRIEL: "Industriel",
  SOCIETE_SAVANTE: "Société savante",
  ASSOCIATION_PRO: "Association professionnelle",
  ORGANISME_FORMATION: "Organisme de formation",
  PRESTATAIRE: "Prestataire (agence, logistique…)",
};

export const ROLE_LABEL: Record<OrgRole, string> = {
  ADMIN: "Administrateur",
  EDUCATION: "Éducation",
  EVENEMENTS: "Événements",
  CUMUL: "Éducation et événements",
  PRESTATAIRE: "Prestataire mandaté",
  RELECTURE: "Relecture",
  CONFORMITE: "Conformité",
};

export const INTERVENTION_TYPES = [
  "Conférence", "Formation / atelier pratique", "Board scientifique", "Rédaction scientifique",
  "Étude clinique", "Webinaire", "Démonstration produit", "Relecture de supports",
];

/** Rôles proposés à l'invitation : une organisation prestataire n'a que des administrateurs et des membres d'équipe. */
export const SUPPLIER_ROLES: OrgRole[] = ["ADMIN", "PRESTATAIRE"];
export const invitableRoles = (kind: OrgKind): OrgRole[] => (kind === "PRESTATAIRE" ? SUPPLIER_ROLES : (Object.keys(ROLE_LABEL) as OrgRole[]));

/** Libellé d'un rôle selon le type d'organisation (dans une agence, « Prestataire » désigne un membre de l'équipe). */
export const roleLabel = (role: OrgRole, kind: OrgKind) => (kind === "PRESTATAIRE" && role === "PRESTATAIRE" ? "Membre de l'équipe" : ROLE_LABEL[role]);

/** Une organisation n'agit auprès des praticiens qu'une fois validée par KolBase. */
export const isVerifiedOrg = (org: { verification: string }) => org.verification === "VERIFIED";
export const ORG_NOT_VERIFIED =
  "Votre organisation doit d'abord être validée par KolBase (SIREN contrôlé). Un administrateur de l'organisation peut compléter la demande dans « Membres et réglages ».";

/** Types d'organisation pour lesquels le SIREN est obligatoire (les sociétés savantes et associations n'en ont pas toujours). */
export const SIREN_REQUIRED: OrgKind[] = ["INDUSTRIEL", "ORGANISME_FORMATION", "PRESTATAIRE"];

export const VERIFICATION_LABEL = { PENDING: "En attente de validation", VERIFIED: "Validée", REJECTED: "Refusée" } as const;
