import { describe, expect, it } from "vitest";
import { decisionLabel, isReportReason, isReportTarget, plausibleEmail, REMOVAL_LABEL, reportReasonLabel, targetHref } from "@/lib/moderation";

describe("Signalements et retraits", () => {
  it("cibles et motifs connus", () => {
    expect(isReportTarget("avis")).toBe(true);
    expect(isReportTarget("toString")).toBe(false);
    expect(isReportReason("deontologie")).toBe(true);
    expect(isReportReason("spam")).toBe(false);
    expect(reportReasonLabel("donnees")).toBe("Données personnelles d'un tiers ou d'un patient");
  });

  it("décision lisible selon la cible", () => {
    expect(decisionLabel("avis", "retire")).toBe("Masquer l'avis");
    expect(decisionLabel("expert", "retire")).toBe(REMOVAL_LABEL.expert);
    expect(decisionLabel("evenement", "sans_suite")).toBe("Sans suite");
    expect(decisionLabel("organisation", null)).toBe("À traiter");
  });

  it("adresse de la cible", () => {
    expect(targetHref("expert", "p1")).toBe("/experts/p1");
    expect(targetHref("organisation", "o1")).toBe("/structures/o1");
    expect(targetHref("evenement", "e1")).toBe("/evenements/e1");
    expect(targetHref("avis", "r1", { supplierId: "s1" })).toBe("/structures/s1");
    expect(targetHref("avis", "r1")).toBeNull();
  });

  it("adresse e-mail plausible pour un signalement sans compte", () => {
    expect(plausibleEmail("claire.dupont@exemple.fr")).toBe(true);
    expect(plausibleEmail("pas une adresse")).toBe(false);
    expect(plausibleEmail("a@b")).toBe(false);
  });
});
