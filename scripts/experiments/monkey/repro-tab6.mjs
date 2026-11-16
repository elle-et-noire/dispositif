// Minimal: open with a hash in 1段, switch to n段, then Tab. Where does focus go after each step?
import { chromium } from "playwright-core";
const BASE = "http://localhost:4321/dispositif/";
const out = new URL(".", import.meta.url).pathname;
const [hash = "双対newton恒等式", w = "960", h = "600", dpr = "1.5", pre = "2"] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(dpr) });
const page = await context.newPage();
await page.goto(new URL(`symmetric-polynomial/?columns=single${hash ? `#${hash}` : ""}`, BASE).href);
await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.documentElement.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]"));
await page.waitForTimeout(400);
const where = (label) => page.evaluate((label) => {
  const a = document.activeElement;
  const copy = Boolean(a.closest(".cl-content") && !a.closest(".cl-source"));
  const mjx = (s) => s.querySelector?.("mjx-container")?.getAttribute("aria-label") ?? "";
  return `${label}: ${copy ? "COPY" : "orig"} ${a.tagName.toLowerCase()}.${[...a.classList].join(".")} k=${a.closest(".cl-slot")?.dataset.clK ?? "-"} ${mjx(a).slice(0, 30)} ${(a.textContent || "").trim().slice(0, 20)} sw=${a.scrollWidth}/${a.clientWidth}`;
}, label);
for (let i = 0; i < Number(pre); i++) { await page.keyboard.press("Tab"); console.log(await where(`pre-tab ${i}`)); }
await page.locator(".cl-toggle").click();
await page.waitForTimeout(400);
console.log(await where("after toggle"));
for (let i = 0; i < 6; i++) {
  await page.keyboard.press("Tab");
  await page.waitForTimeout(120);
  const s = await where(`tab ${i}`);
  console.log(s);
  if (s.includes("COPY")) { await page.screenshot({ path: `${out}tab-copy.png` }); break; }
}
await browser.close();
