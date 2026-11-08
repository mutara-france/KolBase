import { describe, expect, it } from "vitest";
import {
  acquisition, assessmentLabel, attendedHours, fundingLabel, halfDays, isAssessment, isFunding, satisfaction, selfProgress, selfSignOpen, sessionHours,
  sheetMissing, spanMinutes, totalHours,
} from "@/lib/training";

const paris = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 16);
const full = {
  objectives: "Poser un implant court", audience: "Chirurgiens-dentistes", prerequisites: "Aucun", hours: 7, methods: "Exposés, TP", assessment: "Quiz",
  accessDelay: "7 jours avant", accessibility: "Salle accessible", price: "450 € TTC", funding: ["dpc"], fundingNote: null, dpcRef: "12345", contact: "contact@exemple.fr",
};

describe("Fiche de formation (Qualiopi, indicateur 1)", () => {
  it("fiche complète : rien ne manque", () => {
    expect(sheetMissing(full, { kind: "SOCIETE_SAVANTE", nda: null, handicapContact: null })).toEqual([]);
  });

  it("ce qui manque, et le numéro de déclaration d'activité d'un organisme de formation", () => {
    expect(sheetMissing(null, { kind: "ORGANISME_FORMATION", nda: null, handicapContact: null })).toEqual([
      "Objectifs", "Public visé", "Prérequis", "Durée", "Modalités pédagogiques", "Modalités d'évaluation", "Modalités et délai d'accès", "Accessibilité", "Tarif", "Modalités de financement", "Contact", "Numéro de déclaration d'activité",
    ]);
    // Référent handicap de l'organisme : l'accessibilité est renseignée.
    expect(sheetMissing({ ...full, accessibility: null }, { kind: "ORGANISME_FORMATION", nda: "11 75 12345 75", handicapContact: "Mme Martin" })).toEqual([]);
  });

  it("financements et évaluations connus", () => {
    expect(isFunding("fifpl")).toBe(true);
    expect(isFunding("loto")).toBe(false);
    expect(fundingLabel("dpc")).toBe("DPC (ANDPC)");
    expect(isAssessment("partiel")).toBe(true);
    expect(assessmentLabel("non_acquis")).toBe("Non acquis");
    expect(assessmentLabel(null)).toBeNull();
  });
});

describe("Demi-journées et émargement", () => {
  it("deux jours, matin et après-midi, à l'heure de Paris (hiver)", () => {
    const list = halfDays({ firstDay: "2026-12-14", days: 2, am: ["09:00", "12:30"], pm: ["14:00", "17:30"] });
    expect(Array.isArray(list)).toBe(true);
    const l = list as { startsAt: Date; endsAt: Date }[];
    expect(l.map((s) => paris(s.startsAt))).toEqual(["2026-12-14 09:00", "2026-12-14 14:00", "2026-12-15 09:00", "2026-12-15 14:00"]);
    expect(l[0].startsAt.toISOString()).toBe("2026-12-14T08:00:00.000Z");
    expect(totalHours(l)).toBe(14);
    expect(sessionHours(l[0])).toBe(3.5);
    expect(spanMinutes(l)).toEqual({ start: l[0].startsAt, minutes: (24 + 8.5) * 60 });
  });

  it("heure d'été, matin seul, passage de mois", () => {
    const l = halfDays({ firstDay: "2027-06-30", days: 2, am: ["08:30", "12:00"], pm: null }) as { startsAt: Date }[];
    expect(l.map((s) => s.startsAt.toISOString())).toEqual(["2027-06-30T06:30:00.000Z", "2027-07-01T06:30:00.000Z"]);
  });

  it("saisies refusées", () => {
    expect(halfDays({ firstDay: "", days: 1, am: ["09:00", "12:00"], pm: null })).toMatch(/premier jour/);
    expect(halfDays({ firstDay: "2026-12-14", days: 11, am: ["09:00", "12:00"], pm: null })).toMatch(/1 à 10/);
    expect(halfDays({ firstDay: "2026-12-14", days: 1, am: null, pm: null })).toMatch(/matin/);
    expect(halfDays({ firstDay: "2026-12-14", days: 1, am: ["12:00", "09:00"], pm: null })).toMatch(/Horaires/);
    expect(halfDays({ firstDay: "2026-12-14", days: 1, am: ["09:00", "13:00"], pm: ["12:30", "17:00"] })).toMatch(/après la fin du matin/);
  });

  it("signature du participant : de 30 minutes avant le début à la fin", () => {
    const s = { startsAt: new Date("2026-12-14T08:00:00Z"), endsAt: new Date("2026-12-14T11:30:00Z") };
    expect(selfSignOpen(s, new Date("2026-12-14T07:29:00Z"))).toBe(false);
    expect(selfSignOpen(s, new Date("2026-12-14T07:31:00Z"))).toBe(true);
    expect(selfSignOpen(s, new Date("2026-12-14T11:30:00Z"))).toBe(true);
    expect(selfSignOpen(s, new Date("2026-12-14T11:31:00Z"))).toBe(false);
  });

  it("heures suivies : demi-journées émargées", () => {
    const ss = [
      { id: "a", startsAt: new Date("2026-12-14T08:00:00Z"), endsAt: new Date("2026-12-14T11:30:00Z") },
      { id: "b", startsAt: new Date("2026-12-14T13:00:00Z"), endsAt: new Date("2026-12-14T16:30:00Z") },
    ];
    expect(attendedHours(ss, new Set(["b"]))).toBe(3.5);
    expect(spanMinutes([])).toBeNull();
  });
});

describe("Indicateurs de résultats (Qualiopi, indicateur 2)", () => {
  it("satisfaction : notes de 4 ou 5, taux de réponse", () => {
    expect(satisfaction([{ overall: 5 }, { overall: 4 }, { overall: 3 }, { overall: 5 }], 8)).toEqual({ respondents: 4, rate: 75, responseRate: 50 });
    expect(satisfaction([], 3)).toBeNull();
    expect(satisfaction([{ overall: 2 }], 0)).toEqual({ respondents: 1, rate: 0, responseRate: null });
  });

  it("acquis : participants évalués « acquis »", () => {
    expect(acquisition(["acquis", "partiel", null, "acquis"])).toEqual({ assessed: 3, rate: 67 });
    expect(acquisition([null])).toBeNull();
  });

  it("progression perçue : moyennes avant et après", () => {
    expect(selfProgress([{ selfBefore: 2, selfAfter: 4 }, { selfBefore: 3, selfAfter: 5 }, { selfBefore: null, selfAfter: 5 }])).toEqual({ n: 2, before: 2.5, after: 4.5 });
    expect(selfProgress([])).toBeNull();
  });
});
