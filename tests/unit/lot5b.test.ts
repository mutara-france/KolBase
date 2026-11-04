import { describe, expect, it } from "vitest";
import { authLink, organisationOrigin, originOf } from "@/lib/safe-redirect";
import { linesTtc, mainVat, quoteTtc, quoteVatLabel, readLines } from "@/lib/quotes";
import { stripePause } from "@/lib/billing-plans";
import { mailingSlot, nextParisMonthStart } from "@/lib/newsletter";
import { inSentence } from "@/lib/elision";
import { eventState, formatDuration, orgEventStatus } from "@/lib/events";
import { callFull } from "@/lib/projects";
import { perHeadLabel, perParticipant } from "@/lib/quotes";

describe("entrée : page d'origine et profil gardés", () => {
  it("l'en-tête public transmet la page courante, sauf l'accueil et les pages d'authentification", () => {
    expect(originOf("/evenements/abc")).toBe("/evenements/abc");
    expect(originOf("/")).toBe("");
    expect(originOf("/connexion")).toBe("");
    expect(originOf("/inscription")).toBe("");
    expect(originOf("/mot-de-passe-oublie")).toBe("");
    expect(originOf("/mot-de-passe/abc")).toBe("");
    expect(originOf("/confirmer-email/abc")).toBe("");
    expect(originOf("//evil.example")).toBe("");
  });
  it("liens entre pages d'authentification : profil puis page d'origine", () => {
    expect(authLink("/connexion", "")).toBe("/connexion");
    expect(authLink("/connexion", "/evenements")).toBe("/connexion?next=%2Fevenements");
    expect(authLink("/inscription", "/invitation/abc", "organisation")).toBe("/inscription?profil=organisation&next=%2Finvitation%2Fabc");
    expect(authLink("/inscription", null, "organisation")).toBe("/inscription?profil=organisation");
  });
  it("profil « organisation » déduit d'une invitation ou d'une création d'organisation", () => {
    expect(organisationOrigin("/invitation/abc")).toBe(true);
    expect(organisationOrigin("/organisations/nouvelle")).toBe(true);
    expect(organisationOrigin("/evenements")).toBe(false);
    expect(organisationOrigin(undefined)).toBe(false);
  });
});

describe("devis : TVA par ligne", () => {
  const lines = [
    { label: "Repas", qty: 40, unitCents: 3500, vatBp: 1000 },
    { label: "Vin", qty: 10, unitCents: 2000, vatBp: 2000 },
  ];
  it("total TTC : chaque ligne à son taux", () => {
    // 140 000 HT à 10 % + 20 000 HT à 20 %.
    expect(linesTtc(lines, 2000)).toBe(154000 + 24000);
  });
  it("taux du devis : unique, sinon celui du plus gros montant HT", () => {
    expect(mainVat(lines, 2000)).toBe(1000);
    expect(mainVat([{ label: "Salle", qty: 1, unitCents: 100 }], 550)).toBe(550);
  });
  it("lignes antérieures sans taux : celui du devis ; taux invalide ignoré", () => {
    const read = readLines([{ label: "Cocktail", qty: 2, unitCents: 1000 }, { label: "X", qty: 1, unitCents: 100, vatBp: 1234 }]);
    expect(read.every((l) => l.vatBp === undefined)).toBe(true);
    expect(linesTtc(read, 1000)).toBe(2200 + 110);
  });
  it("total enregistré, sinon montant HT au taux du devis ; libellé des taux", () => {
    expect(quoteTtc({ amountCents: 10000, vatBp: 1000, ttcCents: 11500 })).toBe(11500);
    expect(quoteTtc({ amountCents: 10000, vatBp: 1000, ttcCents: null })).toBe(11000);
    expect(quoteVatLabel({ vatBp: 2000, lines })).toBe("10 % et 20 %");
    expect(quoteVatLabel({ vatBp: 550, lines: [] })).toBe("5,5 %");
  });
});

describe("administration : suspension, gratuité, plafond de la lettre, motifs", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  it("Stripe : pause sans reprise pendant la suspension ; jusqu'à la fin d'une gratuité ; sinon facturé", () => {
    const until = new Date("2026-12-01T22:59:00Z");
    expect(stripePause({ suspended: true, exemptUntil: until }, now)).toEqual({ pause: true, resumesAt: null });
    expect(stripePause({ suspended: false, exemptUntil: until }, now)).toEqual({ pause: true, resumesAt: until });
    expect(stripePause({ suspended: false, exemptUntil: new Date("2026-11-01T00:00:00Z") }, now)).toEqual({ pause: false });
    expect(stripePause({ suspended: false, exemptUntil: null }, now)).toEqual({ pause: false });
  });
  it("e-mailing : plafond atteint, prochain envoi le 1er du mois suivant, refusé si l'événement a lieu avant", () => {
    expect(nextParisMonthStart(now).toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(nextParisMonthStart(new Date("2026-12-20T10:00:00Z")).toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(mailingSlot(1, new Date("2026-11-20T18:00:00Z"), now)).toMatchObject({ capped: false, tooLate: false, message: null });
    const late = mailingSlot(2, new Date("2026-11-28T18:00:00Z"), now);
    expect(late).toMatchObject({ capped: true, tooLate: true });
    expect(late.message).toContain("prochain envoi possible le 1er décembre 2026");
    expect(mailingSlot(2, new Date("2026-12-10T18:00:00Z"), now)).toMatchObject({ capped: true, tooLate: false });
  });
  it("motif inséré dans une phrase : sans point final", () => {
    expect(inSentence("Numéro RNA introuvable.")).toBe("Numéro RNA introuvable");
    expect(inSentence("  Contrôle en cours ")).toBe("Contrôle en cours");
  });
});

describe("événements : états dans le temps communs", () => {
  const now = new Date("2026-11-15T18:30:00Z");
  const ev = { startsAt: new Date("2026-11-15T18:00:00Z"), durationMinutes: 120, cancelledAt: null, registrationOpen: true, capacity: 50, internal: false, publishedAt: new Date("2026-11-01T00:00:00Z") };
  it("en cours dès le début (inscriptions closes), passé après la fin, complet, annulé", () => {
    expect(eventState(ev, 10, now)).toMatchObject({ moment: "en_cours", state: "en_cours", upcoming: false, canRegister: false });
    expect(eventState(ev, 10, new Date("2026-11-15T20:30:00Z")).state).toBe("passe");
    expect(eventState(ev, 50, new Date("2026-11-14T10:00:00Z"))).toMatchObject({ state: "complet", upcoming: true, canRegister: false });
    expect(eventState({ ...ev, cancelledAt: now }, 10, now).state).toBe("annule");
  });
  it("côté organisation : en cours, masqué pendant la suspension, brouillon", () => {
    expect(orgEventStatus(ev, 10, { suspended: false }, now).label).toBe("En cours · inscriptions closes");
    expect(orgEventStatus(ev, 10, { suspended: true }, now).label).toBe("Masqué (organisation suspendue)");
    expect(orgEventStatus({ ...ev, publishedAt: null }, 0, { suspended: false }, now).label).toBe("Brouillon");
    expect(orgEventStatus(ev, 50, { suspended: false }, new Date("2026-11-14T10:00:00Z")).label).toBe("Publié · complet");
  });
});

describe("finitions : durées, appels complets, seuils", () => {
  it("durée lisible, la même partout", () => {
    expect(formatDuration(15)).toBe("15 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30");
    expect(formatDuration(125)).toBe("2 h 05");
    expect(formatDuration(90, "en")).toBe("1h30");
  });
  it("appel complet : places pourvues", () => {
    expect(callFull({ slots: 1, _count: { applications: 1 } })).toBe(true);
    expect(callFull({ slots: 2, _count: { applications: 1 } })).toBe(false);
    expect(callFull({ slots: null, _count: { applications: 5 } })).toBe(false);
  });
  it("seuil d'une nuitée, d'un repas ; couvert commandé pour la restauration", () => {
    const s = { hospitalityMealMax: 60, hospitalityNightMax: 150 } as Parameters<typeof perParticipant>[3];
    expect(perParticipant("hebergement", 20000, 1, s)?.limit?.of).toBe("d'une nuitée");
    expect(perParticipant("restauration", 2000, 1, s)?.limit?.of).toBe("d'un repas");
    expect(perHeadLabel("restauration")).toBe("par couvert commandé");
    expect(perHeadLabel("salle")).toBe("par participant prévu");
  });
});
