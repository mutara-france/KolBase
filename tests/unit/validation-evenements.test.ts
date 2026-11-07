import { describe, expect, it } from "vitest";
import { needsReview, REVIEW_LABEL, REVIEW_TONE, reviewAllowsPublish, REVIEWED_CHANGES } from "@/lib/event-review";

describe("validation des événements par la conformité", () => {
  const industriel = { eventReview: true };
  const societe = { eventReview: false };

  it("exigée pour un événement ouvert aux praticiens d'une organisation qui la demande", () => {
    expect(needsReview(industriel, { internal: false })).toBe(true);
    expect(needsReview(societe, { internal: false })).toBe(false);
  });

  it("jamais pour une réunion interne (ni publiée, ni ouverte aux inscriptions)", () => {
    expect(needsReview(industriel, { internal: true })).toBe(false);
  });

  it("publication seulement une fois validé, quand elle est exigée", () => {
    expect(reviewAllowsPublish(industriel, { internal: false, reviewStatus: null })).toBe(false);
    expect(reviewAllowsPublish(industriel, { internal: false, reviewStatus: "submitted" })).toBe(false);
    expect(reviewAllowsPublish(industriel, { internal: false, reviewStatus: "changes" })).toBe(false);
    expect(reviewAllowsPublish(industriel, { internal: false, reviewStatus: "approved" })).toBe(true);
    expect(reviewAllowsPublish(societe, { internal: false, reviewStatus: null })).toBe(true);
  });

  it("libellé et ton pour chaque état", () => {
    for (const k of ["submitted", "approved", "changes"] as const) {
      expect(REVIEW_LABEL[k]).toBeTruthy();
      expect(REVIEW_TONE[k]).toBeTruthy();
    }
  });

  it("date, lieu, format et hospitalités renvoient à la conformité (pas le lien de connexion)", () => {
    expect([...REVIEWED_CHANGES]).toEqual(["date", "lieu", "format", "hospitalités"]);
    expect((REVIEWED_CHANGES as readonly string[]).includes("lien")).toBe(false);
  });
});
