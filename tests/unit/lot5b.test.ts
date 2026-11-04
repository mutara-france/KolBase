import { describe, expect, it } from "vitest";
import { authLink, organisationOrigin, originOf } from "@/lib/safe-redirect";
import { linesTtc, mainVat, quoteTtc, quoteVatLabel, readLines } from "@/lib/quotes";

describe("entrée : page d'origine et profil gardés", () => {
  it("l'en-tête public transmet la page courante, sauf l'accueil et les pages d'authentification", () => {
    expect(originOf("/evenements/abc")).toBe("/evenements/abc");
    expect(originOf("/")).toBe("");
    expect(originOf("/connexion")).toBe("");
    expect(originOf("/inscription")).toBe("");
    expect(originOf("/mot-de-passe-oublie")).toBe("");
    expect(originOf("/mot-de-passe/abc")).toBe("");
    expect(originOf("/confirmer-email/abc")).toBe("");
    expect(originOf("//evil.example")).toBe("");
  });
  it("liens entre pages d'authentification : profil puis page d'origine", () => {
    expect(authLink("/connexion", "")).toBe("/connexion");
    expect(authLink("/connexion", "/evenements")).toBe("/connexion?next=%2Fevenements");
    expect(authLink("/inscription", "/invitation/abc", "organisation")).toBe("/inscription?profil=organisation&next=%2Finvitation%2Fabc");
    expect(authLink("/inscription", null, "organisation")).toBe("/inscription?profil=organisation");
  });
  it("profil « organisation » déduit d'une invitation ou d'une création d'organisation", () => {
    expect(organisationOrigin("/invitation/abc")).toBe(true);
    expect(organisationOrigin("/organisations/nouvelle")).toBe(true);
    expect(organisationOrigin("/evenements")).toBe(false);
    expect(organisationOrigin(undefined)).toBe(false);
  });
});

describe("devis : TVA par ligne", () => {
  const lines = [
    { label: "Repas", qty: 40, unitCents: 3500, vatBp: 1000 },
    { label: "Vin", qty: 10, unitCents: 2000, vatBp: 2000 },
  ];
  it("total TTC : chaque ligne à son taux", () => {
    // 140 000 HT à 10 % + 20 000 HT à 20 %.
    expect(linesTtc(lines, 2000)).toBe(154000 + 24000);
  });
  it("taux du devis : unique, sinon celui du plus gros montant HT", () => {
    expect(mainVat(lines, 2000)).toBe(1000);
    expect(mainVat([{ label: "Salle", qty: 1, unitCents: 100 }], 550)).toBe(550);
  });
  it("lignes antérieures sans taux : celui du devis ; taux invalide ignoré", () => {
    const read = readLines([{ label: "Cocktail", qty: 2, unitCents: 1000 }, { label: "X", qty: 1, unitCents: 100, vatBp: 1234 }]);
    expect(read.every((l) => l.vatBp === undefined)).toBe(true);
    expect(linesTtc(read, 1000)).toBe(2200 + 110);
  });
  it("total enregistré, sinon montant HT au taux du devis ; libellé des taux", () => {
    expect(quoteTtc({ amountCents: 10000, vatBp: 1000, ttcCents: 11500 })).toBe(11500);
    expect(quoteTtc({ amountCents: 10000, vatBp: 1000, ttcCents: null })).toBe(11000);
    expect(quoteVatLabel({ vatBp: 2000, lines })).toBe("10 % et 20 %");
    expect(quoteVatLabel({ vatBp: 550, lines: [] })).toBe("5,5 %");
  });
});
