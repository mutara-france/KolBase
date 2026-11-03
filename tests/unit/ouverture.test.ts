import { describe, expect, it } from "vitest";
import { defaultVatBp } from "@/lib/quotes";
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
