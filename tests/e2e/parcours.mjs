// Parcours de bout en bout sur les données de démo (droits, visibilité, connexion).
// Prérequis : base migrée et chargée (npm run db:seed avec DEMO_PASSWORD), application lancée.
// Usage : BASE=http://localhost:3000 DEMO_PASSWORD=… DATABASE_URL=… npm run test:e2e
import { chromium } from "playwright";
import pg from "pg";
import { startFakes } from "./faux-services.mjs";

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
  await page.click('button:has-text("Générer le lien")');
  await page.waitForSelector(".copy input", { timeout: 10000 }).catch(() => {});
  const link = await page.locator(".copy input").inputValue().catch(() => "");
  check("Prestataire : l'admin peut générer une invitation", link.includes("/invitation/"), link);
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
