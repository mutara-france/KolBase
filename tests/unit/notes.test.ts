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
