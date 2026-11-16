// Experiment: which style attributes change in each frame of an ArrowRight
// animation in n段, versus a native scroll of the same distance.
import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://localhost:4336/dispositif/symmetric-polynomial/?columns=multi");
await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.documentElement.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]"));
await page.waitForTimeout(800);
const watch = () => page.evaluate(() => {
  window.muts = [];
  window.mo?.disconnect();
  window.mo = new MutationObserver((list) => {
    for (const m of list) window.muts.push({ t: Math.round(performance.now()), cls: m.target.className, attr: m.attributeName,
      old: m.oldValue?.match(/(left|translate|clip-path)[^;]*/g)?.join(";").slice(0, 80), now: m.target.getAttribute(m.attributeName)?.match(/(left|translate|clip-path)[^;]*/g)?.join(";").slice(0, 80) });
  });
  window.mo.observe(document.querySelector(".cl-plane"), { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["style"] });
});
const report = async (label) => {
  const muts = await page.evaluate(() => window.muts);
  const byFrame = {};
  for (const m of muts) (byFrame[m.t] ??= []).push(`${String(m.cls).split(" ")[0]}`);
  console.log(label, "style mutations:", muts.length, "batches:", Object.keys(byFrame).length);
  console.log("  sample:", JSON.stringify(muts.slice(0, 4)));
};
await page.locator(".cl-viewport").focus();
await watch();
await page.keyboard.press("ArrowRight", { delay: 80 });
await page.waitForTimeout(500);
await report("ArrowRight");
await watch();
await page.evaluate(() => new Promise((resolve) => {
  const v = document.querySelector(".cl-viewport"); let n = 0;
  const step = () => { v.scrollLeft += 40; if (++n < 12) requestAnimationFrame(step); else resolve(); };
  requestAnimationFrame(step);
}));
await page.waitForTimeout(300);
await report("native scroll");
const info = await page.evaluate(() => ({ dpr: devicePixelRatio, x: document.querySelector(".cl-viewport").scrollLeft }));
console.log(info);
await browser.close();
