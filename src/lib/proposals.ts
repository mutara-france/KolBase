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

/** Destinataires possibles : organisations validées et référencées, hors prestataires. */
export function proposalRecipients() {
  return db.organization.findMany({
    where: { listed: true, verification: "VERIFIED", kind: { not: "PRESTATAIRE" } },
    select: { id: true, name: true, kind: true, sector: true, areas: true, logoUpdatedAt: true },
    orderBy: { name: "asc" },
  });
}
