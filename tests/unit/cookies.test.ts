import { describe, expect, it } from "vitest";
import { CONSENT_MAX_AGE, optionalServices, readConsent, SERVICE_COOKIES, writeConsent } from "@/lib/consent";

const NOW = Date.UTC(2026, 10, 6, 10, 0, 0);

describe("cookie de choix", () => {
  it("enregistre la date et chaque finalité, et se relit à l'identique", () => {
    const raw = writeConsent({ mesure: true, marketing: false }, NOW);
    expect(raw).toBe(`1.${NOW / 1000}.10`);
    expect(readConsent(raw, NOW)).toEqual({ at: NOW / 1000, mesure: true, marketing: false });
    expect(readConsent(writeConsent({ mesure: false, marketing: false }, NOW), NOW)).toMatchObject({ mesure: false, marketing: false });
  });

  it("redemande le choix après six mois, ou si le cookie est illisible ou daté du futur", () => {
    const raw = writeConsent({ mesure: true, marketing: true }, NOW);
    expect(readConsent(raw, NOW + (CONSENT_MAX_AGE - 60) * 1000)).not.toBeNull();
    expect(readConsent(raw, NOW + (CONSENT_MAX_AGE + 60) * 1000)).toBeNull();
    expect(readConsent(raw, NOW - 3 * 86400_000)).toBeNull();
    for (const bad of [undefined, "", "oui", "2.1762423200.11", "1.1762423200.1", "1.abc.11", "1.1762423200.12"]) expect(readConsent(bad, NOW)).toBeNull();
  });
});

describe("services soumis à consentement", () => {
  it("aucun sans identifiant dans l'environnement", () => {
    expect(optionalServices({})).toEqual([]);
  });

  it("Google Analytics, HubSpot et Meta selon leurs identifiants, chacun dans sa finalité", () => {
    const s = optionalServices({ GA_MEASUREMENT_ID: "G-AB12CD34", HUBSPOT_PORTAL_ID: "147258369", HUBSPOT_REGION: "eu1", META_PIXEL_ID: "123456789012345" });
    expect(s.map((x) => [x.id, x.category, x.key])).toEqual([
      ["ga", "mesure", "G-AB12CD34"],
      ["hubspot", "marketing", "147258369"],
      ["meta", "marketing", "123456789012345"],
    ]);
    expect(s[1].region).toBe("eu1");
    expect(optionalServices({ HUBSPOT_PORTAL_ID: "147258369" })[0].region).toBeUndefined();
  });

  it("ignore un identifiant mal formé (aucun script vers une adresse inattendue)", () => {
    expect(optionalServices({ GA_MEASUREMENT_ID: "UA-1234-1", HUBSPOT_PORTAL_ID: "12/../x", META_PIXEL_ID: "abc" })).toEqual([]);
  });

  it("reconnaît les cookies de chaque service, pas ceux de KolBase", () => {
    expect(["_ga", "_ga_AB12CD34", "_gid"].every((c) => SERVICE_COOKIES.ga.test(c))).toBe(true);
    expect(["__hstc", "hubspotutk", "__hssc"].every((c) => SERVICE_COOKIES.hubspot.test(c))).toBe(true);
    expect(["_fbp", "_fbc"].every((c) => SERVICE_COOKIES.meta.test(c))).toBe(true);
    for (const c of ["kb_session", "kb_consent", "kb_lang"]) expect(Object.values(SERVICE_COOKIES).some((r) => r.test(c))).toBe(false);
  });
});
