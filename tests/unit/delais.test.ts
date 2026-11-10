import { describe, expect, it } from "vitest";
import { addWorkingDays, daysLate, plannedDate, reviewDue, submissionDue } from "@/lib/deadlines";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

describe("délais internes de la conformité", () => {
  it("compte les jours ouvrés (week-end exclu)", () => {
    expect(addWorkingDays(d("2026-11-06"), 1).toISOString().slice(0, 10)).toBe("2026-11-09"); // vendredi → lundi
    expect(addWorkingDays(d("2026-11-02"), 5).toISOString().slice(0, 10)).toBe("2026-11-09");
  });
  it("échéances de soumission et d'examen, désactivées à 0", () => {
    expect(submissionDue(d("2026-12-31"), { submissionLeadDays: 30 })?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(submissionDue(d("2026-12-31"), { submissionLeadDays: 0 })).toBeNull();
    expect(submissionDue(null, { submissionLeadDays: 30 })).toBeNull();
    expect(reviewDue(d("2026-11-02"), { reviewDays: 5 })?.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(reviewDue(null, { reviewDays: 5 })).toBeNull();
  });
  it("jours de retard", () => {
    expect(daysLate(d("2026-11-01"), d("2026-11-04"))).toBe(3);
    expect(daysLate(d("2026-11-10"), d("2026-11-04"))).toBe(0);
    expect(daysLate(null)).toBe(0);
  });
  it("date d'intervention : celle du dossier, sinon le premier événement non annulé", () => {
    expect(plannedDate({ plannedAt: d("2026-12-01"), events: [{ startsAt: d("2026-11-20") }] })?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(plannedDate({ plannedAt: null, events: [{ startsAt: d("2026-11-25"), cancelledAt: d("2026-11-01") }, { startsAt: d("2026-11-28") }] })?.toISOString().slice(0, 10)).toBe("2026-11-28");
    expect(plannedDate({ plannedAt: null })).toBeNull();
  });
});

describe("jours fériés français", () => {
  it("liste les onze jours fériés, fêtes mobiles comprises", async () => {
    const { frenchHolidays } = await import("@/lib/holidays");
    const days = frenchHolidays(2026).map((x) => x.toISOString().slice(0, 10));
    expect(days).toEqual(["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25"]);
  });
  it("les jours ouvrés sautent les fériés (11 novembre 2026, un mercredi)", () => {
    expect(addWorkingDays(d("2026-11-10"), 1).toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(reviewDue(d("2026-11-09"), { reviewDays: 5 })?.toISOString().slice(0, 10)).toBe("2026-11-17");
  });
  it("jours ouvrables (lundi à samedi, hors fériés) et recul dans le temps", async () => {
    const { isFrenchBusinessDay, isFrenchWorkingDay, shiftDays } = await import("@/lib/holidays");
    expect(isFrenchBusinessDay(d("2026-11-14"))).toBe(true); // samedi
    expect(isFrenchWorkingDay(d("2026-11-14"))).toBe(false);
    expect(isFrenchBusinessDay(d("2026-11-15"))).toBe(false); // dimanche
    expect(isFrenchBusinessDay(d("2026-11-11"))).toBe(false); // férié
    // 8 jours ouvrables avant le mercredi 18 novembre 2026 : 17, 16, 14, 13, 12, 10, 9, 7 → samedi 7 novembre.
    expect(shiftDays(d("2026-11-18"), -8, isFrenchBusinessDay).toISOString().slice(0, 10)).toBe("2026-11-07");
  });
});

describe("échéance de la démarche EPS", () => {
  it("déclaration : 8 jours ouvrables avant l'intervention, fériés exclus", async () => {
    const { epsDue } = await import("@/lib/deadlines");
    const s = { declarationDays: 8, authorizationDays: 60 };
    expect(epsDue(d("2026-11-18"), "declaration", s)?.toISOString().slice(0, 10)).toBe("2026-11-07");
    expect(epsDue(d("2026-11-18"), "autorisation", s)?.toISOString().slice(0, 10)).toBe("2026-09-19");
    expect(epsDue(d("2026-11-18"), "hors_france", s)).toBeNull();
    expect(epsDue(null, "declaration", s)).toBeNull();
    expect(epsDue(d("2026-11-18"), null, s)).toBeNull();
  });
});

describe("réponse d'un expert sollicité", () => {
  it("échéance au délai interne, « sans réponse » au double", async () => {
    const { answerDue, unanswered } = await import("@/lib/deadlines");
    const s = { answerDays: 7 };
    expect(answerDue(d("2026-11-01"), s)?.toISOString().slice(0, 10)).toBe("2026-11-08");
    expect(answerDue(null, s)).toBeNull();
    expect(unanswered(d("2026-11-01"), s, d("2026-11-14"))).toBe(false);
    expect(unanswered(d("2026-11-01"), s, d("2026-11-16"))).toBe(true);
    expect(unanswered(null, s, d("2026-11-16"))).toBe(false);
  });
});
