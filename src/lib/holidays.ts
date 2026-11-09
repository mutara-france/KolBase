/**
 * Jours fériés et jours ouvrés (module pur, dates à minuit UTC). Les délais réglementaires se comptent en jours
 * ouvrables ou ouvrés : un week-end ou un jour férié oublié décale l'échéance d'un jour, dans le mauvais sens.
 */

const DAY = 86400e3;

/** Dimanche de Pâques (calendrier grégorien, algorithme dit « anonyme »). */
export function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Jours fériés légaux en France métropolitaine (article L.3133-1 du code du travail) : 1er janvier, lundi de Pâques,
 * 1er et 8 mai, Ascension, lundi de Pentecôte, 14 juillet, 15 août, Toussaint, 11 novembre, Noël.
 */
export function frenchHolidays(year: number): Date[] {
  const e = easter(year).getTime();
  const fixed = [[1, 1], [5, 1], [5, 8], [7, 14], [8, 15], [11, 1], [11, 11], [12, 25]].map(([m, d]) => new Date(Date.UTC(year, m - 1, d)));
  return [...fixed, new Date(e + DAY), new Date(e + 39 * DAY), new Date(e + 50 * DAY)].sort((x, y) => x.getTime() - y.getTime());
}

/** Jour civil (UTC) d'une date, pour comparer à une liste de jours fériés quelle que soit l'heure. */
const dayKey = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

const cache = new Map<string, Set<number>>();
function holidaySet(list: (year: number) => Date[], name: string, year: number): Set<number> {
  const key = `${name}:${year}`;
  if (!cache.has(key)) cache.set(key, new Set(list(year).map((h) => h.getTime())));
  return cache.get(key)!;
}

/** Jour férié français ? (jour civil UTC) */
export const isFrenchHoliday = (d: Date) => holidaySet(frenchHolidays, "fr", d.getUTCFullYear()).has(dayKey(d));

/** Jour ouvré en France : du lundi au vendredi, hors jours fériés. */
export function isFrenchWorkingDay(d: Date): boolean {
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6 && !isFrenchHoliday(d);
}

/** Jour ouvrable en France : du lundi au samedi, hors jours fériés (délais du code de la santé publique). */
export function isFrenchBusinessDay(d: Date): boolean {
  return d.getUTCDay() !== 0 && !isFrenchHoliday(d);
}

/** Avance (n > 0) ou recule (n < 0) de |n| jours vérifiant `counts`, l'heure de la date étant conservée. */
export function shiftDays(d: Date, n: number, counts: (x: Date) => boolean): Date {
  const out = new Date(d);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(Math.round(n));
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() + step);
    if (counts(out)) left--;
  }
  return out;
}
