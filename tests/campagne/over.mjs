import { chromium } from "playwright";
const [email, ...paths] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true }); const page = await ctx.newPage();
await page.goto("http://localhost:3000/connexion"); await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', "demo-ci-mot-de-passe-1");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/connexion")), page.click('button:has-text("Se connecter")')]);
for (const p of paths) {
  await page.goto("http://localhost:3000" + p, { waitUntil: "networkidle" });
  const r = await page.evaluate(() => [...document.querySelectorAll("main input, main dd, main select, main textarea")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 2).slice(0, 6).map((e) => {
    const chain = []; let x = e; for (let i = 0; i < 5 && x; i++, x = x.parentElement) chain.push(x.tagName.toLowerCase() + (typeof x.className === "string" && x.className ? "." + x.className.trim().split(/\s+/).join(".") : ""));
    return `${e.getAttribute("name") ?? e.textContent.slice(0, 30)} w=${Math.round(e.getBoundingClientRect().width)} right=${Math.round(e.getBoundingClientRect().right)} :: ${chain.join(" < ")}`;
  }));
  console.log("==", p); r.forEach((x) => console.log("  ", x));
  const el = await page.$("main input[name] >> nth=0");
  await page.screenshot({ path: `/home/claude/kb-tests/mobile/full${p.replaceAll("/", "_")}.png`, fullPage: true });
}
await b.close();
