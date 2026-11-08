/**
 * Praticiens exerçant en Belgique : article 10 de la loi du 25 mars 1964 sur les médicaments (dispositifs médicaux
 * compris) et code de déontologie de Mdeon. Une entreprise, belge ou étrangère, qui offre l'hospitalité d'une
 * manifestation scientifique de plusieurs jours calendrier consécutifs (une nuitée en fait partie) à un praticien
 * exerçant en Belgique doit obtenir au préalable un visa de Mdeon, demandé au plus tard le 15e jour ouvrable avant le
 * premier jour de la manifestation ; le numéro de visa figure dans la correspondance avec le praticien. Plafonds de
 * l'hospitalité « raisonnable » (FAQ Mdeon du 29 janvier 2025, TVA comprise) : déjeuner 45 €, dîner 90 €, pause café
 * 23 €, nuitée 250 € petit-déjeuner compris. Ces règles sont une aide : elles ne valent pas conseil juridique.
 */
import { practicesInFrance } from "@/lib/countries";

const DAY = 86400e3;
const TZ = "Europe/Brussels";

/** Date du jour (minuit UTC) à Bruxelles : sert aux calculs en jours calendaires. */
function localDay(d: Date): Date {
  const [y, m, day] = d.toLocaleDateString("en-CA", { timeZone: TZ }).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

/** Dimanche de Pâques (calendrier grégorien, algorithme dit « anonyme »). */
function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Jours fériés légaux belges d'une année (dates à minuit UTC). */
export function belgianHolidays(year: number): Date[] {
  const e = easter(year).getTime();
  const fixed = [[1, 1], [5, 1], [7, 21], [8, 15], [11, 1], [11, 11], [12, 25]].map(([m, d]) => new Date(Date.UTC(year, m - 1, d)));
  return [...fixed, new Date(e + DAY), new Date(e + 39 * DAY), new Date(e + 50 * DAY)].sort((x, y) => x.getTime() - y.getTime());
}

const holidayKeys = new Map<number, Set<number>>();
function isWorkingDay(d: Date): boolean {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  const y = d.getUTCFullYear();
  if (!holidayKeys.has(y)) holidayKeys.set(y, new Set(belgianHolidays(y).map((h) => h.getTime())));
  return !holidayKeys.get(y)!.has(d.getTime());
}

/** Dernier jour pour demander le visa : 15e jour ouvrable (lundi à vendredi, hors jours fériés) avant le premier jour. */
export function mdeonDeadline(startsAt: Date, workingDays = 15): Date {
  let d = localDay(startsAt);
  let left = workingDays;
  while (left > 0) {
    d = new Date(d.getTime() - DAY);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

/** La manifestation couvre plusieurs jours calendrier (fin un autre jour que le début, à Bruxelles). */
export function spansSeveralDays(startsAt: Date, durationMinutes: number | null | undefined): boolean {
  if (!durationMinutes || durationMinutes <= 0) return false;
  return localDay(new Date(startsAt.getTime() + durationMinutes * 60e3)).getTime() > localDay(startsAt).getTime();
}

/** Plafonds Mdeon par prestation du catalogue (€ TVA comprise). */
export const MDEON_CAPS: Record<string, { max: number; label: string }> = {
  cafe: { max: 23, label: "pause café" },
  dejeuner: { max: 45, label: "déjeuner" },
  cocktail: { max: 90, label: "dîner" },
  nuitee: { max: 250, label: "nuitée" },
};

type EventLike = { startsAt: Date; durationMinutes: number | null; benefits: { catalogId: string; valueCents: number }[]; organization: { kind: string } };

/**
 * Visa Mdeon à obtenir avant d'offrir l'hospitalité à un praticien exerçant en Belgique : événement d'une entreprise
 * (industriel), avec hospitalité, sur plusieurs jours ou avec une nuitée.
 */
export function mdeonRequired(e: EventLike): boolean {
  if (e.organization.kind !== "INDUSTRIEL" || e.benefits.length === 0) return false;
  return spansSeveralDays(e.startsAt, e.durationMinutes) || e.benefits.some((b) => b.catalogId === "nuitee");
}

/** Prestations au-delà des plafonds Mdeon (Mdeon refuserait le visa). */
export function mdeonOverCaps(benefits: { catalogId: string; label: string; valueCents: number }[]) {
  return benefits.flatMap((b) => {
    const cap = MDEON_CAPS[b.catalogId];
    return cap && b.valueCents / 100 > cap.max ? [{ label: b.label, value: b.valueCents / 100, max: cap.max }] : [];
  });
}

/** Numéro de visa saisi : lettres, chiffres, tirets et barres (20 à 40 caractères au plus en pratique). */
export const normalizeVisa = (v: string) => v.trim().replace(/\s+/g, " ").slice(0, 60);

export const isStudent = (profession: string | null | undefined) => !!profession && /^Étudiant/.test(profession);

/**
 * Ce qu'une personne peut accepter comme hospitalité à l'inscription :
 * - « fr » : praticien exerçant en France (dispositif anti-cadeaux, Transparence Santé) ;
 * - « student » : étudiant en France, l'hospitalité lui est interdite (arrêté du 7 août 2020) ;
 * - « be » : praticien exerçant en Belgique (betransparent.be, visa Mdeon si requis et obtenu) ;
 * - « be_no_visa » : praticien exerçant en Belgique, visa requis mais pas encore communiqué : inscription sans hospitalité ;
 * - « other » : autre pays ; « none » : compte sans profil de praticien.
 */
export type HospitalityGate = "fr" | "student" | "be" | "be_no_visa" | "other" | "none";

export function hospitalityGate(
  p: { profession: string | null; country: string | null } | null | undefined,
  e: EventLike & { mdeonVisa: string | null },
): HospitalityGate {
  if (!p) return "none";
  if (practicesInFrance(p.country)) return isStudent(p.profession) ? "student" : "fr";
  if (p.country === "BE") return mdeonRequired(e) && !e.mdeonVisa ? "be_no_visa" : "be";
  return "other";
}

/** L'inscription peut porter des hospitalités acceptées. */
export const canAcceptHospitality = (g: HospitalityGate) => g !== "student" && g !== "be_no_visa";
