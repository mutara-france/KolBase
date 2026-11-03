// Exploration exhaustive par profil : suit tous les liens internes (GET) et relève statuts, erreurs et redirections.
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PW = process.env.PW ?? "demo-ci-mot-de-passe-1";
const D = "@demo.kolbase.local";
const PERSONAS = [
  ["anonyme", null],
  ["praticien (Hugo, non référencé)", "hugo.robert"],
  ["assistante (Manon)", "manon.dubois"],
  ["expert RPPS vérifié (Hélène)", "helene.durand"],
  ["expert RPPS en attente (Julie)", "julie.lemoine"],
  ["Dentalys ADMIN (Claire)", "claire.morel"],
  ["Dentalys EDUCATION (Julien)", "julien.faure"],
  ["Dentalys EVENEMENTS (Marc)", "marc.lefevre"],
  ["Dentalys CONFORMITE (Sophie)", "sophie.bernard"],
  ["Dentalys RELECTURE (Nadia)", "nadia.haddad"],
  ["Agence + prestataire Dentalys (Karim)", "karim.benali"],
  ["Traiteur (Ludovic)", "ludovic.perrin"],
  ["Admin plateforme (Anne)", "anne.chevalier"],
];
const SKIP = [/^\/compte\/orcid/, /^\/confirmer-email/, /^\/_next/, /^\/deconnexion/, /\/api\//];
const MAX = Number(process.env.MAX ?? 400);

const browser = await chromium.launch();
const report = {};
for (const [label, who] of PERSONAS) {
  const ctx = await browser.newContext({ locale: "fr-FR" });
  const page = await ctx.newPage();
  if (who) {
    await page.goto(`${BASE}/connexion`);
    await page.fill('input[name="email"]', who + D);
    await page.fill('input[name="password"]', PW);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion"), { timeout: 15000 }).catch(() => {}), page.click('form button.btn')]);
  }
  const seen = new Set();
  const queue = ["/", "/tableau-de-bord", "/compte", "/organisations", "/annuaire", "/experts", "/structures", "/evenements", "/appels", "/opportunites", "/admin", "/aide", "/sollicitations", "/interventions", "/inscriptions", "/suivis", "/cgu", "/confidentialite", "/mentions-legales", "/compte/export", "/page-inexistante"];
  const rows = [];
  while (queue.length && seen.size < MAX) {
    const path = queue.shift();
    if (seen.has(path) || SKIP.some((r) => r.test(path))) continue;
    seen.add(path);
    const t0 = Date.now();
    let res;
    try { res = await ctx.request.get(BASE + path, { maxRedirects: 0, timeout: 30000 }); } catch (e) { rows.push({ path, status: "EXC", note: String(e).slice(0, 120) }); continue; }
    const ms = Date.now() - t0;
    const status = res.status();
    const ct = res.headers()["content-type"] ?? "";
    const loc = res.headers()["location"] ?? "";
    let note = "";
    if (ct.includes("text/html")) {
      const html = await res.text();
      if (html.includes("Une erreur est survenue") || html.includes("Something went wrong")) note = "ERREUR-PAGE";
      if (/NEXT_HTTP_ERROR_FALLBACK;404|Page introuvable/.test(html) && status === 200) note ||= "404-stream";
      for (const m of html.matchAll(/href="(\/[^"#]*)"/g)) {
        const href = m[1].replace(/&amp;/g, "&");
        if (!seen.has(href) && !queue.includes(href) && !href.startsWith("/_next")) queue.push(href);
      }
    }
    rows.push({ path, status, ms, ct: ct.split(";")[0], loc: loc.replace(BASE, ""), note });
  }
  report[label] = rows;
  const bad = rows.filter((r) => r.status === "EXC" || r.status >= 500 || r.note === "ERREUR-PAGE");
  const slow = rows.filter((r) => r.ms > 1500);
  console.log(`\n## ${label} : ${rows.length} URL, ${bad.length} erreurs, ${slow.length} lentes (>1,5 s)`);
  for (const r of bad) console.log("  ERREUR", r.status, r.path, r.note);
  for (const r of slow) console.log("  LENT", r.ms + "ms", r.path);
  await ctx.close();
}
fs.writeFileSync("/home/claude/kb-tests/crawl.json", JSON.stringify(report, null, 1));
await browser.close();
