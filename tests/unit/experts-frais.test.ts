import { describe, expect, it } from "vitest";
import {
  expenseCap, expenseCategoryLabel, expenseOverCap, expensesOpen, expenseStatus, expenseTotals, EXPENSE_NATURE_FR, frameworkPeriodError,
  frameworkStart, frameworkUsage, isExpenseCategory, missionError,
} from "@/lib/expert-costs";
import { DEFAULT_COMPLIANCE } from "@/lib/compliance";
import { CONVENTION_OBJECT } from "@/lib/transparence-shared";

const day = (s: string) => new Date(`${s}T12:00:00Z`);

describe("Notes de frais des experts", () => {
  it("natures connues, libellé par défaut", () => {
    expect(isExpenseCategory("transport")).toBe(true);
    expect(isExpenseCategory("cadeau")).toBe(false);
    expect(expenseCategoryLabel("hebergement")).toBe("Hébergement");
    expect(expenseCategoryLabel("inconnu")).toBe("Autre frais");
    expect(expenseStatus("paid")).toBe("paid");
    expect(expenseStatus("bizarre")).toBe("submitted");
  });

  it("ouvertes à l'expert engagé, de la signature à la clôture", () => {
    expect(expensesOpen("SIGNATURE", "SIGNATURE")).toBe(true);
    expect(expensesOpen("SIGNE", "SIGNE")).toBe(true);
    expect(expensesOpen("TERMINE", "TERMINE")).toBe(true);
    expect(expensesOpen("VALIDE", "VALIDE")).toBe(false);
    expect(expensesOpen("ATT_EXPERTS", "SIGNE")).toBe(false);
    expect(expensesOpen("DECLINE", "SIGNE")).toBe(false);
  });

  it("plafonds : hospitalités de l'organisation en France, Mdeon en Belgique, par nuit", () => {
    expect(expenseCap("hebergement", "FR", DEFAULT_COMPLIANCE)).toBe(150);
    expect(expenseCap("hebergement", "FR", DEFAULT_COMPLIANCE, 2)).toBe(300);
    expect(expenseCap("hebergement", "BE", DEFAULT_COMPLIANCE)).toBe(250);
    expect(expenseCap("repas", "FR", DEFAULT_COMPLIANCE)).toBe(50);
    expect(expenseCap("repas", "BE", DEFAULT_COMPLIANCE)).toBe(90);
    expect(expenseCap("transport", "FR", DEFAULT_COMPLIANCE)).toBeNull();
    expect(expenseOverCap({ category: "repas", amountCents: 6200 }, "FR", DEFAULT_COMPLIANCE)).toEqual({ amount: 62, cap: 50 });
    expect(expenseOverCap({ category: "repas", amountCents: 6200 }, "BE", DEFAULT_COMPLIANCE)).toBeNull();
    expect(expenseOverCap({ category: "hebergement", amountCents: 28000 }, "FR", DEFAULT_COMPLIANCE, 2)).toBeNull();
  });

  it("totaux par statut ; engagé = accepté + remboursé", () => {
    const t = expenseTotals([
      { status: "submitted", amountCents: 1000 }, { status: "approved", amountCents: 2500 }, { status: "paid", amountCents: 4000 }, { status: "rejected", amountCents: 900 },
    ]);
    expect(t).toEqual({ submitted: 1000, approved: 2500, paid: 4000, rejected: 900, engaged: 6500 });
  });

  it("nature Transparence Santé de chaque frais", () => {
    expect(EXPENSE_NATURE_FR.transport).toBe("Frais de transport");
    expect(EXPENSE_NATURE_FR.hebergement).toBe("Hospitalité - hébergement");
    expect(EXPENSE_NATURE_FR.repas).toBe("Hospitalité - restauration");
    expect(Object.keys(CONVENTION_OBJECT).length).toBeGreaterThan(0);
  });
});

describe("Contrat-cadre", () => {
  it("période : une fin, après le début, douze mois au plus", () => {
    const start = day("2026-12-01");
    expect(frameworkPeriodError(start, null)).toMatch(/fin de la période/);
    expect(frameworkPeriodError(start, day("2026-11-30"))).toMatch(/suivre/);
    expect(frameworkPeriodError(start, day("2027-12-01"))).toBeNull();
    expect(frameworkPeriodError(start, day("2027-12-03"))).toMatch(/douze mois/);
  });

  it("début : date d'intervention prévue, sinon création du dossier", () => {
    expect(frameworkStart({ plannedAt: day("2027-01-10"), createdAt: day("2026-11-08") })).toEqual(day("2027-01-10"));
    expect(frameworkStart({ plannedAt: null, createdAt: day("2026-11-08") })).toEqual(day("2026-11-08"));
  });

  it("unités consommées et restantes", () => {
    expect(frameworkUsage(4, [{ units: 1 }, { units: 0.5 }])).toEqual({ used: 1.5, planned: 4, remaining: 2.5, over: false });
    expect(frameworkUsage(null, [{ units: 1 }])).toEqual({ used: 1, planned: 0, remaining: 0, over: true });
  });

  it("mission : dans la période et les unités restantes, sinon un avenant", () => {
    const period = { start: day("2026-12-01"), end: day("2027-06-30") };
    expect(missionError({ date: day("2027-01-15"), units: 1 }, period, 2)).toBeNull();
    expect(missionError({ date: day("2026-11-30"), units: 1 }, period, 2)).toMatch(/pendant la période/);
    expect(missionError({ date: day("2027-07-01"), units: 1 }, period, 2)).toMatch(/pendant la période/);
    expect(missionError({ date: day("2027-01-15"), units: 3 }, period, 2)).toMatch(/avenant/);
    expect(missionError({ date: day("2027-01-15"), units: 0 }, period, 2)).toMatch(/invalide/);
  });
});
