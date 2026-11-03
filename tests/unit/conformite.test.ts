import { describe, expect, it } from "vitest";
import { dpaCurrent, dpaHref, dpaMessage, DPA_VERSION } from "@/lib/dpa";
import { BLOCKED_UNTIL } from "@/lib/billing-plans";

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
