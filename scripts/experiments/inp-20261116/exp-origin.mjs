// Experiment: the plane's native origin and the original's column before/after keys.
import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:4336/dispositif/symmetric-polynomial/?columns=multi");
await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.documentElement.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]"));
await page.waitForTimeout(800);
await page.locator(".cl-viewport").focus();
const state = () => page.evaluate(() => {
  const plane = document.querySelector(".cl-plane"), v = document.querySelector(".cl-viewport");
  const slots = [...document.querySelectorAll(".cl-slot")].map((s) => `${s.dataset.clK}${s.firstElementChild.classList.contains("cl-source") ? "*" : ""}`);
  return { ...plane.dataset, scrollLeft: v.scrollLeft, scrollTop: v.scrollTop, slots: slots.join(",") };
});
console.log("start", JSON.stringify(await state()));
for (const key of ["PageDown", "PageDown", "ArrowRight", "End", "Home"]) {
  await page.keyboard.press(key, { delay: 80 });
  await page.waitForTimeout(600);
  console.log(key, JSON.stringify(await state()));
}
await browser.close();
