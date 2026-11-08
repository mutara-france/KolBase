/** Signalements et retraits de contenus par l'équipe KolBase (module pur). */

export const REPORT_TARGETS = {
  expert: "Profil d'expert",
  organisation: "Page d'organisation",
  evenement: "Événement",
  avis: "Avis sur un prestataire",
} as const;
export type ReportTarget = keyof typeof REPORT_TARGETS;
export const isReportTarget = (v: string): v is ReportTarget => Object.hasOwn(REPORT_TARGETS, v);

export const REPORT_REASONS = [
  { id: "illicite", label: "Contenu manifestement illicite" },
  { id: "inexact", label: "Information inexacte ou trompeuse" },
  { id: "deontologie", label: "Contraire à la déontologie (publicité, promotion d'un produit…)" },
  { id: "donnees", label: "Données personnelles d'un tiers ou d'un patient" },
  { id: "autre", label: "Autre motif" },
] as const;
export const isReportReason = (v: string) => REPORT_REASONS.some((r) => r.id === v);
export const reportReasonLabel = (v: string) => REPORT_REASONS.find((r) => r.id === v)?.label ?? v;

/** Ce que l'équipe peut retirer selon la cible : la présentation, la description, ou l'avis (masqué). */
export const REMOVAL_LABEL: Record<ReportTarget, string> = {
  expert: "Retirer la présentation de l'expert",
  organisation: "Retirer la présentation de l'organisation",
  evenement: "Retirer la description de l'événement",
  avis: "Masquer l'avis",
};
export const decisionLabel = (target: string, decision: string | null) =>
  decision === "retire" ? (isReportTarget(target) ? REMOVAL_LABEL[target] : "Contenu retiré") : decision === "sans_suite" ? "Sans suite" : "À traiter";

/** Signalements par personne (compte ou adresse) et par adresse IP, sur 24 heures. */
export const REPORTS_PER_DAY = 5;
export const REPORT_MIN_CHARS = 10;
export const REPORT_MAX_CHARS = 3000;

/** Adresse e-mail plausible (signalement sans compte). */
export const plausibleEmail = (v: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(v);

/** Adresse publique de la cible (lien du registre, e-mails). */
export function targetHref(type: string, id: string, extra?: { supplierId?: string }) {
  if (type === "expert") return `/experts/${id}`;
  if (type === "organisation") return `/structures/${id}`;
  if (type === "evenement") return `/evenements/${id}`;
  if (type === "avis" && extra?.supplierId) return `/structures/${extra.supplierId}`;
  return null;
}
