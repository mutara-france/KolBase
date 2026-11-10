import { describe, expect, it } from "vitest";
import { cityKey, cityLabel, regionOf, coversRegion, REGIONS } from "@/lib/regions";

describe("régions des statistiques", () => {
  it("se déduisent du code postal", () => {
    expect(regionOf("69003", "Lyon")).toBe("Auvergne-Rhône-Alpes");
    expect(regionOf("75008", null)).toBe("Île-de-France");
    expect(regionOf("20000", null)).toBe("Corse");
    expect(regionOf("97400", null)).toBe("La Réunion");
    expect(regionOf("06 000", null)).toBe("Provence-Alpes-Côte d'Azur");
  });
  it("à défaut, des principales villes (accents, casse et arrondissements ignorés)", () => {
    expect(regionOf(null, "Saint-Étienne")).toBe("Auvergne-Rhône-Alpes");
    expect(regionOf("", "LYON 3e")).toBe("Auvergne-Rhône-Alpes");
    expect(regionOf(null, "Bordeaux (33000)")).toBe("Nouvelle-Aquitaine");
    expect(regionOf(null, "Village inconnu")).toBeNull();
  });
  it("les villes se regroupent malgré la casse et les arrondissements", () => {
    expect(cityKey("Lyon 3e")).toBe(cityKey("lyon"));
    expect(cityLabel("lyon 7")).toBe("Lyon");
    expect(cityKey("")).toBeNull();
  });
});

describe("zone d'intervention des prestataires", () => {
  it("France entière couvre tout ; sans zone déclarée, on ne sait pas", () => {
    expect(coversRegion({ coverageRegions: [], coverageNational: true }, "Bretagne")).toBe(true);
    expect(coversRegion({ coverageRegions: [], coverageNational: false }, "Bretagne")).toBeNull();
    expect(coversRegion({ coverageRegions: ["Bretagne"], coverageNational: false }, null)).toBeNull();
  });
  it("régions déclarées : couverte ou hors zone", () => {
    expect(coversRegion({ coverageRegions: ["Bretagne", "Pays de la Loire"], coverageNational: false }, "Bretagne")).toBe(true);
    expect(coversRegion({ coverageRegions: ["Bretagne"], coverageNational: false }, "Occitanie")).toBe(false);
  });
  it("la liste des régions suit la table des départements", () => {
    expect(REGIONS).toContain("Île-de-France");
    expect(REGIONS.length).toBe(18);
  });
});
