// n段: click an external link shown in a copy column. Where is focus, is a ring drawn, and where does the next Tab go?
import { chromium } from "playwright-core";
const BASE = "http://localhost:4321/dispositif/";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => localStorage.setItem("dispositif:columns", "multi"));
const page = await context.newPage();
await page.goto(new URL("how-to-write/", BASE).href);
await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.documentElement.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]"));
await page.waitForTimeout(300);
await page.mouse.move(720, 450);
let link = null;
for (let i = 0; i < 60 && !link; i++) {
  link = await page.evaluate(() => {
    const v = document.querySelector(".cl-viewport").getBoundingClientRect();
    const a = [...document.querySelectorAll('.cl-content:not(.cl-source) a[href^="http"]')].find((a) => {
      const r = a.getBoundingClientRect();
      if (r.width < 4 || r.left < v.left || r.right > v.right || r.top < v.top || r.bottom > v.bottom) return false;
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit && (hit === a || a.contains(hit));
    });
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, href: a.href, target: a.target };
  });
  if (!link) { await page.mouse.wheel(0, 200); await page.waitForTimeout(100); }
}
console.log("link", link);
const popup = context.waitForEvent("page", { timeout: 3000 }).catch(() => null);
await page.mouse.click(link.x, link.y);
const opened = await popup;
console.log("opened new page:", Boolean(opened), "url now:", page.url());
if (opened) await opened.close();
const focus = () => page.evaluate(() => {
  const a = document.activeElement;
  return `${a.closest(".cl-content") && !a.closest(".cl-source") ? "COPY" : "orig"} ${a.tagName.toLowerCase()} ${(a.textContent || "").trim().slice(0, 30)} focus-visible=${a.matches(":focus-visible")}`;
});
console.log("after click:", await focus());
for (let i = 0; i < 3; i++) { await page.keyboard.press("Tab"); console.log(`tab ${i}:`, await focus()); }
await browser.close();
