import { describe, expect, it } from "vitest";
import { computedFee, effectiveHourly, hoursDetail, hoursOf, parseHours } from "@/lib/fees";

describe("grille de rémunération et volume horaire", () => {
  it("additionne préparation, intervention et déplacement", () => {
    expect(hoursOf({ prepHours: 4, interventionHours: 6, travelHours: 2 })).toBe(12);
    expect(hoursOf({ prepHours: null, interventionHours: 1.5 })).toBe(1.5);
    expect(hoursOf({})).toBeNull();
  });
  it("lit les heures au quart d'heure, virgule acceptée", () => {
    expect(parseHours("1,5")).toBe(1.5);
    expect(parseHours("2.3")).toBe(2.25);
    expect(parseHours("")).toBeNull();
    expect(parseHours("-1")).toBeUndefined();
    expect(parseHours("abc")).toBeUndefined();
  });
  it("calcule les honoraires et le taux horaire réel", () => {
    expect(computedFee(12, 15000)).toBe(180000);
    expect(computedFee(null, 15000)).toBeNull();
    expect(effectiveHourly(180000, 12)).toBe(150);
    expect(effectiveHourly(100000, null)).toBeNull();
  });
  it("détaille le volume horaire", () => {
    const t = (k: string, v?: Record<string, string | number>) => k.replace(/\{(\w+)\}/g, (_, x: string) => String(v?.[x] ?? ""));
    expect(hoursDetail({ prepHours: 4, interventionHours: 1.5 }, t)).toBe("4 h de préparation, 1,5 h d'intervention");
  });
});
