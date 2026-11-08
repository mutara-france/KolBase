import "server-only";
import { db } from "@/lib/db";
import { PROPOSAL_ORIGIN } from "@/lib/projects";

const MONTH_MS = 30 * 864e5;

/** Propositions envoyées sur les 30 derniers jours (limite contre le démarchage). */
export function proposalsThisMonth(practitionerId: string) {
  return db.expertProposal.count({ where: { practitionerId, createdAt: { gte: new Date(Date.now() - MONTH_MS) } } });
}

/** Organisations qui attendent déjà de répondre à une proposition de cet expert (une à la fois par organisation). */
export async function orgsAwaitingProposal(practitionerId: string) {
  const rows = await db.project.findMany({
    where: { status: "ATT_IND", origin: PROPOSAL_ORIGIN, experts: { some: { practitionerId } } },
    select: { organizationId: true },
  });
  return new Set(rows.map((r) => r.organizationId));
}

/** Destinataires possibles : organisations validées et référencées, hors prestataires (avec leur groupe éventuel). */
export function proposalRecipients() {
  return db.organization.findMany({
    where: { listed: true, verification: "VERIFIED", kind: { not: "PRESTATAIRE" } },
    select: { id: true, name: true, kind: true, sector: true, areas: true, logoUpdatedAt: true, groupId: true, brands: true, coveredCountries: true, group: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
}

/**
 * Entités d'un groupe pouvant recevoir une proposition, avec leurs canaux : l'aiguillage choisit celle du pays de
 * l'expert (et de la marque), puis le canal du sujet.
 */
export function groupEntities(groupId: string) {
  return db.organization.findMany({
    where: { groupId, listed: true, verification: "VERIFIED", kind: { not: "PRESTATAIRE" } },
    select: { id: true, name: true, coveredCountries: true, brands: true },
    orderBy: { createdAt: "asc" },
  });
}
