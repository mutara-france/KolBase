import { chromium } from "playwright";
import fs from "node:fs";
const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', "camille.petit@demo.kolbase.local"); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click("form button.btn")]);
const r = await ctx.request.get("http://localhost:3000/revenus/liens-interets");
fs.writeFileSync("/home/claude/kb-tests/ux/liens.pdf", await r.body());
await b.close();
