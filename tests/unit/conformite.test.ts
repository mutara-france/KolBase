import { describe, expect, it } from "vitest";
import { dpaCurrent, dpaHref, dpaMessage, DPA_VERSION } from "@/lib/dpa";
import { BLOCKED_UNTIL } from "@/lib/billing-plans";
import { interestWarning, isEngaged, isSigned } from "@/lib/projects";
import { benefitLimit, complianceSettings, hospitalityRegime } from "@/lib/compliance";
import { hospitalityRegimeClause } from "@/lib/convention-pdf";
import { makeT } from "@/lib/i18n";
import { costHeadcount, expertSplit, feeTotals, isAbsent, speakerConfirmed, toDeclare } from "@/lib/indicators";

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

describe("seuils d'hospitalité visibles à la saisie et dans les conventions", () => {
  const s = complianceSettings({});
  it("seuil propre à chaque prestation ; le transport ne compte que dans le total", () => {
    expect(benefitLimit(s, "nuitee")).toEqual({ max: 150, per: "par nuitée" });
    expect(benefitLimit(s, "dejeuner")?.max).toBe(50);
    expect(benefitLimit(s, "cocktail")?.max).toBe(50);
    expect(benefitLimit(s, "cafe")?.max).toBe(15);
    expect(benefitLimit(s, "transport")).toBeNull();
    expect(benefitLimit(complianceSettings({ hospitalityNightMax: 120 }), "nuitee")?.max).toBe(120);
  });

  it("régime par prestation : son seuil et le total", () => {
    expect(hospitalityRegime(s, [{ catalogId: "nuitee", valueCents: 18000 }])).toEqual({ regime: "autorisation", reason: "Nuitée 180 € > 150 €" });
    expect(hospitalityRegime(s, [{ catalogId: "transport", valueCents: 250000 }]).regime).toBe("autorisation");
    expect(hospitalityRegime(s, [{ catalogId: "transport", valueCents: 9500 }]).regime).toBe("declaration");
  });

  it("convention : « déclarée » ou « soumise à autorisation »", () => {
    const t = makeT("fr");
    expect(hospitalityRegimeClause(t, "autorisation")).toContain("est soumise à l'autorisation préalable de l'instance ordinale");
    expect(hospitalityRegimeClause(t, "declaration")).toContain("sous les seuils d'autorisation, est déclarée à l'instance ordinale");
    expect(hospitalityRegimeClause(makeT("en"), "autorisation")).toContain("subject to prior authorisation");
  });
});

describe("une définition par indicateur", () => {
  const d = new Date("2026-10-01T10:00:00Z");
  it("honoraires : à percevoir = signé non payé ; en préparation = le reste (bloqué compris)", () => {
    const fees = [
      { status: "SIGNE", feeCents: 100000, paidAt: null, paidCents: null },
      { status: "TERMINE", feeCents: 50000, paidAt: d, paidCents: 50000 },
      { status: "BLOQUE", feeCents: 30000, paidAt: null, paidCents: null },
      { status: "ACCORD", feeCents: 20000, paidAt: null, paidCents: null },
      { status: "SIGNATURE", feeCents: 10000, paidAt: null, paidCents: null },
      { status: "ATT_EXPERTS", feeCents: 99999, paidAt: null, paidCents: null },
    ];
    expect(feeTotals(fees)).toEqual({ paid: 50000, due: 100000, preparing: 60000 });
  });

  it("absent : non pointé à un événement pointé ; ni à déclarer, sauf déjà déclaré", () => {
    expect(isAbsent({ checkedInAt: null }, true)).toBe(true);
    expect(isAbsent({ checkedInAt: d }, true)).toBe(false);
    expect(isAbsent({ checkedInAt: null }, false)).toBe(false);
    expect(toDeclare({ declared: false, checkedInAt: null }, true)).toBe(false);
    expect(toDeclare({ declared: false, checkedInAt: null }, false)).toBe(true);
    expect(toDeclare({ declared: true, checkedInAt: d }, true)).toBe(false);
  });

  it("dossier : engagés (acceptés) et proposés (réponse attendue, recrutement ouvert)", () => {
    const experts = [{ status: "ACCORD", feeCents: 2000 }, { status: "ATT_EXPERTS", feeCents: 1500 }, { status: "DECLINE", feeCents: 900 }, { status: "SIGNE", feeCents: 1000 }];
    expect(expertSplit(experts, true)).toMatchObject({ engagedCents: 3000, proposedCents: 1500 });
    expect(expertSplit(experts, false)).toMatchObject({ engagedCents: 3000, proposedCents: 0 });
  });

  it("coût par participant d'un devis : les présents après l'événement pointé", () => {
    expect(costHeadcount(50, 0, false)).toEqual({ n: 50, per: "participant" });
    expect(costHeadcount(50, 32, true)).toEqual({ n: 32, per: "présent" });
    expect(costHeadcount(50, 0, true)).toEqual({ n: 50, per: "participant" });
  });

  it("« Vous intervenez » : candidature retenue et honoraires acceptés", () => {
    expect(speakerConfirmed({ status: "retained" }, { status: "ACCORD" })).toBe(true);
    expect(speakerConfirmed({ status: "retained" }, { status: "ATT_EXPERTS" })).toBe(false);
    expect(speakerConfirmed({ status: "retained" }, { status: "DECLINE" })).toBe(false);
    expect(speakerConfirmed({ status: "retained" }, undefined)).toBe(false);
    expect(speakerConfirmed({ status: "pending" }, { status: "ACCORD" })).toBe(false);
  });
});
