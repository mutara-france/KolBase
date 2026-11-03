import { chromium } from "playwright";
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 900 } }); const page = await ctx.newPage();
await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', "claire.morel@demo.kolbase.local"); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click("form button.btn")]);
for (const p of process.argv.slice(2)) {
await page.goto("http://localhost:3000" + p, { waitUntil: "networkidle" });
const r = await page.evaluate(() => { const out = []; for (const el of document.querySelectorAll("main *")) { if (el.closest(".pipeline li")) continue; const rc = el.getBoundingClientRect(); if (rc.right > 392 && rc.width > 0) out.push(`${el.tagName}.${el.className} w=${Math.round(rc.width)} r=${Math.round(rc.right)}`); } return [document.documentElement.scrollWidth, out.slice(0, 12)]; });
console.log(p, JSON.stringify(r, null, 1));
}
await b.close();
