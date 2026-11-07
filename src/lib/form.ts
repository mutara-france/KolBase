/** Lecture et conversion des champs envoyés par les formulaires (actions serveur). */

/** Longueur maximale d'un champ texte (les présentations les plus longues tiennent largement). */
const MAX_TEXT = 20_000;
/** Longueur maximale d'un nom de personne ou d'organisation. */
export const MAX_NAME = 120;

/** Valeur texte d'un champ, sans espaces autour ("" si absent), tronquée à `max` caractères. */
export const str = (f: FormData, k: string, max = MAX_TEXT) => String(f.get(k) ?? "").trim().slice(0, max);

/**
 * Montant saisi en euros (« 1 200,50 », « 1200.5 ») converti en centimes.
 * Vide, négatif ou illisible : null. `allowZero: false` refuse aussi 0 (devis, par exemple).
 */
/** Montant maximal accepté (10 millions d'euros) : reste représentable en centimes dans un entier PostgreSQL. */
const MAX_EUR = 10_000_000;

export function eurToCents(v: string, { allowZero = true }: { allowZero?: boolean } = {}): number | null {
  const s = v.replace(/[\s  ]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_EUR || (!allowZero && n === 0)) return null;
  return Math.round(n * 100);
}

/** Entier positif ou nul (arrondi), ou null si vide ou illisible. */
export const intOrNull = (v: string) => (v && Number.isFinite(Number(v)) ? Math.min(1_000_000_000, Math.max(0, Math.round(Number(v)))) : null);

/**
 * Volume d'une prestation (heures, journées…) : nombre strictement positif et plausible.
 * Vide : null (non renseigné). Négatif, nul, illisible ou démesuré : undefined (à refuser).
 */
export function unitsOrNull(v: string): number | null | undefined {
  const s = v.replace(/[\s\u00A0\u202F]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 1000 ? Math.round(n * 100) / 100 : undefined;
}
export const UNITS_INVALID = "Volume invalide : indiquez un nombre positif (heures, journées…).";

/** Jour saisi (AAAA-MM-JJ, champ date) : midi UTC pour rester le même jour partout ; null si vide, undefined si illisible. */
export function dayOrNull(v: string): Date | null | undefined {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
