// Matrice d'accès : chaque profil × URL sensibles (statut final, sans suivre les redirections).
import { chromium } from "playwright";
const BASE = "http://localhost:3000", PW = "demo-ci-mot-de-passe-1", D = "@demo.kolbase.local";
const WHO = { anon: null, hugo: "hugo.robert", helene: "helene.durand", martin: "antoine.martin", claire: "claire.morel", julien: "julien.faure", marc: "marc.lefevre", sophie: "sophie.bernard", nadia: "nadia.haddad", karim: "karim.benali", ludo: "ludovic.perrin", thomas: "thomas.garnier", anne: "anne.chevalier" };
const URLS = [
  "/organisations/demo-org-dentalys",
  "/organisations/demo-org-dentalys/dossiers",
  "/organisations/demo-org-dentalys/dossiers/demo-prj-board",
  "/organisations/demo-org-dentalys/dossiers/demo-prj-board/convention/demo-prj-board-x1",
  "/organisations/demo-org-dentalys/conformite",
  "/organisations/demo-org-dentalys/conformite/export",
  "/organisations/demo-org-dentalys/hospitalites",
  "/organisations/demo-org-dentalys/hospitalites/export",
  "/organisations/demo-org-dentalys/hospitalites/convention/demo-reg-soiree-implanto-lambert",
  "/organisations/demo-org-dentalys/evenements",
  "/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto",
  "/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto/export",
  "/organisations/demo-org-dentalys/devis",
  "/organisations/demo-org-dentalys/membres",
  "/organisations/demo-org-dentalys/relecture",
  "/organisations/demo-org-dentalys/opportunites",
  "/organisations/demo-org-dentalys/intervenants",
  "/organisations/demo-org-dentalys/prestataires",
  "/organisations/demo-org-dentalys/integrations",
  "/organisations/demo-org-orthonova/dossiers",
  "/organisations/demo-sup-belleville",
  "/organisations/demo-sup-belleville/devis",
  "/sollicitations/demo-prj-board-x1",
  "/sollicitations/demo-prj-board-x1/convention",
  "/annuaire",
  "/annuaire/demo-p-durand",
  "/annuaire/demo-p-lambert",
  "/experts/demo-p-lambert",
  "/admin",
];
const browser = await chromium.launch();
const cols = Object.keys(WHO);
const out = {};
for (const k of cols) {
  const ctx = await browser.newContext({ locale: "fr-FR" });
  if (WHO[k]) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/connexion`);
    await page.fill('input[name="email"]', WHO[k] + D);
    await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 15000 }).catch(() => console.log("login KO", k)), page.click('button:has-text("Se connecter")')]);
  }
  for (const u of URLS) {
    const r = await ctx.request.get(BASE + u, { maxRedirects: 0 });
    const loc = (r.headers().location ?? "").replace(BASE, "");
    const s = r.status();
    const html = s === 200 && (r.headers()["content-type"] ?? "").includes("html") ? await r.text() : "";
    const nf = html.includes("NEXT_HTTP_ERROR_FALLBACK;404");
    (out[u] ??= {})[k] = s === 200 ? (nf ? "404*" : "OK") : s === 307 ? (loc.startsWith("/connexion") ? "login" : "→" + loc.split("/").slice(1, 3).join("/")) : String(s);
  }
  await ctx.close();
}
console.log("URL".padEnd(82) + cols.map((c) => c.slice(0, 6).padEnd(7)).join(""));
for (const u of URLS) console.log(u.replace("/organisations/", "/o/").padEnd(82) + cols.map((c) => out[u][c].slice(0, 6).padEnd(7)).join(""));
await browser.close();
