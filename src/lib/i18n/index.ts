/**
 * Traductions de l'interface (français / anglais).
 *
 * Le français est la langue source : chaque texte s'écrit en français dans le code, entouré de t(…),
 * et sa traduction anglaise figure dans src/lib/i18n/en/*.ts sous la même clé (le texte français exact).
 * Un texte sans traduction s'affiche en français : on peut traduire écran par écran.
 * Variables : t("{n} praticiens", { n: 3 }). Le pluriel se choisit dans le code (deux clés).
 *
 * Ce module importe le dictionnaire : côté serveur seulement (pages, e-mails). Les composants client importent
 * « @/lib/i18n/core » et reçoivent le dictionnaire par I18nProvider, chargé pour les seuls anglophones.
 */
import { EN } from "@/lib/i18n/en";
import { type Locale, tFrom, type T, type Vars } from "@/lib/i18n/core";

export * from "@/lib/i18n/core";

const BY_LOCALE: Record<Locale, T> = { fr: tFrom(null), en: tFrom(EN) };

export const translate = (locale: Locale, fr: string, vars?: Vars): string => BY_LOCALE[locale](fr, vars);

export const makeT = (locale: Locale): T => BY_LOCALE[locale];
