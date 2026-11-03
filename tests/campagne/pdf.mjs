import { chromium } from "playwright";
import fs from "node:fs";
const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', "claire.morel@demo.kolbase.local"); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click('button:has-text("Se connecter")')]);
const r = await ctx.request.get("http://localhost:3000/organisations/demo-org-dentalys/dossiers/demo-prj-board/convention/demo-prj-board-x1");
console.log(r.status(), r.headers()["content-type"]);
fs.writeFileSync("/home/claude/kb-tests/conv.pdf", await r.body());
await b.close();
