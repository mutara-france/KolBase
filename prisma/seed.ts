/**
 * Données de démonstration Kolbase — entièrement fictives.
 * Idempotent : identifiants fixes « demo-… », relançable sans doublon.
 *
 * Variables facultatives :
 *  - DEMO_PASSWORD     : mot de passe attribué à tous les comptes de démo (sinon, comptes sans mot de passe).
 *  - DEMO_ADMIN_EMAILS : e-mails (séparés par des virgules) de comptes existants à rendre administrateurs
 *                        des organisations de démo.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type OrgKind, type OrgRole, type ProjectStatus, type EventFormat } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const DAY = 864e5;
const at = (days: number, hour = 9) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour - 2, 0, 0, 0); // ≈ heure de Paris
  return d;
};
const MAIL = "demo.kolbase.local";

// ─── Organisations ─────────────────────────────────────────────────────────
const ORGS: { id: string; name: string; kind: OrgKind; sector: string; hq: string; areas: string[]; about: string; policy: string }[] = [
  { id: "demo-org-dentalys", name: "Dentalys Implants", kind: "INDUSTRIEL", sector: "Dispositifs médicaux", hq: "Lyon, France",
    areas: ["Implantologie", "Chirurgie orale", "Prothèse, CFAO"],
    about: "Fabricant fictif d'implants et de solutions de chirurgie guidée. Organisation de démonstration.",
    policy: "Toute collaboration fait l'objet d'une convention écrite déposée auprès de l'Ordre. Les honoraires suivent une grille de juste contrepartie révisée chaque année." },
  { id: "demo-org-orthonova", name: "OrthoNova", kind: "INDUSTRIEL", sector: "Orthodontie", hq: "Nantes, France",
    areas: ["Orthodontie", "Aligneurs", "Imagerie 3D"],
    about: "Société fictive spécialisée dans les aligneurs orthodontiques. Organisation de démonstration.",
    policy: "Nous privilégions des collaborations pluriannuelles avec des experts indépendants, sans exclusivité." },
  { id: "demo-org-cdra", name: "Collège Dentaire Rhône-Alpes", kind: "SOCIETE_SAVANTE", sector: "Société savante", hq: "Grenoble, France",
    areas: ["Parodontologie", "Implantologie", "Formation continue"],
    about: "Société savante fictive organisant des journées scientifiques régionales. Organisation de démonstration.",
    policy: "Les intervenants sont défrayés ; aucune rémunération sans convention." },
  { id: "demo-org-academie", name: "Académie Odonto Formation", kind: "ORGANISME_FORMATION", sector: "Formation DPC", hq: "Paris, France",
    areas: ["DPC", "Endodontie", "Esthétique"],
    about: "Organisme de formation fictif proposant des sessions DPC et des travaux pratiques. Organisation de démonstration.",
    policy: "Formateurs rémunérés à la journée selon la grille de l'organisme." },
  { id: "demo-org-mediane", name: "Agence Médiane Événements", kind: "PRESTATAIRE", sector: "Logistique événementielle", hq: "Marseille, France",
    areas: ["Congrès", "Hospitalités"],
    about: "Agence fictive mandatée pour la logistique d'événements scientifiques. Organisation de démonstration.",
    policy: "Agit uniquement sur mandat écrit d'une organisation." },
];

// ─── Membres d'organisations ───────────────────────────────────────────────
const STAFF: { id: string; first: string; last: string; org: string; roles: OrgRole[] }[] = [
  { id: "demo-u-claire", first: "Claire", last: "Morel", org: "demo-org-dentalys", roles: ["ADMIN"] },
  { id: "demo-u-julien", first: "Julien", last: "Faure", org: "demo-org-dentalys", roles: ["EDUCATION"] },
  { id: "demo-u-marc", first: "Marc", last: "Lefèvre", org: "demo-org-dentalys", roles: ["EVENEMENTS"] },
  { id: "demo-u-sophie", first: "Sophie", last: "Bernard", org: "demo-org-dentalys", roles: ["CONFORMITE"] },
  { id: "demo-u-nadia", first: "Nadia", last: "Haddad", org: "demo-org-dentalys", roles: ["RELECTURE"] },
  { id: "demo-u-thomas", first: "Thomas", last: "Garnier", org: "demo-org-orthonova", roles: ["ADMIN", "CUMUL"] },
  { id: "demo-u-lea", first: "Léa", last: "Rousseau", org: "demo-org-orthonova", roles: ["CONFORMITE"] },
  { id: "demo-u-pierre", first: "Pierre", last: "Vidal", org: "demo-org-cdra", roles: ["ADMIN", "CUMUL"] },
  { id: "demo-u-anne", first: "Anne", last: "Chevalier", org: "demo-org-academie", roles: ["ADMIN", "CUMUL"] },
  { id: "demo-u-karim", first: "Karim", last: "Benali", org: "demo-org-mediane", roles: ["ADMIN"] },
  { id: "demo-u-karim", first: "Karim", last: "Benali", org: "demo-org-dentalys", roles: ["PRESTATAIRE"] },
];

// ─── Praticiens (experts référencés et participants) ───────────────────────
type Prac = {
  id: string; first: string; last: string; profession: string; city: string; specialty?: string; sub?: string; hospital?: string;
  listed: boolean; bio?: string; langs?: string[]; types?: string[]; rate?: number; orcid?: string;
};
const PRACS: Prac[] = [
  { id: "demo-p-durand", first: "Hélène", last: "Durand", profession: "Chirurgien-dentiste", city: "Lyon", specialty: "Implantologie", sub: "Greffes osseuses", hospital: "Hospices Civils (fictif)", listed: true,
    bio: "Praticienne hospitalière, 15 ans d'expérience en implantologie et régénération osseuse. Responsable d'un DU d'implantologie.", langs: ["fr", "en"], types: ["Conférence", "Formation / atelier pratique", "Board scientifique"], rate: 2200, orcid: "0000-0002-1825-0097" },
  { id: "demo-p-martin", first: "Antoine", last: "Martin", profession: "Chirurgien oral", city: "Paris", specialty: "Chirurgie orale", sub: "Chirurgie guidée", hospital: "Cabinet Martin & associés", listed: true,
    bio: "Chirurgien oral exclusif, conférencier international sur la chirurgie guidée et le flux numérique.", langs: ["fr", "en", "es"], types: ["Conférence", "Démonstration produit", "Webinaire"], rate: 2800 },
  { id: "demo-p-nguyen", first: "Linh", last: "Nguyen", profession: "Chirurgien-dentiste", city: "Bordeaux", specialty: "Parodontologie", hospital: "CHU (fictif)", listed: true,
    bio: "Maître de conférences en parodontologie, travaux sur la péri-implantite et la chirurgie muco-gingivale.", langs: ["fr", "en"], types: ["Conférence", "Rédaction scientifique", "Étude clinique"], rate: 1800 },
  { id: "demo-p-petit", first: "Camille", last: "Petit", profession: "Chirurgien-dentiste spécialiste ODF", city: "Nantes", specialty: "Orthodontie", sub: "Aligneurs", listed: true,
    bio: "Orthodontiste en libéral, utilisatrice avancée des aligneurs, formatrice pour plusieurs réseaux.", langs: ["fr"], types: ["Formation / atelier pratique", "Webinaire", "Board scientifique"], rate: 1600 },
  { id: "demo-p-roux", first: "Mathieu", last: "Roux", profession: "Chirurgien-dentiste", city: "Marseille", specialty: "Endodontie", listed: true,
    bio: "Exercice exclusif en endodontie, microscope opératoire. Animateur de travaux pratiques sur simulateur.", langs: ["fr", "it"], types: ["Formation / atelier pratique", "Relecture de supports"], rate: 1500 },
  { id: "demo-p-fontaine", first: "Isabelle", last: "Fontaine", profession: "Chirurgien-dentiste", city: "Toulouse", specialty: "Esthétique", sub: "Facettes céramiques", listed: true,
    bio: "Dentisterie esthétique et adhésive. Auteure d'un ouvrage sur les facettes en céramique.", langs: ["fr", "en"], types: ["Conférence", "Rédaction scientifique", "Webinaire"], rate: 2000 },
  { id: "demo-p-girard", first: "Olivier", last: "Girard", profession: "Chirurgien-dentiste", city: "Lille", specialty: "Prothèse", sub: "CFAO", listed: true,
    bio: "Prothésiste de formation devenu chirurgien-dentiste ; spécialiste de la CFAO et du flux numérique complet.", langs: ["fr", "nl"], types: ["Démonstration produit", "Formation / atelier pratique"], rate: 1700 },
  { id: "demo-p-mercier", first: "Sarah", last: "Mercier", profession: "Chirurgien-dentiste", city: "Strasbourg", specialty: "Pédodontie", listed: true,
    bio: "Odontologie pédiatrique, prise en charge des patients à besoins spécifiques.", langs: ["fr", "de"], types: ["Conférence", "Webinaire"], rate: 1300 },
  { id: "demo-p-blanc", first: "Nicolas", last: "Blanc", profession: "Chirurgien oral", city: "Grenoble", specialty: "Chirurgie orale", sub: "Sinus lift", hospital: "CHU (fictif)", listed: true,
    bio: "Praticien hospitalier, investigateur principal de deux études multicentriques sur les implants courts.", langs: ["fr", "en"], types: ["Étude clinique", "Board scientifique", "Conférence"], rate: 2400 },
  { id: "demo-p-lemoine", first: "Julie", last: "Lemoine", profession: "Chirurgien-dentiste", city: "Rennes", specialty: "Parodontologie", listed: true,
    bio: "Parodontiste libérale, enseignante attachée. Intérêt pour la prévention et l'hygiène.", langs: ["fr"], types: ["Webinaire", "Rédaction scientifique"], rate: 1200 },
  { id: "demo-p-moreau", first: "Vincent", last: "Moreau", profession: "Chirurgien-dentiste", city: "Nice", specialty: "Implantologie", sub: "Mise en charge immédiate", listed: true,
    bio: "Implantologie à mise en charge immédiate, plus de 3 000 implants posés. Démonstrations en direct.", langs: ["fr", "en"], types: ["Conférence", "Démonstration produit"], rate: 3200 },
  { id: "demo-p-simon", first: "Emma", last: "Simon", profession: "Chirurgien-dentiste", city: "Montpellier", specialty: "Occlusodontie", listed: true,
    bio: "Troubles temporo-mandibulaires et occlusodontie ; formatrice DPC.", langs: ["fr", "es"], types: ["Formation / atelier pratique", "Conférence"], rate: 1400 },
  // Praticiens non référencés : participants aux événements uniquement.
  { id: "demo-p-lambert", first: "Inès", last: "Lambert", profession: "Chirurgien-dentiste", city: "Lyon", hospital: "Cabinet dentaire des Brotteaux", listed: false },
  { id: "demo-p-robert", first: "Hugo", last: "Robert", profession: "Chirurgien-dentiste", city: "Villeurbanne", listed: false },
  { id: "demo-p-dubois", first: "Manon", last: "Dubois", profession: "Assistant(e) dentaire", city: "Lyon", hospital: "Cabinet dentaire des Brotteaux", listed: false },
  { id: "demo-p-laurent", first: "Paul", last: "Laurent", profession: "Étudiant(e) en odontologie", city: "Lyon", listed: false },
];

async function upsertUser(id: string, first: string, last: string, passwordHash: string | null) {
  const email = `${first}.${last}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z.]/g, "") + `@${MAIL}`;
  await db.user.upsert({
    where: { id },
    update: passwordHash ? { passwordHash } : {},
    create: { id, email, firstName: first, lastName: last, passwordHash },
  });
}

async function main() {
  const passwordHash = process.env.DEMO_PASSWORD ? await hashPassword(process.env.DEMO_PASSWORD) : null;

  for (const o of ORGS) {
    await db.organization.upsert({
      where: { id: o.id },
      update: {},
      create: { id: o.id, name: o.name, kind: o.kind, sector: o.sector, headquarters: o.hq, areas: o.areas, about: o.about, policy: o.policy, listed: true, contactEmail: `contact@${MAIL}` },
    });
  }

  for (const s of STAFF) {
    await upsertUser(s.id, s.first, s.last, passwordHash);
    for (const role of s.roles) {
      await db.membership.upsert({
        where: { userId_organizationId_role: { userId: s.id, organizationId: s.org, role } },
        update: {},
        create: { userId: s.id, organizationId: s.org, role },
      });
    }
  }
  await db.mandate.upsert({
    where: { id: "demo-mandate-1" },
    update: {},
    create: { id: "demo-mandate-1", mandatorId: "demo-org-dentalys", agencyId: "demo-org-mediane", scope: "Logistique des soirées scientifiques" },
  });

  for (const p of PRACS) {
    const uid = p.id.replace("demo-p-", "demo-u-");
    await upsertUser(uid, p.first, p.last, passwordHash);
    // Identité vérifiée pour la plupart des experts de démo (illustre le badge « Vérifié »).
    const verified = p.listed && !["demo-p-lemoine", "demo-p-mercier", "demo-p-simon"].includes(p.id);
    await db.practitionerProfile.upsert({
      where: { id: p.id },
      update: { rppsVerified: verified },
      create: {
        id: p.id, userId: uid, profession: p.profession, city: p.city, specialty: p.specialty, subspecialty: p.sub, hospital: p.hospital,
        languages: p.langs ?? ["fr"], interventionTypes: p.types ?? [], dayRateCents: p.rate ? p.rate * 100 : null, orcid: p.orcid,
        bio: p.bio, listed: p.listed, rppsVerified: verified, listedAt: p.listed ? at(-200 + Math.floor(Math.random() * 150)) : null, responseDays: p.listed ? 3 : null,
      },
    });
  }
  await db.practitionerStructure.upsert({
    where: { id: "demo-struct-durand" },
    update: {},
    create: { id: "demo-struct-durand", practitionerId: "demo-p-durand", name: "SELARL Dr Durand", legalForm: "SELARL", role: "Gérante", sharePercent: 100, isPayee: true },
  });

  // ─── Événements ──────────────────────────────────────────────────────────
  type Ev = { id: string; org: string; title: string; type: string; area: string; days: number; hour: number; dur: number; format: EventFormat; city?: string; venue?: string; cap?: number; desc: string; benefits: [string, string, number][] };
  const EVENTS: Ev[] = [
    { id: "demo-ev-soiree-implanto", org: "demo-org-dentalys", title: "Soirée implantologie — cas cliniques complexes", type: "symposium", area: "Implantologie", days: 18, hour: 19, dur: 180, format: "PRESENTIEL", city: "Lyon", venue: "Hôtel des Célestins (fictif)", cap: 60,
      desc: "Trois cas complexes présentés par le Dr Durand et le Dr Martin, suivis d'une discussion. Cocktail dînatoire.", benefits: [["cocktail", "Cocktail dînatoire", 4500], ["cafe", "Pause café d'accueil", 1200]] },
    { id: "demo-ev-tp-endo", org: "demo-org-academie", title: "Travaux pratiques : endodontie sous microscope", type: "travaux-pratiques", area: "Endodontie", days: 32, hour: 9, dur: 420, format: "PRESENTIEL", city: "Paris", venue: "Centre de formation Académie (fictif)", cap: 16,
      desc: "Journée de TP sur simulateur, 16 postes équipés de microscopes. Animée par le Dr Roux.", benefits: [["dejeuner", "Déjeuner sur place", 3400], ["cafe", "Pause café d'accueil", 1200]] },
    { id: "demo-ev-journee-cdra", org: "demo-org-cdra", title: "Journée scientifique du Collège — parodontologie et implants", type: "pleniere", area: "Parodontologie", days: 46, hour: 9, dur: 480, format: "HYBRIDE", city: "Grenoble", venue: "Palais des congrès (fictif)", cap: 250,
      desc: "Conférences plénières, table ronde sur la péri-implantite, remise du prix jeune chercheur.", benefits: [["dejeuner", "Déjeuner sur place", 3800], ["nuitee", "Nuitée d'hôtel", 14000], ["transport", "Transport aller-retour", 9500]] },
    { id: "demo-ev-webinaire-aligneurs", org: "demo-org-orthonova", title: "Webinaire : planification numérique des aligneurs", type: "webinaire", area: "Orthodontie", days: 9, hour: 20, dur: 75, format: "DISTANCIEL",
      desc: "Démonstration en direct du logiciel de planification, avec le Dr Petit.", benefits: [] },
    { id: "demo-ev-live-surgery", org: "demo-org-dentalys", title: "Live surgery : mise en charge immédiate", type: "live-surgery", area: "Implantologie", days: 60, hour: 14, dur: 240, format: "PRESENTIEL", city: "Nice", venue: "Clinique du Port (fictif)", cap: 30,
      desc: "Chirurgie retransmise en direct, commentée par le Dr Moreau.", benefits: [["cafe", "Pause café d'accueil", 1200], ["dejeuner", "Déjeuner sur place", 3400]] },
    { id: "demo-ev-passe", org: "demo-org-dentalys", title: "Soirée régénération osseuse (édition précédente)", type: "symposium", area: "Implantologie", days: -40, hour: 19, dur: 180, format: "PRESENTIEL", city: "Lyon", venue: "Hôtel des Célestins (fictif)", cap: 50,
      desc: "Édition passée, conservée pour l'historique des hospitalités.", benefits: [["cocktail", "Cocktail dînatoire", 4500]] },
  ];
  for (const e of EVENTS) {
    await db.event.upsert({
      where: { id: e.id },
      update: {},
      create: {
        id: e.id, organizationId: e.org, title: e.title, typeId: e.type, therapeuticArea: e.area, description: e.desc,
        startsAt: at(e.days, e.hour), durationMinutes: e.dur, format: e.format, city: e.city, venue: e.venue, capacity: e.cap,
        publishedAt: at(Math.min(e.days, 0) - 20), registrationOpen: e.days > 0,
        benefits: { create: e.benefits.map(([catalogId, label, valueCents]) => ({ id: `${e.id}-b-${catalogId}`, catalogId, label, valueCents })) },
      },
    });
  }

  // ─── Inscriptions (avec hospitalités acceptées) ──────────────────────────
  const REGS: [string, string, string[], boolean?][] = [
    ["demo-ev-soiree-implanto", "demo-p-lambert", ["cocktail", "cafe"]],
    ["demo-ev-soiree-implanto", "demo-p-robert", ["cocktail"]],
    ["demo-ev-soiree-implanto", "demo-p-dubois", ["cocktail", "cafe"]],
    ["demo-ev-soiree-implanto", "demo-p-laurent", []],
    ["demo-ev-soiree-implanto", "demo-p-nguyen", ["cafe"]],
    ["demo-ev-tp-endo", "demo-p-lambert", ["dejeuner", "cafe"]],
    ["demo-ev-tp-endo", "demo-p-robert", []],
    ["demo-ev-journee-cdra", "demo-p-lemoine", ["dejeuner", "nuitee", "transport"]],
    ["demo-ev-journee-cdra", "demo-p-blanc", ["dejeuner"]],
    ["demo-ev-journee-cdra", "demo-p-laurent", ["dejeuner"]],
    ["demo-ev-webinaire-aligneurs", "demo-p-mercier", []],
    ["demo-ev-webinaire-aligneurs", "demo-p-robert", []],
    ["demo-ev-passe", "demo-p-lambert", ["cocktail"], true],
    ["demo-ev-passe", "demo-p-robert", ["cocktail"], true],
    ["demo-ev-passe", "demo-p-girard", ["cocktail"], false],
  ];
  for (const [eventId, pracId, accepted, declared] of REGS) {
    const prac = PRACS.find((p) => p.id === pracId)!;
    const userId = pracId.replace("demo-p-", "demo-u-");
    const benefits = await db.eventBenefit.findMany({ where: { eventId, catalogId: { in: accepted } } });
    await db.registration.upsert({
      where: { eventId_userId: { eventId, userId } },
      update: {},
      create: {
        id: `demo-reg-${eventId.slice(8)}-${pracId.slice(7)}`, eventId, userId, profession: prac.profession, structure: prac.hospital ?? null,
        declared: !!declared, declarationRef: declared ? `CONV-H-2026-${Math.floor(1000 + Math.random() * 9000)}` : null,
        benefits: { create: benefits.map((b) => ({ benefitId: b.id, valueCents: b.valueCents })) },
      },
    });
  }

  // ─── Dossiers de collaboration à différents stades ───────────────────────
  type Proj = {
    id: string; org: string; title: string; type: string; area: string; status: ProjectStatus; desc: string; note?: string; ordre?: string;
    experts: { p: string; status: ProjectStatus; fee: number; units: number; msgs?: [string, string][] }[]; steps: [string, ProjectStatus, string, number, string?][];
  };
  const PROJECTS: Proj[] = [
    { id: "demo-prj-board", org: "demo-org-dentalys", title: "Board implantologie — gamme 2027", type: "advisory", area: "Implantologie", status: "ATT_EXPERTS",
      desc: "Réunion d'une journée à Lyon pour évaluer la nouvelle gamme d'implants courts. Livrable : compte rendu et recommandations.",
      experts: [
        { p: "demo-p-blanc", status: "ATT_EXPERTS", fee: 2400, units: 1, msgs: [["demo-u-julien", "Bonjour Docteur, nous serions ravis de vous compter parmi les membres du board. Date envisagée : fin novembre."]] },
        { p: "demo-p-durand", status: "ACCORD", fee: 2200, units: 1, msgs: [["demo-u-julien", "Bonjour Docteur, nous serions ravis de vous compter parmi les membres du board."], ["demo-u-durand", "Avec plaisir. Je suis disponible le 27 ou le 28 novembre."]] },
        { p: "demo-p-moreau", status: "ATT_EXPERTS", fee: 3200, units: 1 },
      ],
      steps: [["demo-u-julien", "ATT_EXPERTS", "project.create", 6]] },
    { id: "demo-prj-symposium", org: "demo-org-dentalys", title: "Symposium ADF — chirurgie guidée", type: "symposium", area: "Chirurgie orale", status: "EN_VALID",
      desc: "Intervention de 45 minutes lors du symposium Dentalys au congrès national.",
      experts: [{ p: "demo-p-martin", status: "EN_VALID", fee: 3000, units: 1, msgs: [["demo-u-julien", "Souhaiteriez-vous intervenir sur le flux numérique en chirurgie guidée ?"], ["demo-u-martin", "Oui, avec plaisir. Je propose un format cas cliniques."]] }],
      steps: [["demo-u-julien", "ATT_EXPERTS", "project.create", 20], ["demo-u-martin", "ACCORD", "solicitation.accept", 17], ["demo-u-julien", "EN_VALID", "project.submit", 2]] },
    { id: "demo-prj-redaction", org: "demo-org-dentalys", title: "Rédaction d'un guide péri-implantite", type: "redaction", area: "Parodontologie", status: "BLOQUE",
      desc: "Guide pratique de 12 pages destiné aux praticiens, relu par le service médical.",
      note: "Honoraires au-dessus de la fourchette pour un document : justifier le volume ou réduire le montant.",
      experts: [{ p: "demo-p-nguyen", status: "BLOQUE", fee: 3500, units: 1 }],
      steps: [["demo-u-julien", "ATT_EXPERTS", "project.create", 25], ["demo-u-nguyen", "ACCORD", "solicitation.accept", 22], ["demo-u-julien", "EN_VALID", "project.submit", 10], ["demo-u-sophie", "BLOQUE", "project.block", 8, "Honoraires au-dessus de la fourchette pour un document : justifier le volume ou réduire le montant."]] },
    { id: "demo-prj-formation", org: "demo-org-academie", title: "Formation DPC endodontie — 2 journées", type: "dpc", area: "Endodontie", status: "SIGNATURE",
      desc: "Deux journées de formation DPC (théorie + TP).", ordre: "Déclaration CDO-69 n° D-2026-0412 (fictive)",
      experts: [{ p: "demo-p-roux", status: "SIGNATURE", fee: 3000, units: 2 }],
      steps: [["demo-u-anne", "ATT_EXPERTS", "project.create", 40], ["demo-u-roux", "ACCORD", "solicitation.accept", 38], ["demo-u-anne", "EN_VALID", "project.submit", 30], ["demo-u-anne", "VALIDE", "project.validate", 28], ["demo-u-anne", "SIGNATURE", "project.declaration", 25]] },
    { id: "demo-prj-aligneurs", org: "demo-org-orthonova", title: "Comité scientifique aligneurs", type: "comite-sci", area: "Orthodontie", status: "SIGNE",
      desc: "Trois séances annuelles du comité scientifique.",
      experts: [{ p: "demo-p-petit", status: "SIGNE", fee: 4500, units: 3 }],
      steps: [["demo-u-thomas", "ATT_EXPERTS", "project.create", 70], ["demo-u-petit", "ACCORD", "solicitation.accept", 66], ["demo-u-thomas", "EN_VALID", "project.submit", 60], ["demo-u-lea", "VALIDE", "project.validate", 58], ["demo-u-thomas", "ORDRE", "project.ordre", 57], ["demo-u-thomas", "SIGNATURE", "project.ordre_ok", 30], ["demo-u-thomas", "SIGNE", "project.signed", 26]] },
    { id: "demo-prj-webinaire", org: "demo-org-orthonova", title: "Webinaire planification numérique", type: "webinaire", area: "Orthodontie", status: "TERMINE",
      desc: "Webinaire de 75 minutes.",
      experts: [{ p: "demo-p-petit", status: "TERMINE", fee: 900, units: 1 }],
      steps: [["demo-u-thomas", "ATT_EXPERTS", "project.create", 90], ["demo-u-petit", "ACCORD", "solicitation.accept", 88], ["demo-u-thomas", "EN_VALID", "project.submit", 85], ["demo-u-lea", "VALIDE", "project.validate", 84], ["demo-u-thomas", "SIGNATURE", "project.declaration", 83], ["demo-u-thomas", "SIGNE", "project.signed", 80], ["demo-u-thomas", "TERMINE", "project.done", 10]] },
  ];
  for (const p of PROJECTS) {
    const created = at(-(p.steps[0]?.[3] ?? 0));
    await db.project.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id, organizationId: p.org, title: p.title, typeId: p.type, therapeuticArea: p.area, status: p.status, description: p.desc,
        complianceNote: p.note, ordreRef: p.ordre, origin: "Sollicitation directe", createdById: p.steps[0]?.[0], createdAt: created,
      },
    });
    for (const [i, e] of p.experts.entries()) {
      const linkId = `${p.id}-x${i}`;
      await db.projectExpert.upsert({
        where: { id: linkId },
        update: {},
        create: { id: linkId, projectId: p.id, practitionerId: e.p, status: e.status, feeCents: e.fee * 100, days: e.units, createdAt: created, respondedAt: e.status === "ATT_EXPERTS" ? null : at(-(p.steps[1]?.[3] ?? 1)) },
      });
      for (const [j, [author, body]] of (e.msgs ?? []).entries()) {
        await db.message.upsert({
          where: { id: `${linkId}-m${j}` },
          update: {},
          create: { id: `${linkId}-m${j}`, projectId: p.id, projectExpertId: linkId, authorId: author, body, createdAt: new Date(created.getTime() + (j + 1) * 3600e3) },
        });
      }
    }
    let prev: ProjectStatus | null = null;
    for (const [k, [actor, to, action, daysAgo, note]] of p.steps.entries()) {
      const isExpert = action.startsWith("solicitation");
      await db.auditLog.upsert({
        where: { id: `${p.id}-h${k}` },
        update: {},
        create: {
          id: `${p.id}-h${k}`, actorId: actor, action, createdAt: at(-daysAgo, 10),
          entityType: isExpert ? "ProjectExpert" : "Project", entityId: isExpert ? `${p.id}-x0` : p.id,
          data: action === "project.create" ? { experts: p.experts.length } : { from: prev, to, ...(note ? { note } : {}) },
        },
      });
      prev = to;
    }
  }

  // ─── Opportunités et candidatures ────────────────────────────────────────
  const CALLS = [
    { id: "demo-call-bordeaux", org: "demo-org-cdra", title: "Conférencier pour une soirée parodontologie à Bordeaux", type: "pleniere", spec: "Parodontologie", min: 1000, max: 1800, days: 21,
      desc: "Soirée de formation continue (60 participants). Thème : prise en charge de la péri-implantite au cabinet.",
      apps: [["demo-p-lemoine", "Parodontiste et enseignante, j'interviens régulièrement sur la maintenance implantaire. Disponible en semaine."], ["demo-p-nguyen", "Mes travaux portent précisément sur la péri-implantite ; je peux proposer un format cas cliniques."]] },
    { id: "demo-call-tp-cfao", org: "demo-org-academie", title: "Formateur TP CFAO (2 sessions)", type: "travaux-pratiques", spec: "Prothèse, CFAO", min: 1800, max: 2600, days: 35,
      desc: "Deux sessions de travaux pratiques sur caméra intra-orale et usinage au fauteuil.",
      apps: [["demo-p-girard", "Je forme depuis 6 ans sur les flux CFAO au fauteuil, matériel maîtrisé."]] },
    { id: "demo-call-etude", org: "demo-org-dentalys", title: "Investigateurs pour étude observationnelle implants courts", type: "observationnelle", spec: "Implantologie", min: 150, max: 400, days: 50,
      desc: "Étude observationnelle multicentrique, 20 patients par centre, suivi à 3 ans.", apps: [] },
    { id: "demo-call-podcast", org: "demo-org-orthonova", title: "Série de podcasts sur l'orthodontie adulte", type: "podcast", spec: "Orthodontie", min: 400, max: 900, days: -5,
      desc: "Quatre épisodes de 20 minutes.", status: "closed",
      apps: [["demo-p-petit", "Je serais ravie de partager mon expérience des aligneurs chez l'adulte."]] },
  ] as const;
  for (const c of CALLS) {
    await db.openCall.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id, organizationId: c.org, title: c.title, typeId: c.type, specialty: c.spec, description: c.desc,
        budgetMinCents: c.min * 100, budgetMaxCents: c.max * 100, deadline: at(c.days, 21), status: "status" in c ? c.status : "open", createdAt: at(-15),
      },
    });
    for (const [pid, message] of c.apps) {
      await db.application.upsert({
        where: { openCallId_practitionerId: { openCallId: c.id, practitionerId: pid } },
        update: {},
        create: { openCallId: c.id, practitionerId: pid, message, status: "status" in c ? "rejected" : "pending", createdAt: at(-Math.floor(2 + Math.random() * 8)) },
      });
    }
  }

  // ─── Comptes réels rattachés aux organisations de démo ───────────────────
  const admins = (process.env.DEMO_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of admins) {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) { console.log(`DEMO_ADMIN_EMAILS : aucun compte pour ${email} (créez-le puis redéployez).`); continue; }
    for (const o of ORGS) {
      await db.membership.upsert({
        where: { userId_organizationId_role: { userId: user.id, organizationId: o.id, role: "ADMIN" } },
        update: {},
        create: { userId: user.id, organizationId: o.id, role: "ADMIN" },
      });
    }
    console.log(`${email} est administrateur des ${ORGS.length} organisations de démo.`);
  }

  console.log(`Données de démo OK : ${ORGS.length} organisations, ${STAFF.length} rôles, ${PRACS.length} praticiens, ${EVENTS.length} événements, ${REGS.length} inscriptions, ${PROJECTS.length} dossiers, ${CALLS.length} opportunités.`);
  if (!passwordHash) console.log("DEMO_PASSWORD non défini : les comptes de démo n'ont pas de mot de passe.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
