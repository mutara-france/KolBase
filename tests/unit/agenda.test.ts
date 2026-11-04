import { describe, expect, it } from "vitest";
import { agendaHref, disciplinesOf, filterAgenda, hasFilters, inPeriod, NO_FILTERS, readAgendaFilters } from "@/lib/agenda";

describe("filtres de l'agenda", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const inDays = (n: number) => new Date(now.getTime() + n * 864e5);
  const ev = (o: Partial<{ title: string; typeId: string; therapeuticArea: string | null; format: string; city: string | null; startsAt: Date; org: string }>) => ({
    title: o.title ?? "Atelier", typeId: o.typeId ?? "travaux-pratiques", therapeuticArea: o.therapeuticArea ?? null, format: o.format ?? "PRESENTIEL",
    city: o.city ?? "Lyon", startsAt: o.startsAt ?? inDays(10), organization: { name: o.org ?? "CDRA" },
  });
  const events = [
    ev({ title: "TP endodontie", therapeuticArea: "Endodontie", startsAt: inDays(5) }),
    ev({ title: "Webinaire paro", typeId: "webinaire", therapeuticArea: "Parodontologie", format: "DISTANCIEL", city: null, startsAt: inDays(45) }),
    ev({ title: "Symposium implants", typeId: "symposium", therapeuticArea: "implantologie", format: "HYBRIDE", city: "Paris", startsAt: inDays(120) }),
    ev({ title: "Journée implantaire", typeId: "pleniere", therapeuticArea: "Implantologie", city: "Grenoble", startsAt: inDays(20) }),
  ];
  const titles = (f: Parameters<typeof filterAgenda>[1]) => filterAgenda(events, f, now).map((e) => e.title);

  it("lit les paramètres de l'adresse et ignore les valeurs inconnues", () => {
    expect(readAgendaFilters({ q: " implant ", type: "webinaire", format: "HYBRIDE", periode: "90j", discipline: "Endodontie", ville: "Lyon" }))
      .toEqual({ q: "implant", type: "webinaire", format: "HYBRIDE", periode: "90j", discipline: "Endodontie", ville: "Lyon" });
    expect(readAgendaFilters({ type: "inconnu", format: "PAPIER", periode: "demain" })).toEqual(NO_FILTERS);
    expect(readAgendaFilters({ type: ["dpc", "webinaire"] }).type).toBe("dpc");
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("combine discipline, type, format, période et ville", () => {
    // Discipline saisie librement : casse et accents ignorés.
    expect(titles({ ...NO_FILTERS, discipline: "IMPLANTOLOGIE" })).toEqual(["Symposium implants", "Journée implantaire"]);
    expect(titles({ ...NO_FILTERS, type: "webinaire" })).toEqual(["Webinaire paro"]);
    expect(titles({ ...NO_FILTERS, format: "HYBRIDE" })).toEqual(["Symposium implants"]);
    expect(titles({ ...NO_FILTERS, periode: "30j" })).toEqual(["TP endodontie", "Journée implantaire"]);
    expect(titles({ ...NO_FILTERS, periode: "90j" })).toEqual(["TP endodontie", "Webinaire paro", "Journée implantaire"]);
    expect(titles({ ...NO_FILTERS, periode: "plus" })).toEqual(["Symposium implants"]);
    expect(titles({ ...NO_FILTERS, discipline: "Implantologie", ville: "grenoble" })).toEqual(["Journée implantaire"]);
    expect(titles({ ...NO_FILTERS, q: "cdra webinaire" })).toEqual(["Webinaire paro"]);
    expect(titles(NO_FILTERS)).toHaveLength(4);
  });

  it("période : un événement en cours compte dans les 30 jours", () => {
    expect(inPeriod(inDays(-0.1), "30j", now)).toBe(true);
    expect(inPeriod(inDays(30), "30j", now)).toBe(true);
    expect(inPeriod(inDays(31), "30j", now)).toBe(false);
    expect(inPeriod(inDays(91), "plus", now)).toBe(true);
  });

  it("regroupe les disciplines, les plus fréquentes d'abord", () => {
    expect(disciplinesOf(events)).toEqual([{ name: "Implantologie", count: 2 }, { name: "Endodontie", count: 1 }, { name: "Parodontologie", count: 1 }]);
    expect(disciplinesOf([{ therapeuticArea: " " }, { therapeuticArea: null }])).toEqual([]);
  });

  it("construit des adresses stables, sans les filtres vides", () => {
    expect(agendaHref(NO_FILTERS)).toBe("/evenements");
    expect(agendaHref({ ...NO_FILTERS, ville: "Lyon", discipline: "Endodontie", periode: "30j" })).toBe("/evenements?discipline=Endodontie&periode=30j&ville=Lyon");
  });
});
