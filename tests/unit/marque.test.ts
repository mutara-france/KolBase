import { describe, expect, it } from "vitest";
import { asBrandColor, asBrandDomain, brandPalette, contrastWithWhite, hostOf, MIN_CONTRAST } from "@/lib/brand";
import { orgMenuLinks } from "@/lib/nav";

describe("KolBase Business : marque et nom de domaine", () => {
  it("lit l'hôte d'une requête", () => {
    expect(hostOf("KOL.Exemple.com:443")).toBe("kol.exemple.com");
    expect(hostOf("kol.exemple.com., autre.fr")).toBe("kol.exemple.com");
    expect(hostOf(null)).toBe("");
  });
  it("accepte un sous-domaine de l'organisation, sous n'importe quelle écriture", () => {
    expect(asBrandDomain(" https://KOL.Exemple-Dentaire.com/accueil?x=1 ", "kolbase.io")).toEqual({ domain: "kol.exemple-dentaire.com" });
    expect(asBrandDomain("experts.groupe.exemple.co.uk.", "kolbase.io")).toEqual({ domain: "experts.groupe.exemple.co.uk" });
  });
  it("refuse la racine d'un domaine, les noms invalides et les adresses réservées", () => {
    expect(asBrandDomain("exemple.com", "kolbase.io")).toEqual({ refusal: "sous-domaine" });
    for (const bad of ["", "localhost", "kol..exemple.com", "-kol.exemple.com", "kol.exemple.com:8080", "kol exemple.com", "10.0.0.1", "192.168.1.1", "kol.exemple.c_m", `${"a".repeat(64)}.exemple.com`]) expect(asBrandDomain(bad, "kolbase.io"), bad).toEqual({ refusal: "format" });
    for (const reserved of ["app.kolbase.io", "www.kolbase.io", "kolbase-web.onrender.com", "autre.service.onrender.com", "client.app.exemple-hote.fr"]) expect(asBrandDomain(reserved, "app.exemple-hote.fr"), reserved).toEqual({ refusal: "reserve" });
  });
  it("n'accepte qu'une couleur lisible sous un texte blanc", () => {
    expect(asBrandColor(" #1A2B3C ")).toBe("#1a2b3c");
    expect(asBrandColor("rouge")).toBeNull();
    expect(asBrandColor("#12345")).toBeNull();
    expect(contrastWithWhite("#1800ab")).toBeGreaterThan(MIN_CONTRAST);
    expect(contrastWithWhite("#ffe066")).toBeLessThan(MIN_CONTRAST);
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
  });
  it("dérive les teintes de la marque de sa couleur principale", () => {
    const p = brandPalette("#006644");
    expect(p["--outremer"]).toBe("#006644");
    // Teinte sombre plus contrastée que la couleur, teinte claire presque blanche.
    expect(contrastWithWhite(p["--outremer-deep"])).toBeGreaterThan(contrastWithWhite("#006644"));
    expect(contrastWithWhite(p["--tint"])).toBeLessThan(1.3);
    expect(Object.values(p).every((v) => /^#[0-9a-f]{6}$/.test(v))).toBe(true);
  });
  it("le réglage de la marque est proposé aux administrateurs, pas aux prestataires", () => {
    expect(orgMenuLinks("o1", ["ADMIN"], "INDUSTRIEL").map((l) => l.href)).toContain("/organisations/o1/marque");
    expect(orgMenuLinks("o1", ["ADMIN"], "SOCIETE_SAVANTE").map((l) => l.href)).toContain("/organisations/o1/marque");
    expect(orgMenuLinks("o1", ["PROJETS"], "INDUSTRIEL").map((l) => l.href)).not.toContain("/organisations/o1/marque");
    expect(orgMenuLinks("o1", ["ADMIN"], "PRESTATAIRE").map((l) => l.href)).not.toContain("/organisations/o1/marque");
  });
});
