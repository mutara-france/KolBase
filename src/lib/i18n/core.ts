/**
 * Fonctions de traduction sans dictionnaire : utilisables dans les composants client sans y embarquer le
 * dictionnaire anglais (environ 150 Ko, inutiles aux visiteurs francophones). Voir index.ts pour le principe.
 */
export type Locale = "fr" | "en";
export const LOCALES: Locale[] = ["fr", "en"];
export const isLocale = (v: unknown): v is Locale => v === "fr" || v === "en";

export type Vars = Record<string, string | number | null | undefined>;
export type T = (fr: string, vars?: Vars) => string;
export type Dictionary = Record<string, string>;

/** Traduction par un dictionnaire (null : français, la langue source). */
export const tFrom =
  (dict: Dictionary | null): T =>
  (fr, vars) => {
    const s = dict?.[fr] ?? fr;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : String(vars[k]))) : s;
  };

/** Locale des fonctions Intl (dates, montants). */
export const intlLocale = (locale: Locale) => (locale === "en" ? "en-GB" : "fr-FR");

/** Date courte (« 3 nov. 2026 » / « 3 Nov 2026 ») à l'heure de Paris. */
export const fmtDate = (locale: Locale, d: Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
  d.toLocaleDateString(intlLocale(locale), { timeZone: "Europe/Paris", ...opts });

/** Date et heure longues (« jeudi 3 novembre 2026 à 18:00 » / « Thursday 3 November 2026 at 18:00 »), heure de Paris. */
export const fmtDateTime = (locale: Locale, d: Date) =>
  d.toLocaleString(intlLocale(locale), { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Heure (« 18:00 »), heure de Paris. */
export const fmtTime = (locale: Locale, d: Date) => d.toLocaleTimeString(intlLocale(locale), { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

/** Montant en euros (« 1 200 € » / « €1,200 »). */
export const fmtEur = (locale: Locale, cents: number) =>
  (cents / 100).toLocaleString(intlLocale(locale), { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 ? 2 : 0 });

/** Nom d'une langue saisie en code (« en » → « Anglais » / « English ») ; un nom déjà écrit reste tel quel. */
export function languageName(code: string, locale: Locale) {
  const c = code.trim();
  if (!/^[a-z]{2,3}(-[a-z]{2})?$/i.test(c)) return c;
  try {
    const name = new Intl.DisplayNames([intlLocale(locale)], { type: "language" }).of(c);
    return name && name.toLowerCase() !== c.toLowerCase() ? name.charAt(0).toLocaleUpperCase(intlLocale(locale)) + name.slice(1) : c;
  } catch {
    return c;
  }
}
