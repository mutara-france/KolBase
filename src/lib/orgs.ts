import { SOURCING_ROLES } from "@/lib/projects";
import "server-only";
import { createHash } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { lookupSiren } from "@/lib/siren";
import type { OrgRole } from "@/generated/prisma/client";

// Libellés et rôles (module sans dépendance serveur, réutilisable et testable).
export { INTERVENTION_TYPES, ORG_KIND_LABEL, orgKindDisplay, ORG_SUSPENDED, notVerified, SIREN_REQUIRED, invitableRoles, isAgencyOnly, isSuspendedOrg, isVerifiedOrg, orgIsPublic, roleLabel } from "@/lib/org-roles";

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
  // Page réservée à d'autres rôles : retour à l'accueil de l'organisation, avec un message (pas un retour muet).
  if (roles && !userRoles.some((r) => roles.includes(r))) redirect(`/organisations/${orgId}?acces=refuse&roles=${roles.join(",")}`);
  // Une organisation prestataire n'a que son tableau de bord, ses demandes de devis et ses membres :
  // les espaces réservés à des rôles (dossiers, événements, conformité…) concernent les organisations clientes.
  if (roles && org.kind === "PRESTATAIRE" && !allowSupplier) redirect(`/organisations/${orgId}?acces=refuse`);
  // Organisation qui exige la double authentification : le membre l'active d'abord (Mon compte › Sécurité).
  if (org.require2fa && !user.totpEnabledAt) redirect(`/compte?securite=${encodeURIComponent(orgId)}#securite`);
  return { user, org, roles: userRoles, isAdmin: userRoles.includes("ADMIN") };
}

/**
 * L'annuaire (sourcing) est réservé aux équipes Projets et aux administrateurs d'une organisation validée. Les autres
 * voient l'annuaire public, avec la raison (organisation en attente de validation, rôle) : pas de bascule silencieuse.
 */
export async function requireDirectoryAccess() {
  const user = await requireUser();
  if (!user.memberships.some((m) => SOURCING_ROLES.includes(m.role) && m.organization.kind !== "PRESTATAIRE" && m.organization.verification === "VERIFIED")) redirect("/experts?acces=annuaire");
  return user;
}

/** Pourquoi l'annuaire de recherche n'est pas ouvert à ce compte (message de l'annuaire public). */
export function directoryRefusal(user: { memberships: { role: OrgRole; organization: { kind: string; verification: string; name: string } }[] }) {
  const clients = user.memberships.filter((m) => m.organization.kind !== "PRESTATAIRE");
  const sourcing = clients.find((m) => SOURCING_ROLES.includes(m.role));
  if (sourcing) return { reason: sourcing.organization.verification === "SUSPENDED" ? ("suspended" as const) : ("pending" as const), org: sourcing.organization.name };
  if (clients.length > 0) return { reason: "role" as const, org: clients[0].organization.name };
  return { reason: "none" as const, org: null };
}

export async function findInvitation(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return db.invitation.findUnique({ where: { tokenHash }, include: { organization: true, invitedBy: true } });
}

/** SIREN contrôlé auprès de l'API Recherche d'entreprises : champs à enregistrer sur l'organisation. */
export async function sirenFields(siren: string) {
  const r = await lookupSiren(siren);
  return {
    siren,
    sirenCheckedAt: r ? new Date() : null,
    legalName: r?.found ? r.name : null,
    sirenActive: r ? (r.found ? r.active : false) : null,
    lookup: r,
  };
}
