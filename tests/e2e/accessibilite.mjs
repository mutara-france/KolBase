/**
 * Accessibilité (axe-core, règles WCAG 2.1 A et AA) des pages principales : publiques, praticien, organisation,
 * administration. Échoue sur toute violation « critique » ou « grave » ; les autres sont listées sans bloquer.
 * Usage : BASE=http://localhost:3000 DEMO_PASSWORD=… node tests/e2e/accessibilite.mjs (base chargée avec la démo).
 */
import { chromium } from "playwright";
import { withConsent } from "./consentement.mjs";
import { AxeBuilder } from "@axe-core/playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = process.env.DEMO_PASSWORD;
if (!PW) throw new Error("DEMO_PASSWORD est nécessaire.");

const PAGES = {
  public: ["/", "/annuaire", "/evenements", "/evenements/demo-ev-soiree-implanto", "/experts/demo-p-durand", "/actualites", "/connexion", "/inscription", "/mot-de-passe-oublie", "/mentions-legales"],
  "helene.durand@demo.kolbase.local": ["/tableau-de-bord", "/sollicitations", "/propositions", "/inscriptions", "/compte", "/revenus"],
  "julien.faure@demo.kolbase.local": [
    "/organisations/demo-org-dentalys",
    "/organisations/demo-org-dentalys/evenements",
    "/organisations/demo-org-dentalys/evenements/nouveau",
    "/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto",
    "/organisations/demo-org-dentalys/dossiers",
    "/organisations/demo-org-dentalys/dossiers/nouveau",
    "/organisations/demo-org-dentalys/devis",
    "/organisations/demo-org-dentalys/intervenants",
    "/organisations/demo-org-dentalys/statistiques",
    "/organisations/demo-org-dentalys/membres",
  ],
  "anne.chevalier@demo.kolbase.local": ["/admin", "/admin?onglet=lancement"],
};

// Violations bloquantes. Une règle ne s'ajoute ici qu'avec un ticket de correction : la liste doit rester vide.
const BLOCKING = new Set(["critical", "serious"]);
const TOLERATED = new Set([]);

const browser = withConsent(await chromium.launch(), BASE);
const findings = [];

for (const [who, paths] of Object.entries(PAGES)) {
  const ctx = await browser.newContext({ locale: "fr-FR" });
  const page = await ctx.newPage();
  if (who !== "public") {
    await page.goto(`${BASE}/connexion`);
    await page.fill('input[name="email"]', who);
    await page.fill('input[name="password"]', PW);
    await page.click('button:has-text("Se connecter")');
    await page.waitForURL((u) => u.pathname !== "/connexion", { timeout: 10000 }).catch(() => {
      throw new Error(`Connexion impossible pour ${who} : lancer ce test sur une base fraîchement chargée avec la démo.`);
    });
  }
  for (const path of paths) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    if (!res || res.status() >= 400) {
      findings.push({ path, who, id: "page-indisponible", impact: "critical", help: `HTTP ${res?.status()}`, nodes: [] });
      continue;
    }
    // Page protégée renvoyée vers la connexion : on analyserait la mauvaise page.
    if (who !== "public" && new URL(page.url()).pathname === "/connexion") {
      findings.push({ path, who, id: "session-perdue", impact: "critical", help: "redirigé vers /connexion", nodes: [] });
      continue;
    }
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const v of violations) findings.push({ path, who, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) });
  }
  await ctx.close();
}
// Bandeau cookies (première visite) puis son panneau « Personnaliser ».
{
  const ctx = await browser.newContext({ locale: "fr-FR", consent: false });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  for (const [label, open] of [["bandeau", async () => {}], ["panneau", async () => { await page.locator(".cookie-banner").getByRole("button", { name: "Personnaliser" }).click(); await page.locator(".cookie-banner.panel").waitFor(); }]]) {
    await open();
    const { violations } = await new AxeBuilder({ page }).include(".cookie-banner").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const v of violations) findings.push({ path: `/ (cookies, ${label})`, who: "public", id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) });
  }
  await ctx.close();
}
await browser.close();

let blocking = 0;
for (const f of findings) {
  const fatal = BLOCKING.has(f.impact) && !TOLERATED.has(f.id);
  if (fatal) blocking++;
  console.log(`${fatal ? "FAIL" : "info"} [${f.impact}] ${f.path} (${f.who}) ${f.id} : ${f.help}`);
  for (const n of f.nodes.slice(0, 3)) console.log(`       ${n}`);
}
const pages = Object.values(PAGES).flat().length + 1;
console.log(`\n${pages} pages analysées, ${findings.length} constats, ${blocking} bloquants.`);
process.exit(blocking ? 1 : 0);
