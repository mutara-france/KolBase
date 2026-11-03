import { chromium } from "playwright";
const b = await chromium.launch();
const shot = async (email, url, file, sel) => {
  const ctx = await b.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }); const page = await ctx.newPage();
  await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click("form button.btn")]);
  await page.goto("http://localhost:3000" + url);
  if (sel) { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.screenshot({ path: file }); }
  else await page.screenshot({ path: file, fullPage: true });
  await ctx.close();
};
await shot("julien.faure@demo.kolbase.local", "/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto", "/home/claude/kb-tests/ux/svc-event.png", 'section:has(h2:has-text("Faire connaître"))');
await shot("anne.chevalier@demo.kolbase.local", "/admin?onglet=services", "/home/claude/kb-tests/ux/svc-admin.png");
await b.close();
