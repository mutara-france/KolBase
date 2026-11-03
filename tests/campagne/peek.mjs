import { chromium } from "playwright";
const [email, ...paths] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click('button:has-text("Se connecter")')]);
for (const p of paths) { await page.goto("http://localhost:3000" + p); console.log("\n=== " + p + " → " + page.url().replace("http://localhost:3000","")); console.log((await page.locator("main").innerText()).slice(0, 900)); }
await b.close();
