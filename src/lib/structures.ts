/**
 * Structures juridiques d'un praticien (module pur). Chaque structure peut avoir ses coordonnées de facturation ;
 * l'expert choisit, convention par convention, s'il facture en son nom propre ou au nom de l'une d'elles
 * (cabinet, société d'exercice, association…). La structure « par défaut » (isPayee) est proposée pour les nouvelles
 * conventions. Le choix est repris par la convention et par la note d'honoraires.
 */
export const LEGAL_FORMS = ["SELARL", "SELAS", "SASU", "SARL", "EURL", "SCM", "SCP", "Société d'exercice", "Société de conseil", "Association loi 1901", "Société savante", "Fondation", "Entreprise individuelle"];
/** Formes sans but lucratif : une rémunération qui leur est versée va à un tiers, pas au praticien. */
export const NON_PROFIT_FORMS = ["Association loi 1901", "Société savante", "Fondation"];
export const STRUCTURE_ROLES = ["Gérant", "Président", "Associé", "Membre du bureau", "Trésorier", "Administrateur", "Membre simple"];

/** SIREN déduit du SIRET (ses neuf premiers chiffres). */
export const sirenOf = (siret: string | null | undefined) => (siret && /^\d{14}$/.test(siret) ? siret.slice(0, 9) : null);

/** Nom de la société d'exercice imprimé sur la note d'honoraires (« SELARL Dr Dupont », ou « Cabinet X (SELARL) »). */
export const payeeEntity = (s: { name: string; legalForm: string } | null | undefined) =>
  !s ? null : s.name.toLowerCase().includes(s.legalForm.toLowerCase()) ? s.name : `${s.name} (${s.legalForm})`;

/** Choix de facturation d'une convention : structure choisie, nom propre, ou rien (la structure par défaut s'applique). */
export type BillingChoice = { billingStructureId: string | null; billingSelf: boolean };

/**
 * Structure au nom de laquelle une convention est facturée, ou null pour le nom propre : celle choisie par l'expert,
 * sinon sa structure par défaut.
 */
export function linkPayee<S extends { id: string; isPayee: boolean }>(choice: BillingChoice, structures: S[]): S | null {
  if (choice.billingSelf) return null;
  if (choice.billingStructureId) return structures.find((s) => s.id === choice.billingStructureId) ?? null;
  return structures.find((s) => s.isPayee) ?? null;
}

/** Valeur d'un choix dans un formulaire : « self » (nom propre) ou l'identifiant de la structure. */
export const choiceValue = (payee: { id: string } | null) => payee?.id ?? "self";

/**
 * Le choix se fait pendant le recrutement (proposition de l'expert, sollicitation, accord de principe) ; il est figé à
 * la soumission du dossier à la conformité, qui valide la convention telle qu'elle sera déclarée et signée.
 */
const BILLING_EDITABLE_STATUSES = ["ATT_EXPERTS", "ATT_IND", "ACCORD"];
export const billingEditable = (projectStatus: string, linkStatus: string) =>
  BILLING_EDITABLE_STATUSES.includes(projectStatus) && linkStatus !== "DECLINE";
