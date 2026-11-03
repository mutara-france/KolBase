import { chromium } from "playwright";
const [email, prefix, w, ...paths] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: Number(w), height: 860 }, deviceScaleFactor: Number(w) < 500 ? 1 : 0.7 }); const page = await ctx.newPage();
await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click("form button.btn")]);
for (const p of paths) { await page.goto("http://localhost:3000" + p, { waitUntil: "networkidle" }); const f = `/home/claude/kb-tests/ux/${prefix}` + p.replaceAll("/", "_").replaceAll("?", "_") + ".png"; await page.screenshot({ path: f, fullPage: true }); console.log(f.split("/").pop()); }
await b.close();
