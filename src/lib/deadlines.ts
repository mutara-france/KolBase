/**
 * Délais internes de la conformité (réglés dans ses paramètres) : un dossier se soumet au plus tard N jours avant
 * l'intervention, et la conformité l'examine en N jours ouvrés. Échéances affichées dans les dossiers, l'espace
 * conformité et les actions à faire ; un examen en retard est relancé une fois par jour.
 */

import { isFrenchWorkingDay, shiftDays } from "@/lib/holidays";

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
