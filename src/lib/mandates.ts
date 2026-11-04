import "server-only";
import { db } from "@/lib/db";
import { EVENT_ORGANIZER_ROLES } from "@/lib/events";
import type { OrgRole } from "@/generated/prisma/client";

/** Mandats en cours (non terminés). */
export const activeMandate = (now = new Date()) => ({ OR: [{ endsAt: null }, { endsAt: { gt: now } }] });

export type AwardRight = "award" | "propose" | "none";

/**
 * Droit de décision sur les devis d'un événement : un organisateur interne retient toujours ; une agence mandatée
 * retient si son mandat le permet (« peut retenir les devis »), sinon elle propose et l'organisateur décide.
 */
export async function awardRight(orgId: string, roles: OrgRole[], eventAgencyId: string | null | undefined): Promise<AwardRight> {
  if (roles.some((r) => EVENT_ORGANIZER_ROLES.includes(r))) return "award";
  if (!eventAgencyId) return "none";
  const m = await db.mandate.findFirst({ where: { mandatorId: orgId, agencyId: eventAgencyId, ...activeMandate() }, select: { canAward: true } });
  return !m ? "none" : m.canAward ? "award" : "propose";
}
