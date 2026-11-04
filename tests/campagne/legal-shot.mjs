import { chromium } from "playwright";
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
for (const u of ["conditions-de-vente", "confidentialite", "cgu", "mentions-legales"]) {
  await p.goto(`http://localhost:3000/${u}`); await p.screenshot({ path: `/tmp/legal/${u}.png`, fullPage: true });
}
const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
await m.goto("http://localhost:3000/confidentialite"); await m.screenshot({ path: "/tmp/legal/conf-mobile.png", fullPage: false, clip: { x: 0, y: 1400, width: 390, height: 900 } }).catch(async () => m.screenshot({ path: "/tmp/legal/conf-mobile.png" }));
await b.close();
