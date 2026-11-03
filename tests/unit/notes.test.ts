import { describe, expect, it } from "vitest";
import { billingComplete, feeNotePdf, nextNumber, validIban, validSiret, vatBpOf } from "@/lib/fee-notes";

describe("notes d'honoraires", () => {
  it("contrôle le SIRET (14 chiffres, clé de Luhn)", () => {
    expect(validSiret("999 001 230 00013")).toBe(true);
    expect(validSiret("99900123000014")).toBe(false);
    expect(validSiret("1234")).toBe(false);
  });
  it("contrôle l'IBAN (modulo 97)", () => {
    expect(validIban("FR76 3000 6000 0112 3456 7890 189")).toBe(true);
    expect(validIban("FR76 3000 6000 0112 3456 7890 188")).toBe(false);
    expect(validIban("pas un iban")).toBe(false);
  });
  it("numérote par année, sans trou ni doublon", () => {
    expect(nextNumber(2026, [])).toBe("NH-2026-001");
    expect(nextNumber(2026, ["NH-2026-001", "NH-2026-007", "NH-2025-012"])).toBe("NH-2026-008");
    expect(nextNumber(2027, ["NH-2026-008"])).toBe("NH-2027-001");
  });
  it("exige l'adresse, et le numéro de TVA pour un assujetti", () => {
    const b = { billingEntity: null, billingAddress: "1 rue X", siret: null, vatRegime: "franchise", vatNumber: null, iban: null };
    expect(billingComplete(b)).toBe(true);
    expect(billingComplete({ ...b, billingAddress: " " })).toBe(false);
    expect(billingComplete({ ...b, vatRegime: "assujetti" })).toBe(false);
    expect(vatBpOf("assujetti")).toBe(2000);
    expect(vatBpOf("franchise")).toBe(0);
  });
  it("produit un PDF", async () => {
    const bytes = await feeNotePdf({
      number: "NH-2026-001", issuedAt: new Date("2026-11-03T10:00:00Z"), amountCents: 90000, vatBp: 0, totalCents: 90000,
      data: {
        issuer: { name: "Dr Camille Petit", entity: null, address: "12 rue de la Fosse\n44000 Nantes", siret: "99900123000013", vatNumber: null, rpps: null, iban: null, vatRegime: "franchise" },
        recipient: { name: "OrthoNova", siren: null, address: "Nantes, France" },
        object: { title: "Webinaire", type: "Webinaire", unit: "session", units: 1, signedAt: null, projectRef: "ABC" },
      },
    });
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("déclaration Transparence Santé", async () => {
  const { parseSemester, recentSemesters, semesterKey, semesterOf, semesterRange, COLUMNS, CONVENTION_OBJECT } = await import("@/lib/transparence-shared");
  it("découpe l'année en semestres", () => {
    expect(semesterKey(semesterOf(new Date(2026, 10, 3)))).toBe("2026-S2");
    expect(semesterKey(semesterOf(new Date(2026, 5, 30)))).toBe("2026-S1");
    expect(parseSemester("2026-S3")).toBeNull();
    const r = semesterRange({ year: 2026, half: 2 });
    expect(r.gte.getMonth()).toBe(6);
    expect(r.lt.getFullYear()).toBe(2027);
    expect(recentSemesters(new Date(2026, 10, 3)).map(semesterKey)).toEqual(["2026-S2", "2026-S1", "2025-S2", "2025-S1"]);
  });
  it("utilise les libellés de la plateforme", () => {
    expect(COLUMNS).toContain("Identifiant unique");
    expect(COLUMNS).toContain("Convention liée");
    expect(CONVENTION_OBJECT.dpc).toBe("Formation");
    expect(CONVENTION_OBJECT.symposium).toBe("Contrat d'intervenant à une manifestation");
  });
});
