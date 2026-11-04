/**
 * Traductions de l'interface (français / anglais).
 *
 * Le français est la langue source : chaque texte s'écrit en français dans le code, entouré de t(…),
 * et sa traduction anglaise figure dans src/lib/i18n/en/*.ts sous la même clé (le texte français exact).
 * Un texte sans traduction s'affiche en français : on peut traduire écran par écran.
 * Variables : t("{n} praticiens", { n: 3 }). Le pluriel se choisit dans le code (deux clés).
 */
import { EN } from "@/lib/i18n/en";

export type Locale = "fr" | "en";
export const LOCALES: Locale[] = ["fr", "en"];
export const isLocale = (v: unknown): v is Locale => v === "fr" || v === "en";

export type Vars = Record<string, string | number | null | undefined>;
export type T = (fr: string, vars?: Vars) => string;

export function translate(locale: Locale, fr: string, vars?: Vars): string {
  const s = locale === "en" ? (EN[fr] ?? fr) : fr;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : String(vars[k]))) : s;
}

export const makeT = (locale: Locale): T => (fr, vars) => translate(locale, fr, vars);

/** Locale des fonctions Intl (dates, montants). */
export const intlLocale = (locale: Locale) => (locale === "en" ? "en-GB" : "fr-FR");

/** Date courte (« 3 nov. 2026 » / « 3 Nov 2026 ») à l'heure de Paris. */
export const fmtDate = (locale: Locale, d: Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
  d.toLocaleDateString(intlLocale(locale), { timeZone: "Europe/Paris", ...opts });

/** Montant en euros (« 1 200 € » / « €1,200 »). */
export const fmtEur = (locale: Locale, cents: number) =>
  (cents / 100).toLocaleString(intlLocale(locale), { style: "currency", currency: "EUR", maximumFractionDigits: cents % 100 ? 2 : 0 });
