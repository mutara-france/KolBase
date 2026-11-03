import { describe, expect, it } from "vitest";
import { dpaCurrent, dpaHref, dpaMessage, DPA_VERSION } from "@/lib/dpa";
import { BLOCKED_UNTIL } from "@/lib/billing-plans";
import { interestWarning, isEngaged, isSigned } from "@/lib/projects";

describe("contrat de sous-traitance exigé avant d'engager un tiers", () => {
  it("version en vigueur acceptée ; un prestataire n'en a pas", () => {
    expect(dpaCurrent({ kind: "INDUSTRIEL", dpaVersion: DPA_VERSION })).toBe(true);
    expect(dpaCurrent({ kind: "INDUSTRIEL", dpaVersion: null })).toBe(false);
    expect(dpaCurrent({ kind: "SOCIETE_SAVANTE", dpaVersion: "2020-01" })).toBe(false);
    expect(dpaCurrent({ kind: "PRESTATAIRE", dpaVersion: null })).toBe(true);
  });

  it("lien vers Membres et réglages › Organisation, avec l'action à reprendre", () => {
    expect(dpaHref("o1")).toBe("/organisations/o1/membres?onglet=organisation#sous-traitance");
    expect(dpaHref("o1", "evenement", "ev_1")).toBe("/organisations/o1/membres?onglet=organisation&motif=evenement&objet=ev_1#sous-traitance");
    expect(dpaHref("o1", "appel", "../x")).toBe("/organisations/o1/membres?onglet=organisation&motif=appel#sous-traitance");
  });

  it("message : un administrateur accepte le contrat dans Membres et réglages › Organisation", () => {
    expect(dpaMessage("sollicitation")).toBe("Pour envoyer des sollicitations aux experts, un administrateur de l'organisation doit d'abord accepter le contrat de sous-traitance (RGPD) : Membres et réglages › Organisation.");
    expect(BLOCKED_UNTIL.contrat).toContain("contrat de sous-traitance");
  });
});

describe("suggestions d'experts : liens d'intérêts sans nom d'organisation", () => {
  it("collaboration récente avec une autre entreprise, liens déclarés comptés", () => {
    expect(interestWarning(0, 0)).toBeNull();
    expect(interestWarning(1, 0)).toBe("Liens d'intérêts : collaboration récente avec une autre entreprise");
    expect(interestWarning(3, 0)).toBe("Liens d'intérêts : collaborations récentes avec 3 autres entreprises");
    expect(interestWarning(1, 2)).toBe("Liens d'intérêts : collaboration récente avec une autre entreprise ; 2 liens déclarés par l'expert");
    expect(interestWarning(0, 1)).toBe("Liens d'intérêts : 1 lien déclaré par l'expert");
  });

  it("collaboration = convention signée ; expert engagé = proposition acceptée", () => {
    expect(["SIGNE", "TERMINE"].every(isSigned)).toBe(true);
    expect(["ACCORD", "VALIDE", "SIGNATURE", "ATT_EXPERTS", "DECLINE"].some(isSigned)).toBe(false);
    expect(isEngaged("ACCORD") && isEngaged("SIGNE") && isEngaged("BLOQUE")).toBe(true);
    expect(isEngaged("ATT_EXPERTS") || isEngaged("DECLINE")).toBe(false);
  });
});
