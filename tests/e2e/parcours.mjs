// Parcours de bout en bout sur les données de démo (droits, visibilité, connexion).
// Prérequis : base migrée et chargée (npm run db:seed avec DEMO_PASSWORD), application lancée.
// Usage : BASE=http://localhost:3000 DEMO_PASSWORD=… DATABASE_URL=… npm run test:e2e
import { chromium } from "playwright";
import pg from "pg";
import { mails, startFakes } from "./faux-services.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = process.env.DEMO_PASSWORD;
if (!PW || !process.env.DATABASE_URL) throw new Error("DEMO_PASSWORD et DATABASE_URL sont nécessaires.");

// Cas de test : une praticienne a masqué ses coordonnées et son activité.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(`UPDATE "PractitionerProfile" SET visibility = '{"contact":"masque","historique":"masque"}' WHERE id = 'demo-p-durand'`);
await client.end();
const stopFakes = startFakes();
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch();

async function session() {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}
async function login(page, email, password = PW, next = "") {
  await page.goto(`${BASE}/connexion${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForLoadState("networkidle"), page.click('button:has-text("Se connecter")')]);
  await page.waitForTimeout(800);
}
const text = (page) => page.locator("main").innerText();
/** Attend un e-mail (envoyé après la réponse du serveur) correspondant au destinataire et au sujet. */
async function waitMail(to, subject, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const m = mails.find((x) => x.to === to && (typeof subject === "string" ? x.subject.includes(subject) : subject.test(x.subject)));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}
const linkIn = (mail) => mail?.text.match(/https?:\/\/\S+/g)?.find((u) => !u.endsWith("/compte")) ?? null;

// ── 3. Visibilité : liste publique ──────────────────────────────────────────
{
  const { ctx, page } = await session();
  await page.goto(`${BASE}/experts`);
  const card = page.locator('a.kol-card[href="/experts/demo-p-durand"]');
  const t = await card.innerText();
  check("Liste publique : ville masquée absente de la carte", !t.includes("Lyon") && !t.includes("Hospices"), t.replace(/\s+/g, " ").slice(0, 120));
  check("Liste publique : nombre de collaborations masqué", !/collaboration|Nouveau sur KolBase/.test(t));
  const other = await page.locator('a.kol-card[href="/experts/demo-p-martin"]').innerText();
  check("Liste publique : ville visible pour un profil public", other.includes("Paris"));
  await page.goto(`${BASE}/experts?ville=Lyon`);
  check("Recherche publique par ville : profil masqué exclu", (await page.locator('a.kol-card[href="/experts/demo-p-durand"]').count()) === 0);
  await page.goto(`${BASE}/experts/demo-p-martin`);
  const anon = await text(page);
  check("Fiche expert anonyme : tarif réservé aux organisations", anon.includes("Tarif indicatif : réservé aux organisations inscrites") && !anon.includes("Tarif journalier indicatif"));
  await ctx.close();
}

// ── 3. Visibilité : praticien connecté sans organisation ───────────────────
{
  const { ctx, page } = await session();
  await login(page, "ines.lambert@demo.kolbase.local");
  await page.goto(`${BASE}/experts/demo-p-martin`);
  const t = await text(page);
  check("Praticien connecté (sans organisation) : tarif non visible", !t.includes("Tarif journalier indicatif") && t.includes("réservé aux organisations inscrites"));
  check("Praticien connecté : pas de lien « Se connecter » dans les mentions", !/réservé aux organisations inscrites\.\s*Se connecter/.test(t));
  await ctx.close();
}

// ── 3. Visibilité : membre d'organisation ──────────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Membre d'organisation : tarif visible", (await text(page)).includes("Tarif journalier indicatif"));
  await page.goto(`${BASE}/experts/demo-p-durand`);
  const d = await text(page);
  check("Membre d'organisation : coordonnées masquées restent masquées", !d.includes("Hospices"));
  await page.goto(`${BASE}/annuaire?ville=Lyon`);
  check("Annuaire : recherche par ville masquée n'expose pas le profil", (await page.locator('a[href="/experts/demo-p-durand"]').count()) === 0);
  await page.goto(`${BASE}/annuaire?q=Hospices`);
  check("Annuaire : recherche sur l'établissement masqué n'expose pas le profil", (await page.locator('a[href="/experts/demo-p-durand"]').count()) === 0);
  await page.goto(`${BASE}/annuaire?q=Implantologie`);
  check("Annuaire : le profil reste trouvable par ses champs visibles", (await page.locator('a[href="/experts/demo-p-durand"]').count()) === 1);
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/nouveau`);
  const html = await page.content();
  check("Nouveau dossier : la ville masquée n'est pas envoyée au navigateur", !/Durand[^<]{0,80}Lyon/.test(html));
  await ctx.close();
}

// ── 2. Admin d'une organisation prestataire ────────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "karim.benali@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-mediane/membres`);
  const options = await page.locator('select[name="role"] option').allInnerTexts();
  check("Prestataire : rôles d'invitation limités", JSON.stringify(options) === JSON.stringify(["Administrateur", "Membre de l'équipe"]), options.join(", "));
  check("Prestataire : rôle par défaut non administrateur", (await page.locator('select[name="role"]').inputValue()) === "PRESTATAIRE");
  await page.fill('form:has(h2:has-text("Inviter un membre")) input[name="email"]', "nouvelle.recrue@exemple.fr");
  await page.click('button:has-text("Générer le lien")');
  await page.waitForSelector(".copy input", { timeout: 10000 }).catch(() => {});
  const link = await page.locator(".copy input").inputValue().catch(() => "");
  check("Prestataire : l'admin peut générer une invitation", link.includes("/invitation/"), link);
  const invitationMail = await waitMail("nouvelle.recrue@exemple.fr", "vous invite à rejoindre Agence Médiane");
  check("Invitation envoyée par e-mail avec le lien", linkIn(invitationMail) === link, linkIn(invitationMail) ?? "aucun e-mail");
  await page.fill('form:has(h2:has-text("Fiche de l")) input[name="sector"]', "Logistique événementielle et congrès");
  await page.click('form:has(h2:has-text("Fiche de l")) button:has-text("Enregistrer")');
  await page.waitForTimeout(1500);
  check("Prestataire : l'admin peut modifier la fiche", (await text(page)).includes("Organisation mise à jour."), page.url());
  check("Prestataire : pas de formulaire de page publique (géré sur la page devis)", (await page.locator('h2:has-text("Page publique")').count()) === 0);
  // L'invité accepte : il devient membre de l'équipe.
  const { ctx: c2, page: p2 } = await session();
  await login(p2, "ines.lambert@demo.kolbase.local");
  await p2.goto(link);
  check("Invitation : rôle affiché « Membre de l'équipe »", (await text(p2)).includes("Membre de l'équipe"));
  await c2.close();
  await ctx.close();
}

// ── 2. Non-régression : un client garde ses espaces, un prestataire n'y accède pas ──
{
  const { ctx, page } = await session();
  await login(page, "karim.benali@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-mediane/dossiers`);
  check("Prestataire : toujours redirigé hors des dossiers", page.url().endsWith("/organisations/demo-org-mediane"), page.url());
  await ctx.close();
}

// ── 4. Redirection ouverte ─────────────────────────────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local", PW, "/\\evil.example");
  check("Connexion avec next=/\\evil.example : reste sur KolBase", page.url().startsWith(BASE + "/") && !page.url().includes("evil"), page.url());
  await ctx.close();
  const s2 = await session();
  await login(s2.page, "julien.faure@demo.kolbase.local", PW, "/annuaire?q=implant");
  check("Connexion avec next interne : redirection conservée", s2.page.url() === `${BASE}/annuaire?q=implant`, s2.page.url());
  await s2.ctx.close();
}

// ── Dossiers : les honoraires d'une candidature retenue sont proposés à l'expert ─────────
{
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-academie/opportunites/demo-call-tp-cfao`);
  await page.click('button:has-text("Retenir…")');
  await page.fill('input[name="units"]', "2");
  await page.fill('input[name="fee"]', "4000");
  await Promise.all([page.waitForURL(/\/dossiers\//), page.click('button:has-text("Proposer ces honoraires")')]);
  const dossier = await text(page);
  check("Candidature retenue : dossier en attente de l'expert", dossier.includes("En attente des experts") && dossier.includes("Réponse attendue"));
  check("Candidature retenue : pas de convention avant accord", (await page.locator('a:has-text("Convention (PDF)")').count()) === 0);
  const feeMail = await waitMail("olivier.girard@demo.kolbase.local", "vous propose des honoraires");
  check("E-mail à l'expert : proposition d'honoraires", !!feeMail && /4\s000\s€/.test(feeMail.text), feeMail?.subject ?? "aucun e-mail");
  await ctx.close();
}
{
  const { ctx, page } = await session();
  await login(page, "olivier.girard@demo.kolbase.local");
  await page.goto(`${BASE}/opportunites/demo-call-tp-cfao`);
  check("Expert : la candidature indique une proposition à accepter", (await text(page)).includes("vous propose des honoraires"));
  await page.goto(`${BASE}/sollicitations`);
  await Promise.all([page.waitForURL(/\/sollicitations\/[^/]+$/), page.click('a:has-text("Formateur TP CFAO")')]);
  const t = await text(page);
  check("Expert : honoraires proposés visibles avant de répondre", /4\s000\s€/.test(t) && t.includes("Votre réponse"), t.match(/Honoraires proposés[^\n]*\n?[^\n]*/)?.[0]);
  await page.click('button:has-text("Donner mon accord de principe")');
  await page.waitForTimeout(1200);
  await page.reload();
  check("Expert : après accord, la convention devient disponible", (await page.locator('a:has-text("Projet de convention")').count()) === 1);
  check("E-mail à l'organisation : accord de principe", !!(await waitMail("anne.chevalier@demo.kolbase.local", "a donné son accord de principe")));
  // Message de l'expert → e-mail à l'organisation ; puis l'expert coupe les notifications.
  await page.fill('textarea[name="body"]', "Bonjour, je confirme mes disponibilités.");
  await page.click('button:has-text("Envoyer")');
  check("E-mail à l'organisation : nouveau message de l'expert", !!(await waitMail("anne.chevalier@demo.kolbase.local", "Nouveau message de Dr Olivier Girard")));
  const dossierUrl = page.url();
  await page.goto(`${BASE}/compte`);
  await page.uncheck('form:has(h2:has-text("Notifications")) input[name="email"]');
  await page.click('form:has(h2:has-text("Notifications")) button:has-text("Enregistrer")');
  await page.waitForTimeout(1000);
  check("Préférence : notifications par e-mail coupées", (await text(page)).includes("Vous ne recevrez plus de notifications"));
  await ctx.close();
}

// L'organisation écrit à l'expert, qui a coupé ses notifications : pas d'e-mail.
{
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-academie/dossiers`);
  await Promise.all([page.waitForURL(/\/dossiers\/[^/]+$/), page.click('a:has-text("Formateur TP CFAO")')]);
  await page.fill('textarea[name="body"]', "Merci, nous vous envoyons la convention.");
  await page.click('button:has-text("Envoyer")');
  check("Notifications coupées : pas d'e-mail à l'expert", !(await waitMail("olivier.girard@demo.kolbase.local", "Nouveau message de Académie", 4000)));
  await ctx.close();
}

// ── Documents des dossiers : convention signée exigée, accès contrôlé ───────
{
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  const dossier = `${BASE}/organisations/demo-org-academie/dossiers/demo-prj-formation`;
  await page.goto(dossier);
  let t = await text(page);
  check("Signature : « Convention signée » attend la convention de l'expert", (await page.locator('button:has-text("Convention signée")').count()) === 0 && t.includes("Déposez la convention signée de Dr Mathieu Roux"));
  const upload = 'form:has(input[name="file"])';
  await page.selectOption(`${upload} select[name="kind"]`, "CONVENTION_SIGNEE");
  await page.setInputFiles(`${upload} input[name="file"]`, { name: "faux.pdf", mimeType: "application/pdf", buffer: Buffer.from("pas un pdf") });
  await page.click(`${upload} button:has-text("Déposer")`);
  await page.waitForTimeout(1200);
  check("Dépôt : faux PDF refusé", (await text(page)).includes("n'est pas un PDF valide"));
  await page.selectOption(`${upload} select[name="kind"]`, "CONVENTION_SIGNEE");
  await page.setInputFiles(`${upload} input[name="file"]`, { name: "convention-roux-signée.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.click(`${upload} button:has-text("Déposer")`);
  await page.waitForTimeout(1200);
  check("Dépôt : convention signée sans expert refusée", (await text(page)).includes("Indiquez l'expert signataire"));
  await page.selectOption(`${upload} select[name="kind"]`, "CONVENTION_SIGNEE");
  const roux = await page.locator(`${upload} select[name="linkId"] option`, { hasText: "Roux" }).getAttribute("value");
  await page.selectOption(`${upload} select[name="linkId"]`, roux);
  await page.setInputFiles(`${upload} input[name="file"]`, { name: "convention-roux-signée.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.click(`${upload} button:has-text("Déposer")`);
  await page.waitForTimeout(1500);
  await page.reload();
  t = await text(page);
  check("Dépôt : convention signée enregistrée", t.includes("convention-roux-signée.pdf") && t.includes("Convention signée · Dr Mathieu Roux"));
  const href = await page.locator('a:has-text("convention-roux-signée.pdf")').getAttribute("href");
  const dl = await page.request.get(`${BASE}${href}`);
  check("Téléchargement : fichier identique, en pièce jointe", dl.ok() && Buffer.compare(await dl.body(), pdf) === 0 && (dl.headers()["content-disposition"] ?? "").startsWith("attachment"));
  check("Signature : « Convention signée » disponible une fois la convention déposée", (await page.locator('button:has-text("Convention signée")').count()) === 1);

  const other = await session();
  await login(other.page, "julien.faure@demo.kolbase.local");
  const forbidden = await other.page.request.get(`${BASE}${href}`);
  check("Téléchargement : refusé à une autre organisation", forbidden.status() === 404, String(forbidden.status()));
  await other.ctx.close();

  const expert = await session();
  await login(expert.page, "mathieu.roux@demo.kolbase.local");
  await expert.page.goto(`${BASE}/sollicitations`);
  await Promise.all([expert.page.waitForURL(/\/sollicitations\/[^/]+$/), expert.page.click('a:has-text("Formation DPC endodontie")')]);
  check("Expert : voit sa convention signée", (await text(expert.page)).includes("convention-roux-signée.pdf"));
  const own = await expert.page.request.get(`${BASE}${href}`);
  check("Expert : peut la télécharger", own.ok());
  await expert.page.setInputFiles('form:has(input[name="file"]) input[name="file"]', { name: "programme-tp.pdf", mimeType: "application/pdf", buffer: pdf });
  await expert.page.click('form:has(input[name="file"]) button:has-text("Déposer")');
  await expert.page.waitForTimeout(1500);
  check("Expert : dépôt d'une pièce", (await text(expert.page)).includes("Document déposé"));
  await expert.ctx.close();

  await page.reload();
  check("Organisation : voit la pièce déposée par l'expert", (await text(page)).includes("programme-tp.pdf"));
  await page.click('button:has-text("Convention signée")');
  await page.waitForTimeout(1500);
  await page.reload();
  const signed = await page.locator('li:has-text("convention-roux-signée.pdf")').innerText();
  check("Dossier signé : la convention signée ne peut plus être retirée", !signed.includes("Retirer") && (await text(page)).includes("Signé"));
  await ctx.close();
}

// ── Conformité : au-delà des seuils, pas de déclaration simple ─────────────
{
  const { ctx, page } = await session();
  await login(page, "sophie.bernard@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  await page.click('button:has-text("Valider")');
  await page.waitForTimeout(1200);
  await ctx.close();
  const s2 = await session();
  await login(s2.page, "julien.faure@demo.kolbase.local");
  await s2.page.goto(`${BASE}/organisations/demo-org-dentalys/dossiers/demo-prj-symposium`);
  const t = await text(s2.page);
  check("Dossier à 3 000 € validé : régime d'autorisation", t.includes("Autorisation") && t.includes("Demander l'autorisation à l'Ordre"));
  check("Dossier à 3 000 € : déclaration simple non proposée", !t.includes("Déclaration simple"));
  await s2.ctx.close();
}

// ── Mandats d'agence ───────────────────────────────────────────────────────
{
  const agent = await session();
  await login(agent.page, "karim.benali@demo.kolbase.local");
  await agent.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  check("Agence mandatée : voit l'événement confié", (await text(agent.page)).includes("Soirée"));
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=agences`);
  check("Mandats : agence existante listée", (await text(page)).includes("Agence Médiane Événements"));
  const belleville = await page.locator('select[name="agencyId"] option', { hasText: "Traiteur Belleville" }).getAttribute("value");
  await page.selectOption('select[name="agencyId"]', belleville);
  await page.click('button:has-text("Mandater")');
  await page.waitForTimeout(1200);
  check("Mandats : nouvelle agence mandatée", (await text(page)).includes("Traiteur Belleville est mandatée"));
  await page.goto(`${BASE}/organisations/demo-org-dentalys/prestataires?onglet=agences`);
  await page.locator('section.card:has-text("Agence Médiane") button:has-text("Mettre fin au mandat")').click();
  await page.waitForTimeout(1200);
  await agent.page.goto(`${BASE}/organisations/demo-org-dentalys/evenements`);
  check("Fin de mandat : l'agence ne voit plus l'événement", !(await text(agent.page)).includes("Soirée"));
  await ctx.close();
  await agent.ctx.close();
}

// ── Vérification des organisations (SIREN + validation par un administrateur KolBase) ─────
async function submitNewOrg(page, siren) {
  await page.goto(`${BASE}/organisations/nouvelle`);
  await page.fill('input[name="name"]', "Implants Express");
  await page.selectOption('select[name="kind"]', "INDUSTRIEL");
  await page.fill('input[name="siren"]', siren);
  await page.click('button:has-text("Créer l\'organisation")');
  await page.waitForTimeout(1500);
}
{
  const { ctx, page } = await session();
  await login(page, "ines.lambert@demo.kolbase.local");
  await submitNewOrg(page, "");
  check("Nouvelle organisation : SIREN obligatoire pour un industriel", (await text(page)).includes("Indiquez le SIREN"));
  await submitNewOrg(page, "542051181");
  check("Nouvelle organisation : clé du SIREN contrôlée", (await text(page)).includes("SIREN invalide"));
  await submitNewOrg(page, "732 829 320");
  check("Nouvelle organisation : entreprise fermée refusée", (await text(page)).includes("est fermée"));
  await submitNewOrg(page, "542 051 180");
  check("E-mail aux administrateurs KolBase : organisation à valider", !!(await waitMail("anne.chevalier@demo.kolbase.local", "Organisation à valider : Implants Express")));
  check("Nouvelle organisation : créée, en attente de validation", /\/organisations\/[^/]+$/.test(page.url()) && (await text(page)).includes("en attente de validation"), page.url());
  const orgUrl = page.url();
  await page.goto(`${BASE}/annuaire`);
  check("Organisation non validée : pas d'annuaire", page.url().endsWith("/experts"), page.url());
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Organisation non validée : tarif des experts masqué", !(await text(page)).includes("Tarif journalier indicatif"));
  const notAdmin = await page.goto(`${BASE}/admin`);
  check("Administration : inaccessible sans droit", notAdmin?.status() === 404, String(notAdmin?.status()));

  const admin = await session();
  await login(admin.page, "anne.chevalier@demo.kolbase.local");
  await admin.page.goto(`${BASE}/admin`);
  const card = admin.page.locator('section.card:has-text("Implants Express")').first();
  check("Administration : SIREN contrôlé dans le répertoire", (await card.innerText()).includes("IMPLANTS EXPRESS SAS — active"));
  await card.locator('button:has-text("Valider")').click();
  await admin.page.waitForTimeout(1200);

  await page.goto(`${BASE}/annuaire`);
  check("Organisation validée : annuaire accessible", page.url().endsWith("/annuaire"), page.url());
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Organisation validée : tarif des experts visible", (await text(page)).includes("Tarif journalier indicatif"));
  await page.goto(`${orgUrl}/membres`);
  await page.fill('form:has(h2:has-text("Fiche de l")) input[name="name"]', "Straumann France");
  await page.click('form:has(h2:has-text("Fiche de l")) button:has-text("Enregistrer")');
  await page.waitForTimeout(1500);
  check("Organisation renommée : nouvelle validation demandée", (await text(page)).includes("KolBase doit la valider à nouveau"));

  // ── Praticiens : RPPS et professions éligibles
  const hugo = await session();
  await login(hugo.page, "hugo.robert@demo.kolbase.local");
  await hugo.page.goto(`${BASE}/compte`);
  await hugo.page.click('button:has-text("Me référencer comme expert")');
  await hugo.page.waitForTimeout(1200);
  check("Référencement sans RPPS refusé", (await text(hugo.page)).includes("Renseignez d'abord votre numéro RPPS"));
  const infos = 'form:has(h2:has-text("Informations personnelles"))';
  await hugo.page.fill(`${infos} input[name="rpps"]`, "10101010101");
  await hugo.page.click(`${infos} button:has-text("Enregistrer")`);
  await hugo.page.waitForTimeout(1200);
  await hugo.page.reload();
  check("RPPS saisi : en cours de vérification", (await text(hugo.page)).includes("En cours de vérification par KolBase"));
  await hugo.page.click('button:has-text("Me référencer comme expert")');
  await hugo.page.waitForTimeout(1200);
  check("Référencement avec RPPS accepté", (await text(hugo.page)).includes("Vous êtes référencé comme expert"));

  await admin.page.goto(`${BASE}/admin?onglet=praticiens`);
  await admin.page.locator('section.card:has-text("Hugo Robert") button:has-text("Valider")').click();
  await admin.page.waitForTimeout(1200);
  await hugo.page.goto(`${BASE}/compte`);
  check("RPPS validé par l'administrateur", (await text(hugo.page)).includes("Vérifié par KolBase"));
  await hugo.page.goto(`${BASE}/experts`);
  check("Badge « Identité vérifiée » sur la fiche publique", (await hugo.page.locator('a.kol-card:has-text("Hugo Robert")').innerText()).includes("Identité vérifiée"));

  const manon = await session();
  await login(manon.page, "manon.dubois@demo.kolbase.local");
  await manon.page.goto(`${BASE}/compte`);
  const m = await text(manon.page);
  check("Assistante dentaire : pas de référencement d'expert", m.includes("réservé aux chirurgiens-dentistes") && !m.includes("Me référencer comme expert"));
  check("Assistante dentaire : pas de titre « Dr »", !(await manon.page.locator(".session-chip").innerText()).includes("Dr "));
  for (const s of [ctx, admin.ctx, hugo.ctx, manon.ctx]) await s.close();
}

// ── ORCID : iD prouvé par connexion, puis import ───────────────────────────
{
  const { ctx, page } = await session();
  await login(page, "helene.durand@demo.kolbase.local");
  await page.goto(`${BASE}/compte`);
  await Promise.all([page.waitForURL(/\/compte\?orcid=/), page.click('a:has-text("Connecter mon compte ORCID")')]);
  check("ORCID : compte connecté et iD vérifié", (await text(page)).includes("Compte ORCID connecté"), page.url());
  await page.click('button:has-text("Importer depuis ORCID")');
  await page.waitForTimeout(1500);
  check("ORCID : publications importées", (await text(page)).includes("1 publication importée"));
  await ctx.close();
}

// ── Compte : confirmation d'adresse et mot de passe oublié ─────────────────
{
  const { ctx, page } = await session();
  await page.goto(`${BASE}/inscription`);
  await page.fill('input[name="firstName"]', "Camille");
  await page.fill('input[name="lastName"]', "Nouvel");
  await page.fill('input[name="email"]', "camille.nouvel@exemple.fr");
  await page.fill('input[name="password"]', "premier-mot-de-passe-1");
  await page.check('input[name="cgu"]');
  await Promise.all([page.waitForURL(/tableau-de-bord|organisations\/nouvelle|compte/), page.click('button:has-text("Créer")')]);
  const verify = await waitMail("camille.nouvel@exemple.fr", "Confirmez votre adresse");
  check("Inscription : e-mail de confirmation envoyé", !!linkIn(verify), verify?.subject ?? "aucun e-mail");
  await page.goto(`${BASE}/compte`);
  check("Adresse non confirmée : rappel dans Mon compte", (await text(page)).includes("Confirmez votre adresse"));
  await page.goto(linkIn(verify));
  check("Lien de confirmation : adresse confirmée", (await text(page)).includes("Adresse e-mail confirmée") && !(await text(page)).includes("Renvoyer le lien"));
  await page.goto(linkIn(verify));
  check("Lien de confirmation : usage unique", (await text(page)).includes("n'est plus valable"));
  await ctx.close();

  const anon = await session();
  await anon.page.goto(`${BASE}/connexion`);
  check("Connexion : lien « Mot de passe oublié »", (await anon.page.locator('a[href="/mot-de-passe-oublie"]').count()) === 1);
  await anon.page.goto(`${BASE}/mot-de-passe-oublie`);
  await anon.page.fill('input[name="email"]', "camille.nouvel@exemple.fr");
  await anon.page.click('button:has-text("Recevoir le lien")');
  await anon.page.waitForTimeout(800);
  check("Mot de passe oublié : réponse neutre", (await text(anon.page)).includes("Si un compte existe avec cette adresse"));
  await anon.page.goto(`${BASE}/mot-de-passe-oublie`);
  await anon.page.fill('input[name="email"]', "inconnu@exemple.fr");
  await anon.page.click('button:has-text("Recevoir le lien")');
  await anon.page.waitForTimeout(800);
  check("Mot de passe oublié : même réponse pour une adresse inconnue", (await text(anon.page)).includes("Si un compte existe avec cette adresse") && !(await waitMail("inconnu@exemple.fr", "", 1500)));
  const resetMail = await waitMail("camille.nouvel@exemple.fr", "Réinitialiser votre mot de passe");
  await anon.page.goto(linkIn(resetMail));
  await anon.page.fill('input[name="password"]', "nouveau-mot-de-passe-2");
  await anon.page.fill('input[name="confirm"]', "nouveau-mot-de-passe-2");
  await Promise.all([anon.page.waitForURL(/tableau-de-bord|organisations\/nouvelle|compte/), anon.page.click('button:has-text("Enregistrer et me connecter")')]);
  check("Réinitialisation : connecté avec le nouveau mot de passe", !anon.page.url().includes("/mot-de-passe"), anon.page.url());
  await anon.page.goto(linkIn(resetMail));
  check("Réinitialisation : lien à usage unique", (await text(anon.page)).includes("Lien expiré"));
  await anon.ctx.close();

  const again = await session();
  await login(again.page, "camille.nouvel@exemple.fr", "premier-mot-de-passe-1");
  check("Ancien mot de passe refusé", (await text(again.page)).includes("E-mail ou mot de passe incorrect"));
  await login(again.page, "camille.nouvel@exemple.fr", "nouveau-mot-de-passe-2");
  check("Nouveau mot de passe accepté", !again.page.url().includes("/connexion"), again.page.url());

  // ── RGPD : export et suppression du compte
  const exp = await again.page.request.get(`${BASE}/compte/export`);
  const data = await exp.json().catch(() => null);
  check("Export : données du compte au format JSON", exp.ok() && data?.compte?.email === "camille.nouvel@exemple.fr" && !JSON.stringify(data).includes("passwordHash"));
  await again.page.goto(`${BASE}/compte`);
  const del = 'form:has(button:has-text("Supprimer définitivement"))';
  await again.page.click('summary:has-text("Supprimer mon compte")');
  await again.page.fill(`${del} input[name="password"]`, "mauvais-mot-de-passe-9");
  await again.page.check(`${del} input[name="confirm"]`);
  await again.page.click(`${del} button`);
  await again.page.waitForTimeout(1000);
  check("Suppression : mot de passe exigé", (await text(again.page)).includes("Mot de passe incorrect"));
  // Le formulaire est réinitialisé après l'envoi (React 19) : on recoche la confirmation.
  await again.page.fill(`${del} input[name="password"]`, "nouveau-mot-de-passe-2");
  await again.page.check(`${del} input[name="confirm"]`);
  await Promise.all([again.page.waitForURL(/compte=supprime/), again.page.click(`${del} button`)]);
  check("Suppression : compte supprimé et déconnecté", (await again.page.locator("main").innerText()).includes("Votre compte a été supprimé"));
  await login(again.page, "camille.nouvel@exemple.fr", "nouveau-mot-de-passe-2");
  check("Suppression : connexion impossible", (await text(again.page)).includes("E-mail ou mot de passe incorrect"));
  await again.ctx.close();
}
{
  const { ctx, page } = await session();
  await login(page, "claire.morel@demo.kolbase.local");
  await page.goto(`${BASE}/compte`);
  const del = 'form:has(button:has-text("Supprimer définitivement"))';
  await page.click('summary:has-text("Supprimer mon compte")');
  await page.fill(`${del} input[name="password"]`, PW);
  await page.check(`${del} input[name="confirm"]`);
  await page.click(`${del} button`);
  await page.waitForTimeout(1000);
  check("Suppression : bloquée pour le seul administrateur d'une organisation", (await text(page)).includes("seul administrateur de Dentalys Implants"));
  await ctx.close();

  async function deleteAs(email) {
    const m = await session();
    await login(m.page, email);
    await m.page.goto(`${BASE}/compte`);
    await m.page.click('summary:has-text("Supprimer mon compte")');
    const announced = await text(m.page);
    await m.page.fill(`${del} input[name="password"]`, PW);
    await m.page.check(`${del} input[name="confirm"]`);
    await Promise.all([m.page.waitForURL(/compte=supprime/), m.page.click(`${del} button`)]);
    await m.ctx.close();
    return announced;
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const userRow = async (id) => (await db.query(`SELECT u."firstName", u.email, u."passwordHash", (SELECT count(*) FROM "ProjectExpert" pe JOIN "PractitionerProfile" p ON p.id = pe."practitionerId" WHERE p."userId" = u.id) AS links, (SELECT count(*) FROM "Registration" r WHERE r."userId" = u.id) AS regs FROM "User" u WHERE u.id = $1`, [id])).rows[0];

  // Conventions signées : nom conservé pour les registres, le reste effacé.
  check("Suppression : conservation annoncée (conventions)", (await deleteAs("linh.nguyen@demo.kolbase.local")).includes("restent attachés à vos"));
  const linh = await userRow("demo-u-nguyen");
  check("Anonymisation : nom conservé pour les conventions, adresse et mot de passe effacés", linh?.firstName === "Linh" && linh.email.endsWith("@kolbase.invalid") && linh.passwordHash === null && Number(linh.links) > 0, JSON.stringify(linh));
  const pub = await (await browser.newContext()).newPage();
  const fiche = await pub.goto(`${BASE}/experts/demo-p-nguyen`);
  check("Anonymisation : fiche expert retirée", fiche?.status() === 404, String(fiche?.status()));

  // Uniquement des inscriptions à venir : annulées, et le nom est effacé.
  check("Suppression : effacement complet annoncé (inscriptions à venir)", (await deleteAs("manon.dubois@demo.kolbase.local")).includes("votre nom est également effacé"));
  const manon = await userRow("demo-u-dubois");
  check("Anonymisation : nom effacé, inscriptions à venir annulées", manon?.firstName === "Compte" && Number(manon.regs) === 0, JSON.stringify(manon));
  await db.end();
}

// ── Finitions : capacité des événements, pages d'erreur, référencement, en-têtes ─────
{
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(`UPDATE "Event" SET capacity = 1 WHERE id = 'demo-ev-live-surgery'`);
  const a = await session();
  const b = await session();
  await login(a.page, "emma.simon@demo.kolbase.local");
  await login(b.page, "sarah.mercier@demo.kolbase.local");
  await Promise.all([a.page.goto(`${BASE}/evenements/demo-ev-live-surgery`), b.page.goto(`${BASE}/evenements/demo-ev-live-surgery`)]);
  await Promise.all([a.page.click('button:has-text("M\'inscrire")'), b.page.click('button:has-text("M\'inscrire")')]);
  await Promise.all([a.page.waitForTimeout(2000), b.page.waitForTimeout(2000)]);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM "Registration" WHERE "eventId" = 'demo-ev-live-surgery'`);
  const msgs = [await text(a.page), await text(b.page)];
  check("Capacité : deux inscriptions simultanées pour la dernière place, une seule acceptée", rows[0].n === 1 && msgs.some((m) => m.includes("complet")), `${rows[0].n} inscription(s)`);
  await db.end();
  await a.ctx.close();
  await b.ctx.close();

  const { ctx, page } = await session();
  const missing = await page.goto(`${BASE}/experts/inexistant`);
  check("Page 404 : statut et message", missing?.status() === 404 && (await page.locator("main").innerText()).includes("Page introuvable"));
  const home = await page.goto(`${BASE}/`);
  const h = home?.headers() ?? {};
  check("En-têtes de sécurité", h["x-frame-options"] === "DENY" && (h["content-security-policy"] ?? "").includes("frame-ancestors 'none'") && h["x-content-type-options"] === "nosniff", JSON.stringify({ xfo: h["x-frame-options"] }));
  await page.goto(`${BASE}/experts/demo-p-martin`);
  check("Fiche expert : titre de page descriptif", (await page.title()).startsWith("Dr Antoine Martin — Chirurgie orale"), await page.title());
  const robots = await (await page.request.get(`${BASE}/robots.txt`)).text();
  check("robots.txt : espaces privés exclus", robots.includes("Disallow: /admin") && robots.includes("Disallow: /organisations") && robots.includes("sitemap.xml"));
  const sitemap = await (await page.request.get(`${BASE}/sitemap.xml`)).text();
  check("Plan du site : experts référencés et événements publiés", sitemap.includes("/experts/demo-p-martin") && sitemap.includes("/evenements/demo-ev-tp-endo") && !sitemap.includes("demo-p-lambert"));
  await ctx.close();
}

// ── Lancement : état de la configuration et textes légaux ──────────────────
{
  const { ctx, page } = await session();
  await login(page, "anne.chevalier@demo.kolbase.local");
  await page.goto(`${BASE}/admin?onglet=lancement`);
  const t = await text(page);
  check("Administration : état du lancement", t.includes("Avant l'ouverture au public") && t.includes("Envoi d'e-mails") && t.includes("À compléter : hébergeur des documents"));
  await page.goto(`${BASE}/mentions-legales`);
  check("Mentions légales : éditeur complet", (await page.locator("main").innerText()).includes("MUTARA, société par actions simplifiée (SAS) au capital de 100 €"));
  await ctx.close();
}

// ── 4. Limitation des tentatives ───────────────────────────────────────────
{
  const { ctx, page } = await session();
  let last = "";
  for (let i = 1; i <= 5; i++) {
    await login(page, "helene.durand@demo.kolbase.local", "mauvais-mot-de-passe-1");
    last = await text(page);
  }
  check("5 échecs : message d'erreur classique", last.includes("E-mail ou mot de passe incorrect."));
  await login(page, "helene.durand@demo.kolbase.local", PW);
  const t = await text(page);
  check("6e tentative (même correcte) : bloquée", t.includes("Trop de tentatives") && page.url().includes("/connexion"), t.match(/Trop de tentatives[^.]*\./)?.[0] ?? page.url());
  await login(page, "camille.petit@demo.kolbase.local", PW);
  check("Un autre compte peut toujours se connecter", page.url().includes("/tableau-de-bord"), page.url());
  await ctx.close();
}

await browser.close();
stopFakes();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications OK`);
process.exit(failed.length ? 1 : 0);
