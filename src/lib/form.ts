/** Lecture et conversion des champs envoyés par les formulaires (actions serveur). */

/** Valeur texte d'un champ, sans espaces autour ("" si absent). */
export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * Montant saisi en euros (« 1 200,50 », « 1200.5 ») converti en centimes.
 * Vide, négatif ou illisible : null. `allowZero: false` refuse aussi 0 (devis, par exemple).
 */
export function eurToCents(v: string, { allowZero = true }: { allowZero?: boolean } = {}): number | null {
  const s = v.replace(/[\s  ]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return null;
  return Math.round(n * 100);
}

/** Entier positif ou nul (arrondi), ou null si vide ou illisible. */
export const intOrNull = (v: string) => (v && Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
