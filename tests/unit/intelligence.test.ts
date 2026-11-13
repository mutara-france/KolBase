import { describe, expect, it } from "vitest";
import { attr, element, elements } from "@/lib/xml";
import { amountCents, cellDate, linkKind, loyalty, normName, parseAliases, personKey } from "@/lib/intelligence";

describe("lecture de XML fourni par un tiers", () => {
  it("lit les éléments de gauche à droite, sans confondre les noms voisins", () => {
    const xml = '<cols><col min="1"/></cols><c r="A1" t="s"><v>0</v></c><c r="B1"/><content:encoded>x</content:encoded><content type="html">y</content>';
    expect([...elements(xml, "c")].map((c) => [attr(c.attrs, "r"), attr(c.attrs, "t"), element(c.body, "v")?.body ?? null])).toEqual([["A1", "s", "0"], ["B1", null, null]]);
    expect([...elements(xml, "content")].map((c) => c.body)).toEqual(["y"]);
    expect(attr(' xml:spr="1" r="A2"', "r")).toBe("A2");
    expect(attr(' r="A2', "r")).toBeNull();
    expect(element("<a>", "b")).toBeNull();
  });
  it("reste linéaire sur un document piégé (balises jamais refermées)", () => {
    const trap = "<row><c r=\"A1\">".repeat(200_000);
    const started = Date.now();
    expect([...elements(trap, "row")]).toEqual([]);
    expect([...elements(`${"<item>".repeat(200_000)}`, "item")]).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe("KolBase Intelligence : règles de lecture", () => {
  it("lit montants, dates et types de lien", () => {
    expect(amountCents("1 234,56")).toBe(123456);
    expect(amountCents("150 €")).toBe(15000);
    expect(amountCents("")).toBeNull();
    expect(amountCents("-5")).toBeNull();
    expect(amountCents("abc")).toBeNull();
    expect(cellDate("14/03/2026")?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(cellDate("2026-03-14T00:00:00+01:00")?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(cellDate("46095")?.toISOString().slice(0, 10)).toBe("2026-03-14");
    expect(cellDate("31/02/2026")).toBeNull();
    expect(cellDate("bientôt")).toBeNull();
    expect(linkKind("Rémunération")).toBe("remuneration");
    expect(linkKind("CONVENTION")).toBe("convention");
    expect(linkKind("Avantages")).toBe("avantage");
    expect(linkKind("autre")).toBeNull();
  });
  it("lit les écritures d'une organisation et rapproche les personnes par leur nom", () => {
    expect(parseAliases("Marque A, Marque A ; ab\nFiliale B")).toEqual(["Marque A", "Filiale B"]);
    expect(normName("  Éclat-Dentaire (S.A.) ")).toBe("eclat dentaire s a");
    expect(personKey("DURAND Claire")).toBe(personKey("Claire Durand"));
  });
  it("place chaque expert dans le portefeuille de l'année", () => {
    expect(loyalty([2026], 2026)).toBe("nouveau");
    expect(loyalty([2025, 2026], 2026)).toBe("fidele");
    expect(loyalty([2023, 2026], 2026)).toBe("revenu");
    expect(loyalty([2024, 2025], 2026)).toBe("dormant");
    expect(loyalty([2023], 2026)).toBeNull();
  });
});
