import { SOURCING_ROLES } from "@/lib/projects";
import "server-only";
import { createHash } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
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

/**
 * Vérifie que l'utilisateur courant est membre de l'organisation (et, si précisé, a l'un des rôles).
 * `allowSupplier` : l'action concerne la gestion de l'organisation elle-même (membres, invitations, fiche)
 * et vaut donc aussi pour une organisation prestataire.
 */
export async function requireMembership(orgId: string, roles?: OrgRole[], { allowSupplier = false }: { allowSupplier?: boolean } = {}) {
  const user = await requireUser();
  const memberships = user.memberships.filter((m) => m.organizationId === orgId);
  if (memberships.length === 0) notFound();
  const userRoles = memberships.map((m) => m.role);
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) notFound();
  if (roles && !userRoles.some((r) => roles.includes(r))) redirect(`/organisations/${orgId}`);
  // Une organisation prestataire n'a que son tableau de bord, ses demandes de devis et ses membres :
  // les espaces réservés à des rôles (dossiers, événements, conformité…) concernent les organisations clientes.
  if (roles && org.kind === "PRESTATAIRE" && !allowSupplier) redirect(`/organisations/${orgId}`);
  return { user, org, roles: userRoles, isAdmin: userRoles.includes("ADMIN") };
}

/** Rôles proposés à l'invitation : une organisation prestataire n'a que des administrateurs et des membres d'équipe. */
export const SUPPLIER_ROLES: OrgRole[] = ["ADMIN", "PRESTATAIRE"];
export const invitableRoles = (kind: OrgKind): OrgRole[] => (kind === "PRESTATAIRE" ? SUPPLIER_ROLES : (Object.keys(ROLE_LABEL) as OrgRole[]));

/** Libellé d'un rôle selon le type d'organisation (dans une agence, « Prestataire » désigne un membre de l'équipe). */
export const roleLabel = (role: OrgRole, kind: OrgKind) => (kind === "PRESTATAIRE" && role === "PRESTATAIRE" ? "Membre de l'équipe" : ROLE_LABEL[role]);

/** L'annuaire (sourcing) est réservé aux équipes Éducation, Cumul et aux administrateurs. Les autres voient l'annuaire public. */
export async function requireDirectoryAccess() {
  const user = await requireUser();
  if (!user.memberships.some((m) => SOURCING_ROLES.includes(m.role) && m.organization.kind !== "PRESTATAIRE")) redirect("/experts");
  return user;
}

export async function findInvitation(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return db.invitation.findUnique({ where: { tokenHash }, include: { organization: true, invitedBy: true } });
}
