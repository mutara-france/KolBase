import { chromium } from "playwright";
const [prefix, w, ...paths] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: Number(w), height: 900 }, deviceScaleFactor: Number(w) < 500 ? 1 : 0.7 }); const page = await ctx.newPage();
for (const p of paths) { await page.goto("http://localhost:3000" + p, { waitUntil: "networkidle" }); const f = `/home/claude/kb-tests/ux/${prefix}` + p.replaceAll("/", "_") + ".png"; await page.screenshot({ path: f, fullPage: true }); console.log(f); }
await b.close();
