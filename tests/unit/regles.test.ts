import { describe, expect, it } from "vitest";
import { canSee, kolViewer, kolVisibility, DEFAULT_KOL_VISIBILITY } from "@/lib/visibility";
import { safeNext } from "@/lib/safe-redirect";
import { eurToCents, intOrNull } from "@/lib/form";
import { complianceSettings, DEFAULT_COMPLIANCE, hospitalityRegime, projectRegime, remunerationRegime } from "@/lib/compliance";
import { fmvCheck, TRANSITIONS } from "@/lib/projects";
import { csvEscape, eventScope, parseParisDateTime, toCSV } from "@/lib/events";
import { orgNavItems, orgSectionTabs, itemMatches } from "@/lib/nav";
import { toIcs } from "@/lib/ics";
import { invitableRoles, isVerifiedOrg, roleLabel } from "@/lib/org-roles";
import { parseSiren, readSirenResponse, sirenKeyOk } from "@/lib/siren";
import { canBeExpert, drPrefix, isRpps, normalizeRpps } from "@/lib/professions";

const member = (kind: string, verification = "VERIFIED") => ({ organizationId: "o1", organization: { kind, verification } });

describe("visibilité des fiches expert", () => {
  it("le niveau « industriels » est réservé aux membres d'une organisation cliente", () => {
    expect(kolViewer(null, "p1")).toBe("public");
    expect(kolViewer({ practitioner: { id: "p1" }, memberships: [] }, "p1")).toBe("proprietaire");
    expect(kolViewer({ practitioner: { id: "p2" }, memberships: [] }, "p1")).toBe("connecte");
    expect(kolViewer({ practitioner: null, memberships: [member("PRESTATAIRE")] }, "p1")).toBe("connecte");
    expect(kolViewer({ practitioner: null, memberships: [member("INDUSTRIEL")] }, "p1")).toBe("membre");
    expect(kolViewer({ practitioner: null, memberships: [member("INDUSTRIEL", "PENDING")] }, "p1")).toBe("connecte");
  });

  it("canSee applique les trois niveaux", () => {
    expect(canSee("public", "public")).toBe(true);
    expect(canSee("industriels", "public")).toBe(false);
    expect(canSee("industriels", "connecte")).toBe(false);
    expect(canSee("industriels", "membre")).toBe(true);
    expect(canSee("masque", "membre")).toBe(false);
    expect(canSee("masque", "proprietaire")).toBe(true);
  });

  it("des réglages invalides retombent sur les valeurs par défaut", () => {
    expect(kolVisibility(null)).toEqual(DEFAULT_KOL_VISIBILITY);
    expect(kolVisibility({ contact: "n'importe quoi", tarif: "masque" })).toEqual({ ...DEFAULT_KOL_VISIBILITY, tarif: "masque" });
  });
});

describe("redirection après connexion", () => {
  it.each([
    ["/annuaire?q=a#x", "/annuaire?q=a#x"],
    ["/\\evil.com", "/fb"],
    ["//evil.com", "/fb"],
    ["https://evil.com", "/fb"],
    ["javascript:alert(1)", "/fb"],
    ["/\tevil", "/fb"],
    ["", "/fb"],
    ["/a/../../b", "/b"],
  ])("%s → %s", (input, expected) => expect(safeNext(input, "/fb")).toBe(expected));
});

describe("saisie des montants", () => {
  it.each([
    ["1 200,50", 120050],
    ["1 200", 120000],
    ["0", 0],
    ["12.345", 1235],
    ["", null],
    ["-5", null],
    ["abc", null],
  ])("%s → %s", (input, expected) => expect(eurToCents(input)).toBe(expected));

  it("refuse 0 quand demandé", () => expect(eurToCents("0", { allowZero: false })).toBeNull());
  it("entiers", () => {
    expect(intOrNull("12.6")).toBe(13);
    expect(intOrNull("-3")).toBe(0);
    expect(intOrNull("")).toBeNull();
  });
});

describe("régime anti-cadeaux", () => {
  const s = DEFAULT_COMPLIANCE;
  it("rémunération : seuil par convention et taux horaire", () => {
    expect(remunerationRegime(s, 150000, 1, "journée").regime).toBe("declaration");
    expect(remunerationRegime(s, 250000, 2, "journée").regime).toBe("autorisation");
    expect(remunerationRegime(s, 90000, 3, "heure").regime).toBe("autorisation");
    expect(remunerationRegime(s, 60000, 3, "heure").regime).toBe("declaration");
  });
  it("hospitalité : nuitée, repas et total", () => {
    expect(hospitalityRegime(s, [{ catalogId: "nuitee", valueCents: 14000 }, { catalogId: "dejeuner", valueCents: 3400 }]).regime).toBe("declaration");
    expect(hospitalityRegime(s, [{ catalogId: "nuitee", valueCents: 16000 }]).regime).toBe("autorisation");
    expect(hospitalityRegime(s, [{ catalogId: "cocktail", valueCents: 5500 }]).regime).toBe("autorisation");
  });
  it("paramètres d'organisation : valeurs invalides ignorées", () => {
    expect(complianceSettings({ hospitalityMealMax: 60, cumulAlert: -1 })).toEqual({ ...DEFAULT_COMPLIANCE, hospitalityMealMax: 60 });
  });
});

describe("dossiers", () => {
  it("juste contrepartie par unité", () => {
    expect(fmvCheck("symposium", 200000, 1)?.verdict).toBe("ok");
    expect(fmvCheck("symposium", 50000, 1)?.verdict).toBe("below");
    expect(fmvCheck("interview", 300000, 2)?.verdict).toBe("above");
    expect(fmvCheck("inconnu", 1000, 1)).toBeNull();
  });
  it("chaque transition part d'au moins un statut et la conformité seule valide ou bloque", () => {
    for (const [key, t] of Object.entries(TRANSITIONS)) {
      expect(t.from.length, key).toBeGreaterThan(0);
      if (key === "validate" || key === "block") expect(t.roles).toBe("compliance");
      else expect(t.roles).toBe("project");
    }
  });
});

describe("événements", () => {
  it("heure de Paris → UTC, été comme hiver", () => {
    expect(parseParisDateTime("2026-07-01T10:00")?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(parseParisDateTime("2026-12-01T10:00")?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(parseParisDateTime("01/12/2026 10:00")).toBeNull();
  });
  it("un prestataire mandaté ne voit que les événements confiés à son agence", () => {
    const user = { memberships: [{ organizationId: "client", organization: { kind: "INDUSTRIEL" } }, { organizationId: "agence", organization: { kind: "PRESTATAIRE" } }] };
    expect(eventScope(user, ["EVENEMENTS"])).toEqual({});
    expect(eventScope(user, ["PRESTATAIRE"])).toEqual({ agencyId: { in: ["agence"] } });
  });
  it("CSV lisible par Excel", () => {
    expect(csvEscape('a;"b"')).toBe('"a;""b"""');
    expect(toCSV([["x", null], ["y", 2]])).toBe("﻿x;\r\ny;2");
  });
  it("ICS : caractères spéciaux échappés et lignes repliées", () => {
    const ics = toIcs("Agenda", [{ uid: "e1", start: new Date("2026-07-01T08:00:00Z"), minutes: 90, title: "Implants; greffes, sinus", location: null }]);
    expect(ics).toContain("SUMMARY:Implants\\; greffes\\, sinus");
    expect(ics).toContain("DTEND:20260701T093000Z");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("navigation et rôles", () => {
  it("un prestataire n'a que l'accueil et les devis", () => {
    expect(orgNavItems("o", ["ADMIN"], "PRESTATAIRE").map((i) => i.key)).toEqual(["accueil", "devis"]);
    expect(orgSectionTabs("dossiers", "o", ["ADMIN"], "PRESTATAIRE")).toEqual([]);
  });
  it("la relecture ne voit que les supports à relire", () => {
    expect(orgNavItems("o", ["RELECTURE"], "INDUSTRIEL").map((i) => i.href)).toEqual(["/organisations/o", "/organisations/o/relecture"]);
  });
  it("correspondance des chemins", () => {
    expect(itemMatches({ href: "/organisations/o", exact: true }, "/organisations/o/dossiers")).toBe(false);
    expect(itemMatches({ href: "/organisations/o/dossiers" }, "/organisations/o/dossiers/p1")).toBe(true);
  });
  it("rôles proposés à l'invitation", () => {
    expect(invitableRoles("PRESTATAIRE")).toEqual(["ADMIN", "PRESTATAIRE"]);
    expect(invitableRoles("INDUSTRIEL")).toContain("CONFORMITE");
    expect(roleLabel("PRESTATAIRE", "PRESTATAIRE")).toBe("Membre de l'équipe");
    expect(roleLabel("PRESTATAIRE", "INDUSTRIEL")).toBe("Prestataire mandaté");
  });
});

describe("seuils d'autorisation de l'arrêté du 7 août 2020", () => {
  const s = DEFAULT_COMPLIANCE;
  it("rémunération : 800 € par demi-journée, soit 1 600 € par journée", () => {
    expect(remunerationRegime(s, 160000, 1, "journée").regime).toBe("declaration");
    expect(remunerationRegime(s, 180000, 1, "journée").regime).toBe("autorisation");
  });
  it("hospitalité : 15 € par collation", () => {
    expect(hospitalityRegime(s, [{ catalogId: "cafe", valueCents: 1200 }]).regime).toBe("declaration");
    expect(hospitalityRegime(s, [{ catalogId: "cafe", valueCents: 1800 }]).regime).toBe("autorisation");
  });
  it("dossier : autorisation dès qu'un expert engagé dépasse un seuil", () => {
    const experts = [
      { status: "ACCORD", feeCents: 120000, days: 1 },
      { status: "ACCORD", feeCents: 300000, days: 1 },
      { status: "DECLINE", feeCents: 900000, days: 1 },
    ];
    expect(projectRegime(s, "intervention", experts)?.regime).toBe("autorisation");
    expect(projectRegime(s, "intervention", experts.slice(0, 1))?.regime).toBe("declaration");
    expect(projectRegime(s, "intervention", [experts[2]])).toBeNull();
  });
});

describe("vérification des identités", () => {
  it("SIREN : saisie et clé de contrôle", () => {
    expect(parseSiren("542 051 180")).toBe("542051180");
    expect(parseSiren("54205118000066")).toBe("542051180");
    expect(parseSiren("12345")).toBeNull();
    expect(sirenKeyOk("542051180")).toBe(true);
    expect(sirenKeyOk("542051181")).toBe(false);
    expect(sirenKeyOk("356000000")).toBe(true);
  });
  it("lecture de la réponse du répertoire des entreprises", () => {
    expect(readSirenResponse("542051180", { results: [{ siren: "542051180", nom_complet: "TOTALENERGIES SE", etat_administratif: "A", siege: { libelle_commune: "COURBEVOIE" } }] }))
      .toEqual({ found: true, name: "TOTALENERGIES SE", active: true, city: "COURBEVOIE" });
    expect(readSirenResponse("542051180", { results: [{ siren: "999999999" }] })).toEqual({ found: false });
    expect(readSirenResponse("542051180", { results: [{ siren: "542051180", nom_raison_sociale: "X", etat_administratif: "C" }] })).toMatchObject({ found: true, active: false });
  });
  it("seuls les praticiens diplômés sont experts et docteurs", () => {
    expect(canBeExpert("Chirurgien-dentiste")).toBe(true);
    expect(canBeExpert("Assistant(e) dentaire")).toBe(false);
    expect(drPrefix("Médecin stomatologue")).toBe("Dr ");
    expect(drPrefix("Étudiant(e) en odontologie")).toBe("");
  });
  it("RPPS : 11 chiffres", () => {
    expect(isRpps(normalizeRpps("10 0012 3456 7"))).toBe(true);
    expect(isRpps("1234")).toBe(false);
  });
  it("organisation validée", () => {
    expect(isVerifiedOrg({ verification: "VERIFIED" })).toBe(true);
    expect(isVerifiedOrg({ verification: "PENDING" })).toBe(false);
  });
});

describe("e-mails", () => {
  it("lien absolu, texte brut et HTML échappé", async () => {
    process.env.APP_URL = "https://kolbase.example.fr";
    const { renderMail } = await import("@/lib/mail");
    const { text, html } = renderMail({ to: "a@b.fr", subject: "S", text: "Bonjour <Dr> & co", cta: { label: "Répondre", href: "/sollicitations/x" } });
    expect(text).toContain("Répondre : https://kolbase.example.fr/sollicitations/x");
    expect(html).toContain("Bonjour &lt;Dr&gt; &amp; co");
    expect(html).toContain('href="https://kolbase.example.fr/sollicitations/x"');
  });
  it("aucun envoi vers les adresses de démonstration (sauf levée explicite pour les tests)", async () => {
    const { isReservedAddress } = await import("@/lib/mail");
    const saved = process.env.MAIL_DELIVER_RESERVED;
    delete process.env.MAIL_DELIVER_RESERVED;
    expect(isReservedAddress("anne.chevalier@demo.kolbase.local")).toBe(true);
    expect(isReservedAddress("contact@exemple.fr")).toBe(false);
    process.env.MAIL_DELIVER_RESERVED = "1";
    expect(isReservedAddress("anne.chevalier@demo.kolbase.local")).toBe(false);
    if (saved === undefined) delete process.env.MAIL_DELIVER_RESERVED;
    else process.env.MAIL_DELIVER_RESERVED = saved;
  });
});

describe("textes légaux", () => {
  it("champ manquant affiché « à compléter » et listé", async () => {
    const { legal, missingLegal } = await import("@/lib/legal");
    expect(legal("editor")).toBe("Mutara France");
    expect(legal("registration")).toBe("[immatriculation (RCS et SIREN) à compléter]");
    expect(missingLegal()).toContain("directeur de la publication");
  });
});
