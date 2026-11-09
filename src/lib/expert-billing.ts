import "server-only";
import { db } from "@/lib/db";
import { linkPayee } from "@/lib/structures";

/**
 * Facturation des conventions par l'expert (serveur) : au nom de qui chaque convention est facturée, et avec quelles
 * coordonnées. Le nom propre reprend les coordonnées du profil, une structure les siennes.
 */

/** Structures du praticien, la structure par défaut en tête. */
export const practitionerStructures = (practitionerId: string) =>
  db.practitionerStructure.findMany({ where: { practitionerId }, orderBy: [{ isPayee: "desc" }, { name: "asc" }] });

/**
 * Soumission du dossier à la conformité : le choix de facturation de chaque expert engagé est figé (sa structure par
 * défaut, s'il n'en a pas choisi), pour que la convention validée, déclarée et signée ne change plus.
 */
export async function freezeBilling(projectId: string) {
  const links = await db.projectExpert.findMany({
    where: { projectId, status: { notIn: ["ATT_EXPERTS", "DECLINE"] }, billingSelf: false, billingStructureId: null },
    select: { id: true, practitioner: { select: { structures: { where: { isPayee: true }, select: { id: true, isPayee: true } } } } },
  });
  for (const l of links) {
    const payee = linkPayee({ billingStructureId: null, billingSelf: false }, l.practitioner.structures);
    await db.projectExpert.update({ where: { id: l.id }, data: payee ? { billingStructureId: payee.id } : { billingSelf: true } });
  }
}
