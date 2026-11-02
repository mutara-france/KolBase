import "server-only";
import { db } from "@/lib/db";
import { drPrefix } from "@/lib/professions";
import { storageEnabled } from "@/lib/storage";

/**
 * Experts engagés dont la convention signée manque (vide si le stockage n'est pas configuré) : ni convention signée
 * déposée, ni signature électronique achevée (celle-ci compte même si le PDF signé n'a pas pu être enregistré).
 */
export async function missingSignedConventions(projectId: string): Promise<string[]> {
  if (!storageEnabled()) return [];
  const links = await db.projectExpert.findMany({
    where: {
      projectId,
      status: { notIn: ["ATT_EXPERTS", "DECLINE"] },
      documents: { none: { kind: "CONVENTION_SIGNEE" } },
      NOT: { signature: { is: { status: "done" } } },
    },
    include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } },
  });
  return links.map((l) => `${drPrefix(l.practitioner.profession)}${l.practitioner.user.firstName} ${l.practitioner.user.lastName}`);
}
