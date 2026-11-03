// Repère le texte d'interface resté en français quand la langue anglaise est choisie.
import { chromium } from "playwright";
const BASE = "http://localhost:3000", D = "@demo.kolbase.local";
const SETS = [
  ["mathieu.roux", ["/sollicitations/demo-prj-formation-x0", "/tableau-de-bord"]],
  ["helene.durand", ["/opportunites"]],
];
const FR = /\b(le|la|les|des|du|une|un|vous|votre|vos|pour|avec|dans|sur|est|sont|aucun|aucune|été|être|par|au|aux|ce|cette|ces|qui|que|ou|et|ne|pas|plus|mon|ma|mes|leur|leurs|tous|toutes|selon|depuis|avant|après)\b|[éèêàùçôîû]/i;
const b = await chromium.launch();
for (const [who, paths] of SETS) {
  const ctx = await b.newContext({ locale: "en-GB" });
  await ctx.addCookies([{ name: "kb_lang", value: "en", url: BASE }]);
  const page = await ctx.newPage();
  if (who) {
    await page.goto(`${BASE}/connexion`); await page.fill('input[name="email"]', who + D); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click('form button[type="submit"], form button.btn')]);
  }
  for (const p of paths) {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    const lines = await page.evaluate(() => {
      const sel = "h1,h2,h3,h4,label,button,th,legend,.muted,.hint,.notice,.pill,.kicker,.eyebrow,.todo-group,a.btn,nav a,.stat-label,.empty,summary,option,dt,p.text-sm,.meta-line,.tag,.chip,[placeholder]";
      const out = new Set();
      for (const el of document.querySelectorAll(sel)) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
        const ph = el.getAttribute("placeholder");
        if (own) out.add(own.slice(0, 120));
        if (ph) out.add("[placeholder] " + ph);
      }
      return [...out];
    });
    const fr = lines.filter((l) => FR.test(l));
    console.log(`\n== ${who ?? "anon"} ${p} (${fr.length})`);
    for (const l of fr.slice(0, 25)) console.log("   ", l);
  }
  await ctx.close();
}
await b.close();
