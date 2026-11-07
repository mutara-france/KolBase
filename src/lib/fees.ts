/**
 * Honoraires d'un expert : volume horaire (préparation, intervention, déplacement) et grille de rémunération de
 * l'organisation. Fonctions pures, partagées par le navigateur (calcul en direct) et le serveur.
 */

export type FeeLevelOpt = { id: string; label: string; hourlyCents: number };
export type Hours = { prepHours?: number | null; interventionHours?: number | null; travelHours?: number | null };
export const HOUR_FIELDS = ["prepHours", "interventionHours", "travelHours"] as const;
export const HOUR_LABEL: Record<(typeof HOUR_FIELDS)[number], string> = { prepHours: "Préparation", interventionHours: "Intervention", travelHours: "Déplacement" };

/** Volume horaire total déclaré, ou null si aucune heure n'est renseignée. */
export function hoursOf(e: Hours): number | null {
  const parts = HOUR_FIELDS.map((k) => e[k]).filter((x): x is number => x != null && x > 0);
  return parts.length ? Math.round(parts.reduce((s, x) => s + x, 0) * 100) / 100 : null;
}

/** Heures saisies (virgule acceptée, au quart d'heure) : null si vide, undefined si illisible. */
export function parseHours(raw: string): number | null | undefined {
  const s = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 500) return undefined;
  return Math.round(n * 4) / 4;
}

/** Honoraires calculés : volume horaire × taux du niveau (en centimes), ou null s'il manque l'un des deux. */
export function computedFee(hours: number | null, hourlyCents: number | null | undefined) {
  return hours != null && hourlyCents != null ? Math.round(hours * hourlyCents) : null;
}

/** Taux horaire réel (€ HT par heure) : honoraires ÷ volume horaire. */
export function effectiveHourly(feeCents: number | null | undefined, hours: number | null) {
  return feeCents != null && hours ? Math.round(feeCents / hours) / 100 : null;
}

/** Heures en français : « 2 h », « 1,5 h ». */
export const fmtHours = (h: number, loc = "fr-FR") => `${h.toLocaleString(loc, { maximumFractionDigits: 2 })} h`;

/** Détail du volume horaire : « 4 h de préparation, 6 h d'intervention, 2 h de déplacement ». */
export function hoursDetail(e: Hours, t: (k: string, v?: Record<string, string | number>) => string, loc = "fr-FR") {
  const parts: string[] = [];
  if (e.prepHours) parts.push(t("{h} de préparation", { h: fmtHours(e.prepHours, loc) }));
  if (e.interventionHours) parts.push(t("{h} d'intervention", { h: fmtHours(e.interventionHours, loc) }));
  if (e.travelHours) parts.push(t("{h} de déplacement", { h: fmtHours(e.travelHours, loc) }));
  return parts.join(", ");
}
