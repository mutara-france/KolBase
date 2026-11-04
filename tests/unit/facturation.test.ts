import { describe, expect, it } from "vitest";
import { billingInfo, canEngage, displayStatus, fromStripeStatus, needsSubscription, planFor, PLANS } from "@/lib/billing-plans";
import { encodeForm, signWebhook, verifyWebhook } from "@/lib/stripe-core";

describe("facturation", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  it("tarifs et offres", () => {
    expect(PLANS.organisation.cents).toBe(59900);
    expect(PLANS.prestataire.cents).toBe(24900);
    expect(planFor("PRESTATAIRE")).toBe("prestataire");
    expect(planFor("INDUSTRIEL")).toBe("organisation");
  });
  it("autorise les actions engageantes selon le statut", () => {
    expect(canEngage(null, now)).toBe(false);
    expect(canEngage({ status: "a_activer", exemptUntil: null }, now)).toBe(false);
    expect(canEngage({ status: "essai", exemptUntil: null }, now)).toBe(true);
    expect(canEngage({ status: "impayee", exemptUntil: null }, now)).toBe(true);
    expect(canEngage({ status: "resiliee", exemptUntil: null }, now)).toBe(false);
    expect(canEngage({ status: "resiliee", exemptUntil: new Date("2027-01-01") }, now)).toBe(true);
    expect(displayStatus({ status: "active", exemptUntil: new Date("2027-01-01") }, now)).toBe("offerte");
    expect(displayStatus({ status: "active", exemptUntil: new Date("2026-01-01") }, now)).toBe("active");
  });
  it("publication d'événements gratuite pour les sociétés savantes, associations et organismes de formation", () => {
    for (const kind of ["SOCIETE_SAVANTE", "ASSOCIATION_PRO", "ORGANISME_FORMATION"]) {
      expect(needsSubscription(kind, "evenement")).toBe(false);
      // Leurs autres actions engageantes restent sur abonnement.
      expect(needsSubscription(kind, "sollicitation")).toBe(true);
      expect(needsSubscription(kind, "appel")).toBe(true);
      expect(needsSubscription(kind, "devis")).toBe(true);
    }
    expect(needsSubscription("INDUSTRIEL", "evenement")).toBe(true);
    expect(billingInfo("SOCIETE_SAVANTE", null, now)).toContain("publication d'événements gratuits");
    expect(billingInfo("INDUSTRIEL", null, now)).not.toContain("publication d'événements");
  });
  it("traduit les statuts Stripe", () => {
    expect(fromStripeStatus("trialing")).toBe("essai");
    expect(fromStripeStatus("past_due")).toBe("impayee");
    expect(fromStripeStatus("canceled")).toBe("resiliee");
    expect(fromStripeStatus("incomplete")).toBe("a_activer");
  });
  it("encode les paramètres à la manière de Stripe", () => {
    expect(encodeForm({ a: 1, b: { c: "x", d: [1, 2] }, e: undefined }).toString()).toBe("a=1&b%5Bc%5D=x&b%5Bd%5D%5B0%5D=1&b%5Bd%5D%5B1%5D=2");
  });
  it("vérifie la signature des notifications Stripe", () => {
    const payload = '{"id":"evt_1"}';
    const header = signWebhook(payload, "whsec_test", 1_700_000_000);
    expect(verifyWebhook(payload, header, "whsec_test", 1_700_000_100)).toBe(true);
    expect(verifyWebhook(payload, header, "autre", 1_700_000_100)).toBe(false);
    expect(verifyWebhook(payload + " ", header, "whsec_test", 1_700_000_100)).toBe(false);
    expect(verifyWebhook(payload, header, "whsec_test", 1_700_001_000)).toBe(false);
  });
});

import { freeMonths, monthlyCents, planPrice, formatPrice as fmt } from "@/lib/billing-plans";

describe("formule annuelle", () => {
  it("dix mois payés pour douze", () => {
    expect(planPrice("organisation", "year")).toBe(599000);
    expect(planPrice("prestataire", "year")).toBe(249000);
    expect(freeMonths("organisation")).toBe(2);
    expect(freeMonths("prestataire")).toBe(2);
  });
  it("revenu mensuel et affichage", () => {
    expect(monthlyCents("organisation", "year")).toBe(49917);
    expect(monthlyCents("organisation", "month")).toBe(59900);
    expect(fmt(599000, "year").replace(/\s/g, " ")).toBe("5 990 € HT par an");
  });
});
