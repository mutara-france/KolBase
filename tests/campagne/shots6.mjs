import { chromium } from "playwright";
const b = await chromium.launch();
const dir = "/home/claude/kb-tests/ux";
async function as(email, fn) {
  const ctx = await b.newContext({ locale: "fr-FR", viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 }); const page = await ctx.newPage();
  await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click("form button.btn")]);
  await fn(page); await ctx.close();
}
await as("anne.chevalier@demo.kolbase.local", async (page) => {
  await page.goto("http://localhost:3000/organisations/demo-org-academie/evenements/demo-ev-tp-endo");
  await page.click('button:has-text("Retirer de l\'agenda")'); await page.waitForTimeout(800);
  await Promise.all([page.waitForURL(/publie=1/), page.click('button:has-text("Publier dans l\'agenda")')]);
  await page.locator(".published-offer").screenshot({ path: `${dir}/s-publie.png` });
  const sec = page.locator('section:has(h2#services)'); await sec.scrollIntoViewIfNeeded(); await sec.screenshot({ path: `${dir}/s-pack.png` });
});
await as("pierre.vidal@demo.kolbase.local", async (page) => {
  await page.goto("http://localhost:3000/organisations/demo-org-cdra/abonnement");
  await page.locator("section.card").first().screenshot({ path: `${dir}/s-annuel.png` });
});
await as("thomas.garnier@demo.kolbase.local", async (page) => {
  await page.goto("http://localhost:3000/compte");
  await page.click('button:has-text("Activer la double authentification")'); await page.waitForSelector(".totp-secret");
  await page.locator("#securite").screenshot({ path: `${dir}/s-2fa.png` });
});
await as("emma.simon@demo.kolbase.local", async (page) => {
  await page.goto("http://localhost:3000/tableau-de-bord");
  await page.locator(".newsletter-ask").screenshot({ path: `${dir}/s-lettre.png` });
});
await b.close();
