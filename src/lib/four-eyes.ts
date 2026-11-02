import "server-only";
import { db } from "@/lib/db";
import type { OrgRole } from "@/generated/prisma/client";

/**
 * Contrôle à quatre yeux : la personne qui a monté ou soumis un travail (dossier, support) ne le valide pas elle-même.
 * Exception des petites structures : si personne d'autre n'est habilité à décider, la décision reste possible,
 * mais seulement avec une justification écrite, conservée dans l'historique.
 */
export type FourEyes = "ok" | "justify" | "blocked";

/** Personnes ayant créé le dossier, l'ayant soumis à la conformité ou repris après un blocage. */
export async function projectAuthors(projectId: string): Promise<Set<string>> {
  const [project, logs] = await Promise.all([
    db.project.findUnique({ where: { id: projectId }, select: { createdById: true } }),
    db.auditLog.findMany({ where: { entityType: "Project", entityId: projectId, action: { in: ["project.create", "project.submit", "project.revise"] } }, select: { actorId: true } }),
  ]);
  return new Set([project?.createdById, ...logs.map((l) => l.actorId)].filter((x): x is string => !!x));
}

export async function fourEyes(authors: Set<string>, orgId: string, userId: string, deciderRoles: OrgRole[]): Promise<FourEyes> {
  if (!authors.has(userId)) return "ok";
  const others = await db.membership.count({ where: { organizationId: orgId, role: { in: deciderRoles }, userId: { not: userId } } });
  return others > 0 ? "blocked" : "justify";
}

export const FOUR_EYES_BLOCKED = "Contrôle à quatre yeux : vous avez monté ou soumis ce travail, une autre personne habilitée doit le valider.";
export const FOUR_EYES_JUSTIFY = "Vous êtes seul habilité à décider sur un travail que vous avez monté : indiquez une justification, elle sera conservée dans l'historique.";
