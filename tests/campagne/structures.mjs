import { chromium } from "playwright";
const b = await chromium.launch();
for (const [vp, name] of [[{ width: 1280, height: 900 }, "desktop"], [{ width: 375, height: 812 }, "mobile"]]) {
  const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 500 });
  const page = await ctx.newPage();
  for (const q of ["", "?type=prestataires", "?type=formation&q=zzz", "?q=lyon"]) {
    await page.goto("http://localhost:3000/structures" + q, { waitUntil: "networkidle" });
    if (name === "desktop") {
      const heads = await page.locator("main h2").allInnerTexts();
      const chips = await page.locator("nav.chips a").allInnerTexts();
      console.log(q || "(toutes)", "| sections :", heads.join(" / "), "| filtres :", chips.join(" · "));
    }
    if (q === "") await page.screenshot({ path: `/home/claude/kb-tests/structures-${name}.png`, fullPage: name === "desktop" });
  }
  console.log(name, "débordement :", await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  await ctx.close();
}
const ctx = await b.newContext(); await ctx.addCookies([{ name: "kb_lang", value: "en", url: "http://localhost:3000" }]);
const p = await ctx.newPage(); await p.goto("http://localhost:3000/structures");
console.log("EN :", (await p.locator("main h2").allInnerTexts()).join(" / "));
await b.close();
