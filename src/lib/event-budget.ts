import { SUPPLIER_CATEGORIES, supplierCategoryLabel } from "@/lib/suppliers";

/**
 * Budget d'un événement par poste : le prévu (saisi par l'organisateur ou son agence) face à l'engagé (devis retenus
 * de la catégorie, TTC). Les postes hors prestataires (frais d'inscription, billets payés directement) se suivent à
 * la main.
 */
export const BUDGET_EXTRA = [
  { id: "hospitalites", label: "Hospitalités directes (inscriptions, billets)" },
  { id: "autre", label: "Autre" },
] as const;

export const BUDGET_POSTS = [...SUPPLIER_CATEGORIES.map((c) => ({ id: c.id, label: c.label })), ...BUDGET_EXTRA];
export const budgetPostLabel = (id: string) => BUDGET_EXTRA.find((b) => b.id === id)?.label ?? supplierCategoryLabel(id);

export type BudgetRow = { category: string; planned: number; engaged: number; lines: { id: string; label: string; planned: number }[] };

/** Lignes prévues et engagements (centimes TTC) regroupés par poste ; un engagement sans ligne prévue apparaît aussi. */
export function budgetRows(lines: { id: string; category: string; label: string; plannedCents: number }[], engaged: { category: string; ttcCents: number }[]): { rows: BudgetRow[]; planned: number; engaged: number } {
  const map = new Map<string, BudgetRow>();
  const row = (c: string) => map.get(c) ?? map.set(c, { category: c, planned: 0, engaged: 0, lines: [] }).get(c)!;
  for (const l of lines) {
    const r = row(l.category);
    r.planned += l.plannedCents;
    r.lines.push({ id: l.id, label: l.label, planned: l.plannedCents });
  }
  for (const e of engaged) row(e.category).engaged += e.ttcCents;
  const order: string[] = BUDGET_POSTS.map((p) => p.id);
  const rows = [...map.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return { rows, planned: rows.reduce((s, r) => s + r.planned, 0), engaged: rows.reduce((s, r) => s + r.engaged, 0) };
}
