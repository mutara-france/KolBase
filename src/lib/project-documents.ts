import "server-only";
import { db } from "@/lib/db";
import { drPrefix } from "@/lib/professions";

/**
 * Experts engagés dont la convention signée manque : ni convention signée déposée, ni signature électronique achevée
 * (celle-ci compte même si le PDF signé n'a pas pu être enregistré). Calculée même sans stockage configuré :
 * l'absence de stockage n'est jamais une preuve de signature (une attestation explicite est alors demandée).
 */
export async function missingSignedConventions(projectId: string): Promise<string[]> {
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

/**
 * Experts engagés agents publics (exerçant en France) dont l'autorisation de cumul d'activités manque : la déclaration
 * ou la demande d'autorisation adressée à l'Ordre doit la comporter (article R.1453-14 du Code de la santé publique).
 */
export async function missingCumulAuthorizations(projectId: string): Promise<string[]> {
  const links = await db.projectExpert.findMany({
    where: {
      projectId,
      status: { notIn: ["ATT_EXPERTS", "DECLINE"] },
      practitioner: { publicAgent: true, country: "FR" },
      documents: { none: { kind: "AUTORISATION_CUMUL" } },
    },
    include: { practitioner: { include: { user: { select: { firstName: true, lastName: true } } } } },
  });
  return links.map((l) => `${drPrefix(l.practitioner.profession)}${l.practitioner.user.firstName} ${l.practitioner.user.lastName}`);
}
