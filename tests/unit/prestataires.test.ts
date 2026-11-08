import { describe, expect, it } from "vitest";
import { capacityFields, capacityUnit, detailLines, equipmentOptions, readDetails, readQuoteTerms, termsParts } from "@/lib/supplier-profiles";

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

describe("Capacités et services par métier", () => {
  it("un transporteur ne se voit pas demander ses chambres, un traiteur ses places en théâtre", () => {
    const transport = capacityFields(["transport"]).flatMap((g) => g.fields.map((f) => f.key));
    expect(transport).toEqual(["vehicles", "vehicleSeats"]);
    const traiteur = capacityFields(["restauration"]).flatMap((g) => g.fields.map((f) => f.key));
    expect(traiteur).toEqual(["banquet", "cocktail"]);
  });
  it("plusieurs catégories : champs de chacune, sans doublon", () => {
    const g = capacityFields(["restauration", "salle"]);
    expect(g.map((x) => x.category)).toEqual(["restauration", "salle"]);
    expect(g[1].fields.map((f) => f.key)).toEqual(["seats", "classroom", "subrooms"]);
    expect(equipmentOptions(["salle", "hebergement"])[1].options).not.toContain("Parking");
    expect(capacityUnit("vehicleSeats")).toBe("places dans le plus grand véhicule");
  });
});

describe("Questions de la demande de devis", () => {
  it("seules les questions de la catégorie sont gardées, valeurs contrôlées", () => {
    const d = readDetails("restauration", form({ d_format: "cocktail", d_serviceTime: "19:30", d_drinks: "inconnu", d_arrival: "2026-12-01", d_staff: "oui" }));
    expect(d).toEqual({ format: "cocktail", serviceTime: "19:30", staff: "oui" });
    const h = readDetails("hebergement", form({ d_arrival: "2026-12-01", d_departure: "2026-12-03", d_singles: "12", d_doubles: "-1", d_roomingBy: "1er décembre" }));
    expect(h).toEqual({ arrival: "2026-12-01", departure: "2026-12-03", singles: "12" });
    expect(readDetails("salle", form({ d_technique: ["projection", "wifi", "laser"] })).technique).toEqual(["projection", "wifi"]);
  });
  it("réponses lisibles pour le prestataire, dans l'ordre des questions", () => {
    expect(detailLines("restauration", { serviceTime: "19:30", format: "cocktail" })).toEqual([
      { label: "Format", value: "Cocktail", translate: true },
      { label: "Heure de service", value: "19:30", translate: false },
    ]);
    expect(detailLines("hebergement", { roomingBy: "2026-11-20" }, (d) => `le ${d}`)).toEqual([{ label: "Liste des chambres transmise au plus tard le", value: "le 2026-11-20", translate: false }]);
  });
});

describe("Acompte et barème d'annulation", () => {
  it("lecture bornée et cohérente", () => {
    expect(readQuoteTerms(form({ depositPct: "30", cancelFreeDays: "30", cancelMidPct: "50", cancelFullDays: "15" }))).toEqual({ depositPct: 30, cancelFreeDays: 30, cancelMidPct: 50, cancelFullDays: 15 });
    expect(readQuoteTerms(form({}))).toEqual({ depositPct: null, cancelFreeDays: null, cancelMidPct: null, cancelFullDays: null });
    expect("error" in readQuoteTerms(form({ depositPct: "130" }))).toBe(true);
    expect("error" in readQuoteTerms(form({ cancelFreeDays: "10", cancelFullDays: "20" }))).toBe(true);
  });
  it("conditions en clair pour comparer les devis", () => {
    expect(termsParts({ depositPct: 30, cancelFreeDays: 30, cancelMidPct: 50, cancelFullDays: 15 }).map((p) => p.key)).toEqual([
      "acompte de {pct} %", "annulation sans frais jusqu'à J-{days}", "{pct} % dus de J-{from} à J-{to}", "totalité due à moins de J-{days}",
    ]);
    expect(termsParts({ depositPct: null, cancelFreeDays: null, cancelMidPct: null, cancelFullDays: null })).toEqual([]);
  });
});
