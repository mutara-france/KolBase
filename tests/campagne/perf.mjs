import { chromium } from "playwright";
const BASE = "http://localhost:3000", D = "@demo.kolbase.local";
const SETS = [
  [null, ["/", "/experts", "/experts?specialite=Implantologie", "/structures/demo-org-dentalys", "/evenements"]],
  ["claire.morel", ["/annuaire", "/annuaire?q=Lyon", "/organisations/demo-org-dentalys", "/organisations/demo-org-dentalys/dossiers", "/organisations/demo-org-dentalys/dossiers/nouveau", "/organisations/demo-org-dentalys/evenements", "/organisations/demo-org-dentalys/evenements/perf-ev-200", "/organisations/demo-org-dentalys/conformite", "/organisations/demo-org-dentalys/hospitalites", "/organisations/demo-org-dentalys/hospitalites/export", "/organisations/demo-org-dentalys/conformite/export", "/organisations/demo-org-dentalys/evenements/calendrier"]],
  ["anne.chevalier", ["/admin"]],
];
const b = await chromium.launch();
for (const [who, paths] of SETS) {
  const ctx = await b.newContext(); const page = await ctx.newPage();
  if (who) { await page.goto(`${BASE}/connexion`); await page.fill('input[name="email"]', who + D); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1"); await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click('button:has-text("Se connecter")')]); }
  for (const p of paths) {
    const t = [];
    let size = 0, st = 0;
    for (let i = 0; i < 3; i++) { const t0 = Date.now(); const r = await ctx.request.get(BASE + p); const body = await r.body(); t.push(Date.now() - t0); size = body.length; st = r.status(); }
    t.sort((a, b) => a - b);
    console.log(`${String(t[1]).padStart(6)} ms  ${(size / 1024).toFixed(0).padStart(6)} Ko  ${st}  ${p}`);
  }
  await ctx.close();
}
await b.close();
