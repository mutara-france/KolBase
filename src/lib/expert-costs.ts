/**
 * Frais, voyage et contrat-cadre des experts (module pur) :
 * - notes de frais sur justificatif (transport, hébergement, repas), examinées puis remboursées par l'organisation ;
 *   les frais remboursés sont des avantages déclarés avec la convention (Transparence Santé, betransparent.be) ;
 * - billets et hébergement réservés par l'organisation, visibles de l'expert ;
 * - contrat-cadre : plusieurs prestations de même nature sur douze mois au plus, dans la limite des unités prévues.
 */
import { MDEON_CAPS } from "@/lib/belgium";

export const EXPENSE_CATEGORIES = [
  { id: "transport", label: "Transport" },
  { id: "hebergement", label: "Hébergement" },
  { id: "repas", label: "Repas" },
  { id: "autre", label: "Autre frais" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["id"];
export const isExpenseCategory = (v: string): v is ExpenseCategory => EXPENSE_CATEGORIES.some((c) => c.id === v);
export const expenseCategoryLabel = (id: string) => EXPENSE_CATEGORIES.find((c) => c.id === id)?.label ?? "Autre frais";

export const EXPENSE_STATUSES = ["submitted", "approved", "rejected", "paid"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = { submitted: "À examiner", approved: "Acceptée", rejected: "Refusée", paid: "Remboursée" };
export const EXPENSE_STATUS_TONE: Record<ExpenseStatus, "wait" | "ok" | "bad" | "done"> = { submitted: "wait", approved: "ok", rejected: "bad", paid: "done" };
export const expenseStatus = (s: string): ExpenseStatus => ((EXPENSE_STATUSES as readonly string[]).includes(s) ? (s as ExpenseStatus) : "submitted");

/** Nature de l'avantage dans le fichier Transparence Santé. */
export const EXPENSE_NATURE_FR: Record<ExpenseCategory, string> = {
  transport: "Frais de transport",
  hebergement: "Hospitalité - hébergement",
  repas: "Hospitalité - restauration",
  autre: "Autre",
};
/** Nature dans la publication belge (frais liés à la prestation de services). */
export const EXPENSE_NATURE_BE: Record<ExpenseCategory, string> = {
  transport: "Frais de déplacement liés à la prestation",
  hebergement: "Frais d'hébergement liés à la prestation",
  repas: "Repas liés à la prestation",
  autre: "Autres frais liés à la prestation",
};

/**
 * Notes de frais ouvertes : expert engagé, convention en signature ou signée, et jusqu'après la prestation (dossier
 * terminé). Les frais sont remboursés au titre de la convention, d'où l'attente de la signature.
 */
export const expensesOpen = (linkStatus: string, projectStatus: string) =>
  linkStatus !== "ATT_EXPERTS" && linkStatus !== "DECLINE" && ["SIGNATURE", "SIGNE", "TERMINE"].includes(projectStatus);

/** Montant d'une ligne de frais : 0,01 € à 5 000 € TTC (au-delà, une erreur de saisie plus qu'un frais). */
export const EXPENSE_MAX_CENTS = 500_000;

/**
 * Plafond indicatif d'un frais : plafonds d'hospitalité de l'organisation pour un expert exerçant en France, plafonds
 * Mdeon pour la Belgique (nuitée 250 €, dîner 90 €). Sans plafond pour le transport et les autres frais.
 */
export function expenseCap(category: string, practiceCountry: string, limits: { hospitalityNightMax: number; hospitalityMealMax: number }, nights = 1): number | null {
  const be = practiceCountry === "BE";
  if (category === "hebergement") return (be ? MDEON_CAPS.nuitee.max : limits.hospitalityNightMax) * Math.max(1, nights);
  if (category === "repas") return be ? MDEON_CAPS.cocktail.max : limits.hospitalityMealMax;
  return null;
}

/** Dépassement du plafond (en euros), ou null. */
export function expenseOverCap(e: { category: string; amountCents: number }, practiceCountry: string, limits: { hospitalityNightMax: number; hospitalityMealMax: number }, nights = 1) {
  const cap = expenseCap(e.category, practiceCountry, limits, nights);
  return cap != null && e.amountCents / 100 > cap ? { amount: e.amountCents / 100, cap } : null;
}

/** Totaux d'une liste de frais par statut (centimes). */
export function expenseTotals(list: { status: string; amountCents: number }[]) {
  const out: Record<ExpenseStatus, number> = { submitted: 0, approved: 0, rejected: 0, paid: 0 };
  for (const e of list) out[expenseStatus(e.status)] += e.amountCents;
  return { ...out, engaged: out.approved + out.paid };
}

// ─── Contrat-cadre ────────────────────────────────────────────────────────

export const FRAMEWORK_MAX_MONTHS = 12;

const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

/** Période d'un contrat-cadre : une fin, après le début, douze mois au plus. Message d'erreur, ou null. */
export function frameworkPeriodError(start: Date, end: Date | null): string | null {
  if (!end) return "Indiquez la fin de la période du contrat-cadre.";
  if (end.getTime() <= start.getTime()) return "La fin de la période doit suivre son début.";
  if (end.getTime() > addMonths(start, FRAMEWORK_MAX_MONTHS).getTime() + 86400e3) return "Un contrat-cadre couvre douze mois au plus.";
  return null;
}

/** Unités consommées par les missions d'un expert, au regard des unités prévues à sa convention. */
export function frameworkUsage(planned: number | null, missions: { units: number }[]) {
  const used = Math.round(missions.reduce((s, m) => s + m.units, 0) * 100) / 100;
  const total = planned ?? 0;
  return { used, planned: total, remaining: Math.max(0, Math.round((total - used) * 100) / 100), over: used > total };
}

/** Une mission : dans la période, dans les unités restantes (au-delà, un avenant). Message d'erreur, ou null. */
export function missionError(m: { date: Date; units: number }, period: { start: Date; end: Date }, remaining: number): string | null {
  if (!(m.units > 0) || m.units > 365) return "Nombre d'unités invalide.";
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (day(m.date) < day(period.start) || day(m.date) > day(period.end)) return "La mission doit avoir lieu pendant la période du contrat-cadre.";
  if (m.units > remaining + 1e-9) return "Unités insuffisantes au contrat-cadre : un avenant à la convention est nécessaire au-delà.";
  return null;
}

/** Début d'un contrat-cadre : date d'intervention prévue, sinon la création du dossier. */
export const frameworkStart = (p: { plannedAt: Date | null; createdAt: Date }) => p.plannedAt ?? p.createdAt;
