import { chromium } from "playwright";
const b = await chromium.launch(); const p = await (await b.newContext({ locale: "fr-FR" })).newPage();
await p.goto("http://localhost:3000" + process.argv[2]);
console.log(await p.locator("main").count(), JSON.stringify((await p.locator("main").first().innerText()).slice(0, 400)));
await b.close();
