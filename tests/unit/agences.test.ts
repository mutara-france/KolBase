import { describe, expect, it } from "vitest";
import { isAgencyOnly } from "@/lib/org-roles";
import { orgMenuLinks } from "@/lib/nav";
import { de, elides } from "@/lib/elision";

describe("agence mandatée dans l'espace d'un client", () => {
  it("seul le rôle « Agence mandatée » dans une organisation cliente", () => {
    expect(isAgencyOnly(["PRESTATAIRE"], "INDUSTRIEL")).toBe(true);
    expect(isAgencyOnly(["PRESTATAIRE", "PROJETS"], "INDUSTRIEL")).toBe(false);
    expect(isAgencyOnly(["PRESTATAIRE"], "PRESTATAIRE")).toBe(false);
    expect(isAgencyOnly([], "INDUSTRIEL")).toBe(false);
  });
  it("ni abonnement ni « Voir notre page publique » dans le menu de l'agence", () => {
    const links = orgMenuLinks("o1", ["PRESTATAIRE"], "INDUSTRIEL").map((l) => l.href);
    expect(links).not.toContain("/structures/o1");
    expect(links).not.toContain("/organisations/o1/abonnement");
    expect(orgMenuLinks("o1", ["PROJETS"], "INDUSTRIEL").map((l) => l.href)).toContain("/structures/o1");
  });
});

describe("élision de « de » devant un nom", () => {
  it("voyelles et h muet courants", () => {
    expect(de("Académie Odonto Formation")).toBe("d'Académie Odonto Formation");
    expect(de("Agence Médiane Événements")).toBe("d'Agence Médiane Événements");
    expect(de("Hôtel Rive Gauche")).toBe("d'Hôtel Rive Gauche");
    expect(de("Espace Confluence")).toBe("d'Espace Confluence");
    expect(de("OrthoNova")).toBe("d'OrthoNova");
  });
  it("consonnes, Y et h aspiré gardent « de »", () => {
    expect(de("Dentalys Implants")).toBe("de Dentalys Implants");
    expect(de("Yousign")).toBe("de Yousign");
    expect(de("Hachette Santé")).toBe("de Hachette Santé");
    expect(elides("  Univers Dentaire")).toBe(true);
  });
  it("article contracté devant « Le » et « Les »", () => {
    expect(de("Les Tables du Sud")).toBe("des Tables du Sud");
    expect(de("Le Petit Traiteur")).toBe("du Petit Traiteur");
    expect(de("La Poste")).toBe("de La Poste");
  });
});
