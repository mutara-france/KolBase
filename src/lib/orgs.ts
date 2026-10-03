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

/** Vérifie que l'utilisateur courant est membre de l'organisation (et, si précisé, a l'un des rôles). */
export async function requireMembership(orgId: string, roles?: OrgRole[]) {
  const user = await requireUser();
  const memberships = user.memberships.filter((m) => m.organizationId === orgId);
  if (memberships.length === 0) notFound();
  const userRoles = memberships.map((m) => m.role);
  if (roles && !userRoles.some((r) => roles.includes(r))) redirect(`/organisations/${orgId}`);
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) notFound();
  return { user, org, roles: userRoles, isAdmin: userRoles.includes("ADMIN") };
}

/** L'annuaire est réservé aux membres d'une organisation et aux experts référencés. */
export async function requireDirectoryAccess() {
  const user = await requireUser();
  if (user.memberships.length === 0 && !user.practitioner?.listed) redirect("/compte?annuaire=1");
  return user;
}

export async function findInvitation(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return db.invitation.findUnique({ where: { tokenHash }, include: { organization: true, invitedBy: true } });
}
