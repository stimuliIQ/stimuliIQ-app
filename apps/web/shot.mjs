import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });

async function shot(url, name, sel) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForTimeout(3000);
  const target = sel ? page.locator(sel).first() : page;
  await target.screenshot({ path: name });
  const overlay = await page.evaluate(() => {
    const r = document.querySelector("nextjs-portal")?.shadowRoot;
    const t = r?.textContent ?? "";
    const m = t.match(/(Console Error|Runtime Error|Unhandled|hydrat)[^]{0,180}/i);
    return m ? m[0].replace(/\s+/g, " ") : null;
  });
  console.log(name, "ok", overlay ? `| overlay: ${overlay}` : "");
}

await shot("http://localhost:3000/", "s-whyus.png", "[data-testid='why-us']");
await shot("http://localhost:3000/about", "s-about.png");
await shot("http://localhost:3000/for-colleges", "s-colleges-page.png");
console.log("errors:", [...new Set(errors)].slice(0, 6));
await browser.close();
