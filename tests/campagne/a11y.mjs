// Accessibilité (axe-core, WCAG 2.1 A/AA) + rendu mobile 375 px (débordement horizontal, captures).
import { chromium } from "playwright";
import fs from "node:fs";
const AXE = fs.readFileSync("/home/claude/kb-tests/node_modules/axe-core/axe.min.js", "utf8");
const BASE = "http://localhost:3000", PW = "demo-ci-mot-de-passe-1", D = "@demo.kolbase.local";
const SETS = [
  [null, ["/", "/experts", "/experts/demo-p-durand", "/structures/demo-org-dentalys", "/evenements", "/evenements/demo-ev-soiree-implanto", "/appels", "/connexion", "/inscription", "/aide", "/mot-de-passe-oublie"]],
  ["helene.durand", ["/tableau-de-bord", "/compte", "/sollicitations", "/sollicitations/demo-prj-board-x1", "/interventions", "/opportunites"]],
  ["claire.morel", ["/organisations/demo-org-dentalys", "/annuaire", "/organisations/demo-org-dentalys/dossiers", "/organisations/demo-org-dentalys/dossiers/demo-prj-board", "/organisations/demo-org-dentalys/dossiers/nouveau", "/organisations/demo-org-dentalys/evenements", "/organisations/demo-org-dentalys/evenements/demo-ev-soiree-implanto", "/organisations/demo-org-dentalys/conformite", "/organisations/demo-org-dentalys/hospitalites", "/organisations/demo-org-dentalys/membres", "/organisations/demo-org-dentalys/prestataires"]],
  ["anne.chevalier", ["/admin"]],
];
fs.mkdirSync("/home/claude/kb-tests/mobile", { recursive: true });
const b = await chromium.launch();
const agg = {};
for (const [who, paths] of SETS) {
  for (const vp of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
    const page = await ctx.newPage();
    if (who) {
      await page.goto(`${BASE}/connexion`); await page.fill('input[name="email"]', who + D); await page.fill('input[name="password"]', PW);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click("form button.btn")]);
    }
    for (const p of paths) {
      await page.goto(BASE + p, { waitUntil: "networkidle" });
      if (vp.width < 500) {
        const over = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          const bad = [...document.querySelectorAll("main *")].filter((e) => { const r = e.getBoundingClientRect(); return r.right > w + 2 && r.width > 0 && getComputedStyle(e).position !== "fixed"; });
          const top = bad.filter((e) => !bad.includes(e.parentElement)).slice(0, 3).map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "") + `(${Math.round(e.getBoundingClientRect().right)}px)`);
          return { page: document.documentElement.scrollWidth > w, n: bad.length, top };
        });
        if (over.page || over.n) console.log("MOBILE débordement", p, JSON.stringify(over));
        await page.screenshot({ path: `/home/claude/kb-tests/mobile/${(who ?? "anon")}${p.replaceAll("/", "_")}.png`, fullPage: false });
      } else {
        await page.addScriptTag({ content: AXE });
        const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, ex: v.nodes[0]?.target?.join(" "), help: v.help })));
        for (const v of res) { const a = (agg[v.id] ??= { impact: v.impact, help: v.help, pages: [], n: 0, ex: v.ex }); a.pages.push(p); a.n += v.n; }
      }
    }
    await ctx.close();
  }
}
console.log("\nAXE — violations WCAG 2.1 AA :");
for (const [id, a] of Object.entries(agg).sort((x, y) => y[1].n - x[1].n)) console.log(`- ${id} [${a.impact}] ×${a.n} sur ${a.pages.length} pages — ${a.help} — ex. ${a.ex} — ${a.pages.slice(0, 4).join(", ")}`);
await b.close();
