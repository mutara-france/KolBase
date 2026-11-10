/**
 * Délais internes de la conformité (réglés dans ses paramètres) : un dossier se soumet au plus tard N jours avant
 * l'intervention, et la conformité l'examine en N jours ouvrés. Échéances affichées dans les dossiers, l'espace
 * conformité et les actions à faire ; un examen en retard est relancé une fois par jour.
 */

import { isFrenchBusinessDay, isFrenchWorkingDay, shiftDays } from "@/lib/holidays";

const DAY = 86400e3;

/** Date d'intervention d'un dossier : celle saisie, sinon le premier événement du dossier. */
export function plannedDate(p: { plannedAt: Date | null; events?: { startsAt: Date; cancelledAt?: Date | null }[] }): Date | null {
  if (p.plannedAt) return p.plannedAt;
  const next = (p.events ?? []).filter((e) => !e.cancelledAt).map((e) => e.startsAt).sort((a, b) => a.getTime() - b.getTime());
  return next[0] ?? null;
}

/** Ajoute des jours ouvrés (lundi à vendredi, hors jours fériés français : voir lib/holidays). */
export const addWorkingDays = (d: Date, n: number): Date => shiftDays(d, Math.max(0, n), isFrenchWorkingDay);

/** Échéance de soumission à la conformité (null sans date d'intervention ou sans délai réglé). */
export function submissionDue(planned: Date | null, s: { submissionLeadDays: number }) {
  return planned && s.submissionLeadDays > 0 ? new Date(planned.getTime() - s.submissionLeadDays * DAY) : null;
}

/** Échéance d'examen par la conformité (null sans soumission ou sans délai réglé). */
export function reviewDue(submittedAt: Date | null, s: { reviewDays: number }) {
  return submittedAt && s.reviewDays > 0 ? addWorkingDays(submittedAt, s.reviewDays) : null;
}

/** Jours de retard (entiers, 0 si l'échéance n'est pas passée). */
export const daysLate = (due: Date | null, now = new Date()) => (due && now > due ? Math.ceil((now.getTime() - due.getTime()) / DAY) : 0);

/**
 * Dernier jour pour la démarche EPS d'un dossier (décret n° 2020-730, articles R.1453-3 et R.1453-9) : déclaration au
 * plus tard N jours ouvrables (lundi à samedi, hors fériés) avant l'exécution, demande d'autorisation au moins N jours
 * avant. Null sans date d'intervention ou pour un dossier hors du dispositif (experts exerçant hors de France).
 */
export function epsDue(planned: Date | null, regime: "declaration" | "autorisation" | "hors_france" | null | undefined, s: { declarationDays: number; authorizationDays: number }): Date | null {
  if (!planned || !regime || regime === "hors_france") return null;
  if (regime === "declaration") return shiftDays(planned, -s.declarationDays, isFrenchBusinessDay);
  return new Date(planned.getTime() - s.authorizationDays * DAY);
}

/** Dernier jour attendu pour la réponse d'un expert sollicité (délai interne, jours civils à partir de la sollicitation). */
export function answerDue(solicitedAt: Date | null, s: { answerDays: number }): Date | null {
  return solicitedAt ? new Date(solicitedAt.getTime() + s.answerDays * DAY) : null;
}

/** Sollicitation « sans réponse » : silence de l'expert au-delà du double du délai interne. */
export function unanswered(solicitedAt: Date | null, s: { answerDays: number }, now = new Date()): boolean {
  return !!solicitedAt && now.getTime() - solicitedAt.getTime() > 2 * s.answerDays * DAY;
}
