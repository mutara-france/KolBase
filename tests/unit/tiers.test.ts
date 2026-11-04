import { describe, expect, it } from "vitest";
import { canCancelRfq, rfqConflict, rfqView } from "@/lib/suppliers";

describe("confidentialité des devis : agence consultée sur l'événement qu'elle pilote", () => {
  const rfq = {
    id: "r1",
    suppliers: [{ supplierId: "agence" }, { supplierId: "traiteur" }],
    quotes: [{ supplierId: "traiteur", amountCents: 100 }, { supplierId: "agence", amountCents: 200 }],
    messages: [{ supplierId: "traiteur", body: "question" }, { supplierId: "agence", body: "ma question" }],
  };
  it("conflit dès que l'organisation de l'utilisateur figure parmi les prestataires consultés", () => {
    expect(rfqConflict(["agence", "traiteur"], ["agence"])).toBe(true);
    expect(rfqConflict(["traiteur"], ["agence"])).toBe(false);
    expect(rfqConflict(["traiteur"], [])).toBe(false);
  });
  it("en conflit : seulement son devis, ses échanges et sa ligne de prestataire", () => {
    const v = rfqView(rfq, ["agence"]);
    expect(v.conflicted).toBe(true);
    expect(v.quotes.map((q) => q.supplierId)).toEqual(["agence"]);
    expect(v.messages.map((m) => m.body)).toEqual(["ma question"]);
    expect(v.suppliers.map((s) => s.supplierId)).toEqual(["agence"]);
  });
  it("sans conflit : la demande entière", () => {
    const v = rfqView(rfq, ["autre"]);
    expect(v.conflicted).toBe(false);
    expect(v.quotes).toHaveLength(2);
    expect(v.messages).toHaveLength(2);
  });
  it("annuler : organisateurs ou auteur de la demande, jamais en conflit d'intérêts", () => {
    expect(canCancelRfq({ organizer: true, author: false, conflicted: false })).toBe(true);
    expect(canCancelRfq({ organizer: false, author: true, conflicted: false })).toBe(true);
    expect(canCancelRfq({ organizer: false, author: false, conflicted: false })).toBe(false);
    expect(canCancelRfq({ organizer: true, author: true, conflicted: true })).toBe(false);
  });
});
