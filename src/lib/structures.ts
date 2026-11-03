/**
 * Structures juridiques d'un praticien (module pur). La structure de facturation (isPayee) est la seule source de
 * la société d'exercice : reprise par les conventions et par les notes d'honoraires, réglée avec les coordonnées
 * de facturation (Mes revenus › Notes d'honoraires). Sans elle, le praticien facture en son nom propre.
 */
export const LEGAL_FORMS = ["SELARL", "SELAS", "SASU", "SARL", "EURL", "SCM", "SCP", "Société d'exercice", "Société de conseil", "Association loi 1901", "Société savante", "Fondation", "Entreprise individuelle"];
export const STRUCTURE_ROLES = ["Gérant", "Président", "Associé", "Membre du bureau", "Trésorier", "Administrateur", "Membre simple"];

/** SIREN déduit du SIRET (ses neuf premiers chiffres). */
export const sirenOf = (siret: string | null | undefined) => (siret && /^\d{14}$/.test(siret) ? siret.slice(0, 9) : null);

/** Nom de la société d'exercice imprimé sur la note d'honoraires (« SELARL Dr Dupont », ou « Cabinet X (SELARL) »). */
export const payeeEntity = (s: { name: string; legalForm: string } | null | undefined) =>
  !s ? null : s.name.toLowerCase().includes(s.legalForm.toLowerCase()) ? s.name : `${s.name} (${s.legalForm})`;
