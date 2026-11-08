import { describe, expect, it } from "vitest";
import { dietLabel, needsSummary, readNeeds } from "@/lib/registration-needs";
import { eventChanges, eventPlace } from "@/lib/events";
import { eventLocation } from "@/lib/ics";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("Besoins déclarés à l'inscription", () => {
  it("facultatifs : rien de rempli, rien d'enregistré, pas d'accord demandé", () => {
    expect(readNeeds(form({}))).toEqual({ diet: null, allergies: null, needs: null });
  });
  it("un besoin rempli exige l'accord exprès", () => {
    expect(readNeeds(form({ diet: "halal" })).error).toMatch(/Cochez l'accord/);
    expect(readNeeds(form({ allergies: "arachide", needsConsent: "1" }))).toEqual({ diet: null, allergies: "arachide", needs: null });
  });
  it("régime inconnu ignoré, textes bornés et nettoyés", () => {
    const r = readNeeds(form({ diet: "inconnu", needs: `  fauteuil   roulant ${"x".repeat(600)}`, needsConsent: "1" }));
    expect(r.diet).toBeNull();
    expect(r.needs?.startsWith("fauteuil roulant")).toBe(true);
    expect(r.needs?.length).toBe(500);
    expect(dietLabel("sans-gluten")).toBe("Sans gluten");
  });
  it("synthèse sans les noms pour le lieu et le traiteur", () => {
    const s = needsSummary([{ diet: "vegetarien" }, { diet: "vegetarien", allergies: "crustacés" }, { needs: "accès en fauteuil" }, {}]);
    expect(s.diets).toEqual([{ id: "vegetarien", label: "Végétarien", count: 2 }]);
    expect(s.allergies).toEqual(["crustacés"]);
    expect(s.needs).toEqual(["accès en fauteuil"]);
    expect(s.total).toBe(3);
  });
});

describe("Adresse du lieu", () => {
  const e = { venue: "Grand Palais", address: "1 boulevard des Cités Unies", postalCode: "59777", city: "Lille", format: "PRESENTIEL" };
  it("lieu complet : nom, adresse, code postal et ville", () => {
    expect(eventPlace(e)).toBe("Grand Palais, 1 boulevard des Cités Unies, 59777 Lille");
    expect(eventPlace({ venue: null, city: "Lyon" })).toBe("Lyon");
    expect(eventLocation(e)).toBe("Grand Palais, 1 boulevard des Cités Unies, 59777 Lille");
  });
  it("une nouvelle adresse prévient les inscrits (changement de lieu)", () => {
    const before = { startsAt: new Date("2026-12-01T17:00:00Z"), city: "Lille", venue: "Grand Palais", address: "1 bd A", format: "PRESENTIEL", onlineUrl: null };
    expect(eventChanges(before, { ...before, address: "2 rue B" })).toEqual(["lieu"]);
    expect(eventChanges(before, { ...before })).toEqual([]);
  });
});
