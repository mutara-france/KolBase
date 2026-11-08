import { describe, expect, it } from "vitest";
import { belgianHolidays, canAcceptHospitality, hospitalityGate, mdeonDeadline, mdeonOverCaps, mdeonRequired, spansSeveralDays } from "@/lib/belgium";
import { complianceSettings, DEFAULT_COMPLIANCE, hospitalityRegime } from "@/lib/compliance";

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** 18 h 30 à Paris (UTC+1 en hiver). */
const at = (day: string, hour = "17:30") => new Date(`${day}T${hour}:00Z`);
const ev = (o: Partial<{ startsAt: Date; durationMinutes: number | null; benefits: { catalogId: string; valueCents: number }[]; kind: string; mdeonVisa: string | null }> = {}) => ({
  startsAt: o.startsAt ?? at("2026-12-14"),
  durationMinutes: o.durationMinutes ?? 180,
  benefits: o.benefits ?? [{ catalogId: "cocktail", valueCents: 4500 }],
  organization: { kind: o.kind ?? "INDUSTRIEL" },
  mdeonVisa: o.mdeonVisa ?? null,
});

describe("Belgique : jours fériés et délai du visa Mdeon", () => {
  it("jours fériés légaux 2026 (Pâques le 5 avril)", () => {
    expect(belgianHolidays(2026).map(iso)).toEqual([
      "2026-01-01", "2026-04-06", "2026-05-01", "2026-05-14", "2026-05-25", "2026-07-21", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25",
    ]);
  });

  it("15e jour ouvrable avant le premier jour, week-ends et jours fériés exclus", () => {
    expect(iso(mdeonDeadline(at("2026-12-14")))).toBe("2026-11-23");
    // Le 11 novembre (mercredi) ne compte pas.
    expect(iso(mdeonDeadline(at("2026-11-30")))).toBe("2026-11-06");
  });

  it("plusieurs jours calendrier : la fin tombe un autre jour (heure de Bruxelles)", () => {
    expect(spansSeveralDays(at("2026-12-14"), 180)).toBe(false);
    expect(spansSeveralDays(at("2026-12-14"), 60 * 24)).toBe(true);
    expect(spansSeveralDays(at("2026-12-14", "08:00"), 600)).toBe(false);
    expect(spansSeveralDays(at("2026-12-14"), null)).toBe(false);
  });
});

describe("Belgique : visa Mdeon et plafonds", () => {
  it("visa requis pour l'hospitalité d'un industriel sur plusieurs jours ou avec nuitée", () => {
    expect(mdeonRequired(ev())).toBe(false);
    expect(mdeonRequired(ev({ benefits: [{ catalogId: "nuitee", valueCents: 14000 }] }))).toBe(true);
    expect(mdeonRequired(ev({ durationMinutes: 60 * 30 }))).toBe(true);
    // Sans hospitalité, ou organisé par une société savante : pas de visa d'entreprise.
    expect(mdeonRequired(ev({ durationMinutes: 60 * 30, benefits: [] }))).toBe(false);
    expect(mdeonRequired(ev({ durationMinutes: 60 * 30, kind: "SOCIETE_SAVANTE" }))).toBe(false);
  });

  it("plafonds de l'hospitalité raisonnable : déjeuner 45 €, dîner 90 €, nuitée 250 €", () => {
    expect(mdeonOverCaps([{ catalogId: "dejeuner", label: "Déjeuner", valueCents: 4500 }, { catalogId: "nuitee", label: "Nuitée", valueCents: 25000 }])).toEqual([]);
    expect(mdeonOverCaps([{ catalogId: "dejeuner", label: "Déjeuner", valueCents: 5200 }, { catalogId: "transport", label: "Transport", valueCents: 90000 }])).toEqual([{ label: "Déjeuner", value: 52, max: 45 }]);
  });
});

describe("Hospitalités à l'inscription : étudiants, Belgique", () => {
  const night = { benefits: [{ catalogId: "nuitee", valueCents: 14000 }] };
  it("étudiant exerçant en France : aucune prestation", () => {
    const g = hospitalityGate({ profession: "Étudiant(e) en odontologie", country: "FR" }, ev());
    expect(g).toBe("student");
    expect(canAcceptHospitality(g)).toBe(false);
  });
  it("praticien exerçant en Belgique : sans visa requis et absent, inscription sans prestation", () => {
    expect(hospitalityGate({ profession: "Chirurgien-dentiste", country: "BE" }, ev(night))).toBe("be_no_visa");
    expect(hospitalityGate({ profession: "Chirurgien-dentiste", country: "BE" }, ev({ ...night, mdeonVisa: "V-2026-1234" }))).toBe("be");
    expect(hospitalityGate({ profession: "Chirurgien-dentiste", country: "BE" }, ev())).toBe("be");
  });
  it("France, autre pays, compte sans profil", () => {
    expect(hospitalityGate({ profession: "Chirurgien-dentiste", country: "FR" }, ev(night))).toBe("fr");
    expect(hospitalityGate({ profession: "Chirurgien-dentiste", country: "CH" }, ev(night))).toBe("other");
    expect(hospitalityGate(null, ev(night))).toBe("none");
  });
});

describe("Frais d'inscription : seuil propre de 1 000 €, hors total", () => {
  const s = complianceSettings({});
  it("valeur réglementaire par défaut, jamais assouplie", () => {
    expect(DEFAULT_COMPLIANCE.registrationFeeMax).toBe(1000);
    expect(complianceSettings({ registrationFeeMax: 1500 }).registrationFeeMax).toBe(1000);
    expect(complianceSettings({ registrationFeeMax: 800 }).registrationFeeMax).toBe(800);
  });
  it("autorisation au-delà de 1 000 € ; ne compte pas dans les 2 000 € d'hospitalité", () => {
    expect(hospitalityRegime(s, [{ catalogId: "inscription", valueCents: 90000 }]).regime).toBe("declaration");
    expect(hospitalityRegime(s, [{ catalogId: "inscription", valueCents: 120000 }]).reason).toMatch(/^Frais d'inscription 1\s200 € > 1\s000 €$/u);
    expect(hospitalityRegime(s, [{ catalogId: "inscription", valueCents: 95000 }, { catalogId: "transport", valueCents: 140000 }]).regime).toBe("declaration");
  });
});
