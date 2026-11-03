import { chromium } from "playwright";
const [email, ...paths] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click("form button.btn")]);
for (const p of paths) { await page.goto("http://localhost:3000" + p, { waitUntil: "networkidle" }); const f = "/home/claude/kb-tests/apercu/apres" + p.replaceAll("/", "_") + ".png"; await page.screenshot({ path: f, fullPage: true }); console.log(f); }
await b.close();
