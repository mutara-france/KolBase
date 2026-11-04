import { asObjectId, ENGAGING, type Motive } from "@/lib/billing-plans";

/** Version en vigueur du contrat de sous-traitance (à changer à chaque modification du texte : les organisations l'acceptent à nouveau). */
export const DPA_VERSION = "2026-11";
export const DPA_UPDATED = "novembre 2026";

/**
 * Le contrat en vigueur est-il accepté ? Exigé des organisations clientes avant la première action qui engage
 * un tiers ; un prestataire n'en a pas à accepter (la section n'existe pas dans ses réglages).
 */
export const dpaCurrent = (org: { kind: string; dpaVersion: string | null }) => org.kind === "PRESTATAIRE" || org.dpaVersion === DPA_VERSION;

/** Section « Contrat de sous-traitance » de Membres et réglages, avec l'action à reprendre après l'acceptation. */
export const dpaHref = (orgId: string, motive?: Motive | null, objet?: string | null) =>
  `/organisations/${orgId}/membres?onglet=organisation${motive ? `&motif=${motive}` : ""}${motive && asObjectId(objet) ? `&objet=${objet}` : ""}#sous-traitance`;

/** Message d'une action refusée faute de contrat accepté (chemin de la page donné en clair, lien à côté). */
export const dpaMessage = (motive: Motive) =>
  `Pour ${ENGAGING[motive]}, un administrateur de l'organisation doit d'abord accepter le contrat de sous-traitance (RGPD) : Membres et réglages › Organisation.`;
