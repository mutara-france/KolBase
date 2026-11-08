import { describe, expect, it } from "vitest";
import { defaultTopic, isTopic, parseBrands, parseCountries, pickChannel, pickEntity, responseDue, topicLabel } from "@/lib/routing";

const fr = { id: "fr", coveredCountries: ["FR", "MC"], brands: ["Alpha"] };
const be = { id: "be", coveredCountries: ["BE", "LU"], brands: ["Alpha", "Neo"] };
const hq = { id: "hq", coveredCountries: [], brands: ["Neo"] };

describe("Aiguillage vers l'entité d'un groupe", () => {
  it("pays de l'expert, sinon le siège, sinon la première entité", () => {
    expect(pickEntity([fr, be, hq], { country: "FR" })?.id).toBe("fr");
    expect(pickEntity([fr, be, hq], { country: "LU" })?.id).toBe("be");
    expect(pickEntity([fr, be, hq], { country: "CH" })?.id).toBe("hq");
    expect(pickEntity([fr, be], { country: "CH" })?.id).toBe("fr");
    expect(pickEntity([], { country: "FR" })).toBeNull();
  });

  it("marque concernée d'abord, puis le pays dans les entités de la marque", () => {
    expect(pickEntity([fr, be, hq], { country: "FR", brand: "neo" })?.id).toBe("hq");
    expect(pickEntity([fr, be, hq], { country: "BE", brand: "Neo" })?.id).toBe("be");
    expect(pickEntity([fr, be, hq], { country: "FR", brand: "Inconnue" })?.id).toBe("fr");
  });

  it("canal du sujet, sinon « Autre sujet », sinon aucun", () => {
    const chans = [{ topic: "formation", id: 1 }, { topic: "autre", id: 2 }];
    expect(pickChannel(chans, "formation")?.id).toBe(1);
    expect(pickChannel(chans, "innovation")?.id).toBe(2);
    expect(pickChannel([{ topic: "formation", id: 1 }], "innovation")).toBeNull();
  });

  it("réponse attendue : réception plus le délai du canal", () => {
    expect(responseDue(new Date("2026-11-09T10:00:00Z"), 5).toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });
});

describe("Sujets et périmètre", () => {
  it("sujet par défaut selon la catégorie du type de collaboration", () => {
    expect(defaultTopic("Interventions et enseignement")).toBe("formation");
    expect(defaultTopic("Recherche et essais")).toBe("recherche");
    expect(defaultTopic("Production de contenu")).toBe("communication");
    expect(defaultTopic("Conseil et expertise")).toBe("autre");
    expect(isTopic("innovation")).toBe(true);
    expect(isTopic("vente")).toBe(false);
    expect(topicLabel("recherche")).toBe("Recherche clinique et études");
    expect(topicLabel(null)).toBe("Autre sujet");
  });

  it("pays couverts : codes connus, sans doublon ; marques sans doublon", () => {
    const known = (c: string) => ["FR", "BE", "LU", "XX"].includes(c);
    expect(parseCountries("fr, be;BE  lu xx ZZ france", known)).toEqual(["FR", "BE", "LU"]);
    expect(parseBrands("Alpha, Neo; alpha\nBeta")).toEqual(["Alpha", "Neo", "Beta"]);
  });
});
