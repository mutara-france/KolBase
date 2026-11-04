import { describe, expect, it } from "vitest";
import { eventIcsEntry, toIcs } from "@/lib/ics";
import { eventEnd, eventEnded } from "@/lib/events";

const t = (fr: string, vars?: Record<string, string>) => (vars ? fr.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "") : fr);
const base = { id: "ev1", title: "Webinaire", startsAt: new Date("2026-12-01T19:00:00Z"), durationMinutes: 60, venue: null, city: null };

describe("invitation d'agenda d'un événement", () => {
  it("lien de connexion réservé à la personne inscrite", () => {
    const online = { ...base, format: "DISTANCIEL", onlineUrl: "https://visio.example.com/j/1" };
    const inscrit = eventIcsEntry(online, "Orthonova", true, t);
    expect(inscrit.location).toBe("https://visio.example.com/j/1");
    expect(inscrit.description).toContain("Lien de connexion : https://visio.example.com/j/1");
    const visiteur = eventIcsEntry(online, "Orthonova", false, t);
    expect(visiteur.location).toBe("Visioconférence");
    expect(visiteur.description).not.toContain("visio.example.com");
  });
  it("lieu d'un événement en présentiel, sans lien", () => {
    const e = eventIcsEntry({ ...base, format: "PRESENTIEL", onlineUrl: "https://x.example.com", venue: "Clinique du Port", city: "Nice" }, "Dentalys", true, t);
    expect(e.location).toBe("Clinique du Port, Nice");
    expect(e.description).toBe("Organisé par Dentalys.");
    const ics = toIcs("Webinaire", [e]);
    expect(ics).toContain("UID:ev1@kolbase");
    expect(ics).toContain("DTSTART:20261201T190000Z");
  });
});

describe("événement commencé, puis terminé", () => {
  const e = { startsAt: new Date("2026-12-01T18:00:00Z"), durationMinutes: 180 };
  it("en cours tant que la durée n'est pas écoulée", () => {
    expect(eventEnded(e, new Date("2026-12-01T18:30:00Z"))).toBe(false);
    expect(eventEnded(e, new Date("2026-12-01T21:00:00Z"))).toBe(true);
  });
  it("durée inconnue : deux heures", () => {
    expect(eventEnd({ startsAt: e.startsAt, durationMinutes: null }).toISOString()).toBe("2026-12-01T20:00:00.000Z");
  });
});
