// Tour UX : captures des pages clés par rôle (réduites), pour revue de cohérence.
import { chromium } from "playwright";
const B = "http://localhost:3000", OUT = "/home/claude/kb-tests/ux";
const tours = {
  claire: ["claire.morel@demo.kolbase.local", ["/tableau-de-bord", "/organisations/demo-org-dentalys", "/organisations/demo-org-dentalys/dossiers", "/organisations/demo-org-dentalys/evenements", "/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto", "/organisations/demo-org-dentalys/prestataires?onglet=nouvelle", "/organisations/demo-org-dentalys/conformite", "/organisations/demo-org-dentalys/membres", "/organisations/demo-org-dentalys/dossiers/nouveau"]],
  sophie: ["sophie.bernard@demo.kolbase.local", ["/tableau-de-bord", "/organisations/demo-org-dentalys/dossiers/demo-prj-symposium"]],
  karim: ["karim.benali@demo.kolbase.local", ["/tableau-de-bord", "/organisations/demo-org-mediane/devis", "/organisations/demo-org-dentalys/evenements"]],
  helene: ["helene.durand@demo.kolbase.local", ["/tableau-de-bord", "/sollicitations"]],
};
const b = await chromium.launch();
for (const [who, [email, paths]] of Object.entries(tours)) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 0.7 }); const page = await ctx.newPage();
  await page.goto(B + "/connexion"); await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click("form button.btn")]);
  for (const p of paths) {
    const r = await page.goto(B + p, { waitUntil: "networkidle" });
    const f = `${OUT}/${who}${p.replaceAll("/", "_").replaceAll("?", "_")}.png`;
    await page.screenshot({ path: f, fullPage: true });
    console.log(r?.status(), page.url().replace(B, ""), f.split("/").pop());
  }
  await ctx.close();
}
await b.close();
