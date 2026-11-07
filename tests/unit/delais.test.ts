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
