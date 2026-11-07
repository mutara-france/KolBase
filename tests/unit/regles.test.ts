import { describe, expect, it } from "vitest";
import { canSee, kolViewer, kolVisibility, DEFAULT_KOL_VISIBILITY } from "@/lib/visibility";
import { safeNext } from "@/lib/safe-redirect";
import { eurToCents, intOrNull, unitsOrNull } from "@/lib/form";
import { sniffLogo } from "@/lib/logos";
import { complianceSettings, DEFAULT_COMPLIANCE, hospitalityRegime, projectRegime, remunerationRegime } from "@/lib/compliance";
import { fmvCheck, recruitmentOpen, TRANSITIONS } from "@/lib/projects";
import { csvEscape, eventScope, parseParisDateTime, toCSV } from "@/lib/events";
import { orgNavItems, orgSectionTabs, itemMatches } from "@/lib/nav";
import { toIcs } from "@/lib/ics";
import { invitableRoles, isVerifiedOrg, roleLabel } from "@/lib/org-roles";
import { parseSiren, readSirenResponse, sirenKeyOk } from "@/lib/siren";
import { canBeExpert, drPrefix, isRpps, normalizeRpps, withLuhn } from "@/lib/professions";
import { isVatBp, linesTotal, perParticipant, readLines, withVat } from "@/lib/quotes";

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
    expect(remunerationRegime(s, { feeCents: 150000, days: 1 }, "journée").regime).toBe("declaration");
    expect(remunerationRegime(s, { feeCents: 250000, days: 2 }, "journée").regime).toBe("autorisation");
    expect(remunerationRegime(s, { feeCents: 90000, days: 3 }, "heure").regime).toBe("autorisation");
    expect(remunerationRegime(s, { feeCents: 60000, days: 3 }, "heure").regime).toBe("declaration");
  });
  it("hospitalité : nuitée, repas et total", () => {
    expect(hospitalityRegime(s, [{ catalogId: "nuitee", valueCents: 14000 }, { catalogId: "dejeuner", valueCents: 3400 }]).regime).toBe("declaration");
    expect(hospitalityRegime(s, [{ catalogId: "nuitee", valueCents: 16000 }]).regime).toBe("autorisation");
    expect(hospitalityRegime(s, [{ catalogId: "cocktail", valueCents: 5500 }]).regime).toBe("autorisation");
  });
  it("paramètres d'organisation : valeurs invalides ignorées", () => {
    expect(complianceSettings({ hospitalityMealMax: 40, cumulAlert: -1 })).toEqual({ ...DEFAULT_COMPLIANCE, hospitalityMealMax: 40 });
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
    expect(eventScope(user, ["PROJETS"])).toEqual({});
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

describe("dates à Paris", () => {
  it("la date du jour suit le fuseau de Paris, pas l'UTC", async () => {
    const { parisToday } = await import("@/lib/events");
    expect(parisToday(new Date("2026-11-03T23:30:00Z"))).toBe("2026-11-04");
    expect(parisToday(new Date("2026-07-14T21:59:00Z"))).toBe("2026-07-14");
    expect(parisToday(new Date("2026-07-14T22:01:00Z"))).toBe("2026-07-15");
  });
});

describe("navigation et rôles", () => {
  it("un prestataire n'a que l'accueil, les devis et son book", () => {
    expect(orgNavItems("o", ["ADMIN"], "PRESTATAIRE").map((i) => i.key)).toEqual(["accueil", "devis", "book"]);
    expect(orgSectionTabs("dossiers", "o", ["ADMIN"], "PRESTATAIRE")).toEqual([]);
  });
  it("la conformité voit les dossiers et la conformité, pas les praticiens ni les événements", () => {
    expect(orgNavItems("o", ["CONFORMITE"], "INDUSTRIEL").map((i) => i.key)).toEqual(["accueil", "dossiers", "conformite", "statistiques"]);
    expect(orgNavItems("o", ["PROJETS"], "INDUSTRIEL").map((i) => i.key)).toEqual(["accueil", "praticiens", "dossiers", "evenements", "statistiques"]);
  });
  it("les statistiques sont réservées au pilotage et absentes de la barre mobile au-delà de cinq entrées", () => {
    expect(orgNavItems("o", ["PRESTATAIRE"], "INDUSTRIEL").map((i) => i.key)).not.toContain("statistiques");
    // Administrateur qui tient aussi la conformité : six rubriques, dont Statistiques hors de la barre mobile.
    const admin = orgNavItems("o", ["ADMIN", "CONFORMITE"], "INDUSTRIEL");
    expect(admin.length).toBe(6);
    expect(admin.filter((i) => !i.secondary).length).toBe(5);
  });
  it("l'administrateur n'a la conformité que s'il en a aussi le rôle", () => {
    expect(orgNavItems("o", ["ADMIN"], "INDUSTRIEL").map((i) => i.key)).toEqual(["accueil", "praticiens", "dossiers", "evenements", "statistiques"]);
    expect(orgNavItems("o", ["ADMIN", "CONFORMITE"], "INDUSTRIEL").map((i) => i.key)).toContain("conformite");
  });
  it("la relecture des supports est rangée dans la conformité, sur un seul niveau d'onglets", () => {
    expect(orgSectionTabs("dossiers", "o", ["ADMIN"], "INDUSTRIEL").map((t) => t.key)).toEqual(["dossiers"]);
    expect(orgSectionTabs("conformite", "o", ["CONFORMITE"], "INDUSTRIEL").map((t) => t.key)).toEqual(["a-valider", "relecture", "autorisations", "hospitalites", "registre", "transparence", "parametres"]);
    expect(orgSectionTabs("conformite", "o", ["PROJETS"], "INDUSTRIEL")).toEqual([]);
  });
  it("correspondance des chemins", () => {
    expect(itemMatches({ href: "/organisations/o", exact: true }, "/organisations/o/dossiers")).toBe(false);
    expect(itemMatches({ href: "/organisations/o/dossiers" }, "/organisations/o/dossiers/p1")).toBe(true);
  });
  it("rôles proposés à l'invitation", () => {
    expect(invitableRoles("PRESTATAIRE")).toEqual(["ADMIN", "PRESTATAIRE"]);
    expect(invitableRoles("INDUSTRIEL")).toContain("CONFORMITE");
    expect(roleLabel("PRESTATAIRE", "PRESTATAIRE")).toBe("Membre de l'équipe");
    expect(roleLabel("PRESTATAIRE", "INDUSTRIEL")).toBe("Agence mandatée");
    expect(invitableRoles("INDUSTRIEL")).toEqual(["ADMIN", "PROJETS", "CONFORMITE"]);
  });
});

describe("seuils d'autorisation de l'arrêté du 7 août 2020", () => {
  const s = DEFAULT_COMPLIANCE;
  it("rémunération : 800 € par demi-journée, soit 1 600 € par journée", () => {
    expect(remunerationRegime(s, { feeCents: 160000, days: 1 }, "journée").regime).toBe("declaration");
    expect(remunerationRegime(s, { feeCents: 180000, days: 1 }, "journée").regime).toBe("autorisation");
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
    expect(isRpps(normalizeRpps("10 0006 6854 0"))).toBe(true); // exemple de l'ANS
    expect(isRpps("1234")).toBe(false);
    expect(isRpps("10001234567")).toBe(false); // clé de Luhn fausse
    expect(isRpps("31234567890")).toBe(false); // numéro INAMI belge
    expect(isRpps(withLuhn("9990000001"))).toBe(true);
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
    expect(legal("editor")).toBe("MUTARA");
    expect(legal("capital")).toBe("100 €");
    expect(legal("storageProvider")).toBe("[hébergeur des documents à compléter]");
    expect(legal("signatureProvider")).toContain("Youtrust SAS");
    expect(missingLegal()).toEqual(["hébergeur des documents"]);
  });
});

describe("campagne de tests : entrées piégées", () => {
  const s = DEFAULT_COMPLIANCE;
  it("CSV : formules neutralisées, nombres intacts", () => {
    expect(csvEscape('=HYPERLINK("http://x";"clic")')).toBe(`"'=HYPERLINK(""http://x"";""clic"")"`);
    expect(csvEscape("+33 6 12 34 56 78")).toBe("'+33 6 12 34 56 78");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape(-12)).toBe("-12");
    expect(csvEscape("Dupont")).toBe("Dupont");
  });
  it("volume : positif et plausible, sinon refusé", () => {
    expect(unitsOrNull("")).toBeNull();
    expect(unitsOrNull("2,5")).toBe(2.5);
    expect(unitsOrNull("-1")).toBeUndefined();
    expect(unitsOrNull("0")).toBeUndefined();
    expect(unitsOrNull("abc")).toBeUndefined();
    expect(unitsOrNull("100000")).toBeUndefined();
  });
  it("régime : un volume absent ou négatif ne contourne pas le seuil horaire", () => {
    expect(remunerationRegime(s, { feeCents: 150000, days: null }, "heure").regime).toBe("autorisation");
    expect(remunerationRegime(s, { feeCents: 150000, days: -1 }, "heure").regime).toBe("autorisation");
    expect(remunerationRegime(s, { feeCents: 150000, days: 10 }, "heure").regime).toBe("declaration");
    expect(remunerationRegime(s, { feeCents: 170000, days: null }, "journée").regime).toBe("autorisation");
    // Volume horaire déclaré : le taux horaire réel est contrôlé, quelle que soit l'unité.
    expect(remunerationRegime(s, { feeCents: 150000, days: 1, prepHours: 4, interventionHours: 3 }, "intervention").regime).toBe("autorisation");
    expect(remunerationRegime(s, { feeCents: 150000, days: 1, prepHours: 4, interventionHours: 3, travelHours: 1 }, "intervention").regime).toBe("declaration");
    expect(remunerationRegime(s, { feeCents: 150000, days: 1, prepHours: 4, interventionHours: 3 }, "intervention").reason).toBe("214 €/h > 200 €/h (7 h déclarées)");
  });
  it("logo : contenu réel contrôlé (pas de SVG ni de fichier renommé)", () => {
    expect(sniffLogo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffLogo(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffLogo(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("praticiens exerçant hors de France", () => {
  const s = DEFAULT_COMPLIANCE;
  it("identifiants : NPI (préfixe 80840), INAMI, autres pays", async () => {
    const { isNpi, isInami, licenseRule } = await import("@/lib/countries");
    expect(isNpi("1234567893")).toBe(true); // exemple de la CMS
    expect(isNpi("1234567898")).toBe(false);
    expect(isInami("31234567890")).toBe(true);
    expect(isInami("3123456789")).toBe(false);
    expect(licenseRule("ES").valid("Colegio de Dentistas de Madrid 12345")).toBe(true);
    expect(licenseRule("ES").valid("12")).toBe(false);
  });
  it("régime : tous les experts hors de France → pas de démarche EPS", () => {
    const be = { status: "ACCORD", feeCents: 500000, days: 1, country: "BE" };
    const fr = { status: "ACCORD", feeCents: 500000, days: 1, country: "FR" };
    expect(projectRegime(s, "journée", [be])?.regime).toBe("hors_france");
    expect(projectRegime(s, "journée", [be, fr])?.regime).toBe("autorisation"); // l'expert français reste soumis au régime
    expect(projectRegime(s, "journée", [{ ...be, country: "US" }, be])?.regime).toBe("hors_france");
    expect(projectRegime(s, "journée", [{ status: "ACCORD", feeCents: 50000, days: 1 }])?.regime).toBe("declaration"); // pays absent = France
  });
  it("obligations et clause de convention selon le pays", async () => {
    const { foreignObligations, conventionClause } = await import("@/lib/countries");
    expect(foreignObligations("BE").join(" ")).toContain("betransparent.be");
    expect(foreignObligations("US").join(" ")).toContain("Open Payments");
    expect(conventionClause("FR")[0]).toContain("L.1453-1");
    expect(conventionClause("BE")[0]).toContain("en Belgique");
  });
});

describe("traductions", () => {
  it("le français sert de clé, repli sur le français sans traduction", async () => {
    const { translate } = await import("@/lib/i18n");
    expect(translate("fr", "Se connecter")).toBe("Se connecter");
    expect(translate("en", "Se connecter")).toBe("Sign in");
    expect(translate("en", "Texte sans traduction")).toBe("Texte sans traduction");
    // Clé avec élision (« de Dentalys », « d'Académie… ») : l'anglais reprend le nom seul.
    expect(translate("en", "Nouvelle sollicitation {de_org}", { org: "Dentalys", de_org: "de Dentalys" })).toBe("New collaboration request from Dentalys");
    expect(translate("fr", "Nouvelle sollicitation {de_org}", { org: "Académie", de_org: "d'Académie" })).toBe("Nouvelle sollicitation d'Académie");
    expect(translate("en", "Chirurgien-dentiste")).toBe("Dentist");
  });
  it("e-mail dans la langue du destinataire", async () => {
    const { renderMail } = await import("@/lib/mail");
    const en = renderMail({ to: "x@y.fr", subject: "s", text: "Hello", locale: "en" });
    expect(en.html).toContain('lang="en"');
    expect(en.text).toContain("Manage your notifications");
    expect(renderMail({ to: "x@y.fr", subject: "s", text: "Bonjour" }).text).toContain("Gérer vos notifications");
  });
});

describe("audit : garde-fous", () => {
  it("seuils réglementaires : plus stricts possible, jamais plus souples", () => {
    expect(complianceSettings({ remunerationHourlyMax: 1000 }).remunerationHourlyMax).toBe(200);
    expect(complianceSettings({ remunerationHourlyMax: 150 }).remunerationHourlyMax).toBe(150);
    expect(complianceSettings({ hospitalityMealMax: 80 }).hospitalityMealMax).toBe(50);
    expect(complianceSettings({ declarationDays: 2 }).declarationDays).toBe(8);
    expect(complianceSettings({ declarationDays: 15 }).declarationDays).toBe(15);
    expect(complianceSettings({ cumulAlert: 50000 }).cumulAlert).toBe(50000);
  });
  it("dates impossibles refusées", () => {
    expect(parseParisDateTime("2026-02-31T10:00")).toBeNull();
    expect(parseParisDateTime("2026-04-31T10:00")).toBeNull();
    expect(parseParisDateTime("2026-05-10T25:00")).toBeNull();
    expect(parseParisDateTime("2028-02-29T10:00")?.toISOString()).toBe("2028-02-29T09:00:00.000Z");
  });
  it("montants bornés (représentables en centimes)", () => {
    expect(eurToCents("1e20")).toBeNull();
    expect(eurToCents("10000001")).toBeNull();
    expect(eurToCents("9 999 999,99")).toBe(999999999);
  });
  it("recrutement : ouvert jusqu'à la soumission à la conformité", () => {
    expect(recruitmentOpen("ATT_EXPERTS")).toBe(true);
    expect(recruitmentOpen("ACCORD")).toBe(true);
    expect(recruitmentOpen("EN_VALID")).toBe(false);
    expect(recruitmentOpen("SIGNE")).toBe(false);
  });
  it("régime : une sollicitation sans réponse ne pèse pas une fois un expert engagé", () => {
    const s = DEFAULT_COMPLIANCE;
    const experts = [
      { status: "ACCORD", feeCents: 150000, days: 1 },
      { status: "ATT_EXPERTS", feeCents: 500000, days: 1 },
    ];
    expect(projectRegime(s, "journée", experts)?.regime).toBe("declaration");
    expect(projectRegime(s, "journée", [experts[1]])?.regime).toBe("autorisation");
  });
});

describe("devis détaillés", () => {
  it("relit les lignes sans confiance et calcule HT et TTC", () => {
    const lines = readLines([{ label: "Cocktail", qty: 60, unitCents: 3200 }, { label: "Service", qty: 1, unitCents: 30000 }, { label: 3, qty: 1, unitCents: 1 }, null, "x"]);
    expect(lines).toHaveLength(2);
    expect(linesTotal(lines)).toBe(222000);
    expect(withVat(222000, 1000)).toBe(244200);
    expect(withVat(330100, 2000)).toBe(396120);
    expect(readLines({ label: "pas un tableau" })).toEqual([]);
  });
  it("n'accepte que les taux de TVA prévus", () => {
    expect(isVatBp(2000) && isVatBp(1000) && isVatBp(550) && isVatBp(0)).toBe(true);
    expect(isVatBp(1960)).toBe(false);
  });
  it("rapproche le coût par participant du seuil d'un repas ou d'une nuitée", () => {
    const s = complianceSettings({});
    const ok = perParticipant("restauration", 283800, 60, s)!;
    expect(ok.each).toBeCloseTo(47.3, 2);
    expect(ok.limit?.what).toBe("repas");
    expect(ok.over).toBe(false);
    expect(perParticipant("restauration", 323400, 60, s)!.over).toBe(true);
    expect(perParticipant("hebergement", 520000, 40, s)!.limit?.what).toBe("nuitée");
    expect(perParticipant("salle", 129600, 8, s)!.limit).toBeNull();
    expect(perParticipant("salle", 129600, null, s)).toBeNull();
  });
});
