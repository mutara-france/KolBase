import { describe, expect, it } from "vitest";
import { defaultVatBp } from "@/lib/quotes";
import { loginPath } from "@/lib/safe-redirect";
import { orgIsPublic } from "@/lib/org-roles";
import { projectEditable, termsChanged, TRANSITIONS } from "@/lib/projects";
import { eventChanges, needsOnlineLink, parseOnlineUrl, parseParisDateTime, toParisInput } from "@/lib/events";

describe("devis : taux de TVA proposé", () => {
  it("10 % pour la restauration, l'hébergement et le transport, 20 % sinon", () => {
    expect(defaultVatBp("restauration")).toBe(1000);
    expect(defaultVatBp("hebergement")).toBe(1000);
    expect(defaultVatBp("transport")).toBe(1000);
    expect(defaultVatBp("salle")).toBe(2000);
    expect(defaultVatBp("audiovisuel")).toBe(2000);
  });
});

describe("événements en ligne : lien de connexion", () => {
  it("https uniquement, adresse complète", () => {
    expect(parseOnlineUrl("")).toBeNull();
    expect(parseOnlineUrl("  https://zoom.us/j/123?pwd=abc ")).toBe("https://zoom.us/j/123?pwd=abc");
    expect(parseOnlineUrl("http://zoom.us/j/123")).toBeUndefined();
    expect(parseOnlineUrl("javascript:alert(1)")).toBeUndefined();
    expect(parseOnlineUrl("https://localhost/x")).toBeUndefined();
    expect(parseOnlineUrl("https://user:pw@meet.example.com/x")).toBeUndefined();
    expect(parseOnlineUrl("zoom.us/j/123")).toBeUndefined();
    expect(parseOnlineUrl(`https://meet.example.com/${"a".repeat(600)}`)).toBeUndefined();
  });

  it("lien manquant à deux jours ou moins d'un événement en ligne ou hybride : à ajouter", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    const ev = (format: string, hours: number, onlineUrl: string | null = null, internal = false) => ({ format, internal, onlineUrl, startsAt: new Date(now.getTime() + hours * 3600e3) });
    expect(needsOnlineLink(ev("DISTANCIEL", 47), now)).toBe(true);
    expect(needsOnlineLink(ev("HYBRIDE", 10), now)).toBe(true);
    expect(needsOnlineLink(ev("DISTANCIEL", 49), now)).toBe(false);
    expect(needsOnlineLink(ev("DISTANCIEL", 10, "https://meet.example.com/x"), now)).toBe(false);
    expect(needsOnlineLink(ev("PRESENTIEL", 10), now)).toBe(false);
    expect(needsOnlineLink(ev("DISTANCIEL", -1), now)).toBe(false);
    expect(needsOnlineLink(ev("DISTANCIEL", 10, null, true), now)).toBe(false);
  });

  it("valeur d'un champ date et heure à Paris : aller-retour avec la saisie", () => {
    for (const v of ["2026-03-28T01:30", "2026-03-29T03:15", "2026-10-25T02:30", "2026-12-31T23:45", "2027-07-14T00:00"]) {
      const d = parseParisDateTime(v)!;
      expect(toParisInput(d)).toBe(v);
    }
    expect(toParisInput(new Date("2026-06-01T08:00:00Z"))).toBe("2026-06-01T10:00");
  });

  it("changements annoncés aux inscrits : date, lieu, format, lien", () => {
    const base = { startsAt: new Date("2026-12-01T17:00:00Z"), city: "Lyon", venue: "Hôtel-Dieu", format: "HYBRIDE", onlineUrl: "https://meet.example.com/a" };
    expect(eventChanges(base, { ...base })).toEqual([]);
    expect(eventChanges(base, { ...base, startsAt: new Date("2026-12-01T18:00:00Z") })).toEqual(["date"]);
    expect(eventChanges(base, { ...base, venue: "Salle Molière" })).toEqual(["lieu"]);
    expect(eventChanges(base, { ...base, format: "DISTANCIEL", city: null, venue: null })).toEqual(["lieu", "format"]);
    expect(eventChanges(base, { ...base, onlineUrl: "https://meet.example.com/b" })).toEqual(["lien"]);
    expect(eventChanges({ ...base, city: null }, { ...base, city: "" as unknown as null })).toEqual([]);
  });
});

describe("dossier modifiable avant la signature", () => {
  it("modifiable pendant le recrutement seulement", () => {
    expect(projectEditable("ATT_EXPERTS")).toBe(true);
    expect(projectEditable("ACCORD")).toBe(true);
    for (const s of ["ATT_IND", "EN_VALID", "BLOQUE", "VALIDE", "ORDRE", "SIGNATURE", "SIGNE", "TERMINE", "DECLINE"]) expect(projectEditable(s), s).toBe(false);
  });
  it("reprise après blocage et retour en accord de principe ramènent à la modification", () => {
    expect(TRANSITIONS.revise.to).toBe("ACCORD");
    expect(TRANSITIONS.back_to_accord.to).toBe("ACCORD");
    expect([...TRANSITIONS.back_to_accord.from]).toEqual(expect.arrayContaining(["SIGNATURE", "ORDRE"]));
    expect([...TRANSITIONS.abandon.from]).toEqual(expect.arrayContaining(["SIGNATURE", "ORDRE", "ACCORD", "BLOQUE"]));
    expect(TRANSITIONS.abandon.from as readonly string[]).not.toContain("SIGNE");
  });
  it("unités ou honoraires modifiés : nouvelle proposition", () => {
    expect(termsChanged({ feeCents: 150000, days: 1 }, { feeCents: 150000, days: 1 })).toBe(false);
    expect(termsChanged({ feeCents: 150000, days: 1 }, { feeCents: 180000, days: 1 })).toBe(true);
    expect(termsChanged({ feeCents: 150000, days: 1 }, { feeCents: 150000, days: 2 })).toBe(true);
    expect(termsChanged({ feeCents: 150000, days: null }, { feeCents: 150000, days: null })).toBe(false);
    expect(termsChanged({ feeCents: null, days: 1 }, { feeCents: 0, days: 1 })).toBe(true);
  });
});

describe("page d'origine conservée à la connexion", () => {
  it("renvoie vers la connexion avec le chemin demandé, s'il est sûr", () => {
    expect(loginPath("/sollicitations/abc")).toBe("/connexion?next=%2Fsollicitations%2Fabc");
    expect(loginPath("/admin?onglet=lancement")).toBe("/connexion?next=%2Fadmin%3Fonglet%3Dlancement");
    expect(loginPath("/")).toBe("/connexion");
    expect(loginPath(null)).toBe("/connexion");
    expect(loginPath("//evil.example")).toBe("/connexion");
    expect(loginPath("/\\evil.example")).toBe("/connexion");
    expect(loginPath("https://evil.example/x")).toBe("/connexion");
    expect(loginPath("/connexion?next=/x")).toBe("/connexion");
  });
});

describe("page publique d'une organisation", () => {
  it("visible seulement validée et présente dans l'annuaire", () => {
    expect(orgIsPublic({ verification: "VERIFIED", listed: true })).toBe(true);
    expect(orgIsPublic({ verification: "VERIFIED", listed: false })).toBe(false);
    expect(orgIsPublic({ verification: "PENDING", listed: true })).toBe(false);
    expect(orgIsPublic({ verification: "REJECTED", listed: true })).toBe(false);
  });
});
