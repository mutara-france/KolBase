import { describe, expect, it } from "vitest";
import {
  abstractFormatLabel, abstractsOpen, isAbstractFormat, isPartnerLevel, isProgramKind, levelRank, parseTopics, partnerLevelLabel, partnerSecured, partnerTotals,
  programByDay, programKindLabel, programSlot, reviewScore, roomConflicts,
} from "@/lib/congress";

const at = (s: string) => new Date(s);

describe("Programme en salles", () => {
  it("séance saisie à l'heure de Paris, fin après le début", () => {
    const s = programSlot("2026-12-14", "09:00", "10:30") as { startsAt: Date; endsAt: Date };
    expect(s.startsAt.toISOString()).toBe("2026-12-14T08:00:00.000Z");
    expect(s.endsAt.toISOString()).toBe("2026-12-14T09:30:00.000Z");
    expect(programSlot("2026-12-14", "10:00", "09:00")).toMatch(/suit son début/);
    expect(programSlot("", "10:00", "11:00")).toMatch(/jour et les horaires/);
  });

  it("programme par jour de Paris, séances dans l'ordre", () => {
    const items = [
      { id: "b", startsAt: at("2026-12-14T13:00:00Z"), endsAt: at("2026-12-14T14:00:00Z") },
      { id: "a", startsAt: at("2026-12-14T08:00:00Z"), endsAt: at("2026-12-14T09:00:00Z") },
      { id: "c", startsAt: at("2026-12-14T23:30:00Z"), endsAt: at("2026-12-15T00:30:00Z") },
    ];
    expect(programByDay(items).map((d) => [d.day, d.items.map((i) => i.id)])).toEqual([["2026-12-14", ["a", "b"]], ["2026-12-15", ["c"]]]);
  });

  it("chevauchement dans une même salle signalé, pas entre salles", () => {
    const items = [
      { id: "1", roomId: "r1", startsAt: at("2026-12-14T08:00:00Z"), endsAt: at("2026-12-14T09:00:00Z") },
      { id: "2", roomId: "r1", startsAt: at("2026-12-14T08:30:00Z"), endsAt: at("2026-12-14T09:30:00Z") },
      { id: "3", roomId: "r2", startsAt: at("2026-12-14T08:30:00Z"), endsAt: at("2026-12-14T09:30:00Z") },
      { id: "4", roomId: "r1", startsAt: at("2026-12-14T09:30:00Z"), endsAt: at("2026-12-14T10:00:00Z") },
      { id: "5", roomId: null, startsAt: at("2026-12-14T08:00:00Z"), endsAt: at("2026-12-14T09:00:00Z") },
    ];
    expect([...roomConflicts(items)]).toEqual(["2"]);
  });

  it("libellés des natures de séance", () => {
    expect(isProgramKind("symposium")).toBe(true);
    expect(isProgramKind("banquet")).toBe(false);
    expect(programKindLabel("table-ronde")).toBe("Table ronde");
  });
});

describe("Partenaires", () => {
  it("niveaux et ordre d'affichage", () => {
    expect(isPartnerLevel("or")).toBe(true);
    expect(isPartnerLevel("platine")).toBe(false);
    expect(partnerLevelLabel("principal")).toBe("Partenaire principal");
    expect(["exposant", "principal", "argent"].sort((a, b) => levelRank(a) - levelRank(b))).toEqual(["principal", "argent", "exposant"]);
    expect(levelRank("inconnu")).toBeGreaterThan(levelRank("institutionnel"));
  });

  it("financement acquis (signé, réglé) et en attente", () => {
    expect(partnerSecured("signed") && partnerSecured("paid") && !partnerSecured("proposed")).toBe(true);
    expect(partnerTotals([
      { status: "signed", amountCents: 500000 }, { status: "paid", amountCents: 200000 }, { status: "proposed", amountCents: 300000 },
      { status: "draft", amountCents: null }, { status: "declined", amountCents: 900000 },
    ])).toEqual({ secured: 700000, pending: 300000 });
  });
});

describe("Appel à communications", () => {
  const now = at("2026-11-08T12:00:00Z");
  it("ouvert : date limite à venir, événement publié et non annulé", () => {
    expect(abstractsOpen({ abstractsDeadline: at("2026-12-01T22:59:00Z"), publishedAt: now, cancelledAt: null }, now)).toBe(true);
    expect(abstractsOpen({ abstractsDeadline: at("2026-11-01T22:59:00Z"), publishedAt: now, cancelledAt: null }, now)).toBe(false);
    expect(abstractsOpen({ abstractsDeadline: at("2026-12-01T22:59:00Z"), publishedAt: null, cancelledAt: null }, now)).toBe(false);
    expect(abstractsOpen({ abstractsDeadline: at("2026-12-01T22:59:00Z"), publishedAt: now, cancelledAt: now }, now)).toBe(false);
    expect(abstractsOpen({ abstractsDeadline: null, publishedAt: now, cancelledAt: null }, now)).toBe(false);
  });

  it("thèmes : par ligne ou virgule, sans doublon, vingt au plus", () => {
    expect(parseTopics("Implantologie\nParodontologie, implantologie ; Endodontie\n\n")).toEqual(["Implantologie", "Parodontologie", "Endodontie"]);
    expect(parseTopics(Array.from({ length: 30 }, (_, i) => `Thème ${i}`).join("\n"))).toHaveLength(20);
  });

  it("formats et note du comité", () => {
    expect(isAbstractFormat("poster")).toBe(true);
    expect(isAbstractFormat("video")).toBe(false);
    expect(abstractFormatLabel("oral")).toBe("Communication orale");
    expect(abstractFormatLabel(null)).toBeNull();
    expect(reviewScore([{ score: 4 }, { score: 5 }, { score: 4 }])).toEqual({ n: 3, avg: 4.3 });
    expect(reviewScore([])).toBeNull();
  });
});
