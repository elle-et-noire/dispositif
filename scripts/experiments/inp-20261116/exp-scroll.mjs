// Experiment: PrePaint per frame while the n段 viewport scrolls natively,
// with the site's scroll handling blocked (capture-phase stopPropagation),
// so only the browser's own work for the scroll remains.
import { chromium } from "playwright-core";
const article = process.env.ARTICLE ?? "symmetric-polynomial";
const browser = await chromium.launch();
for (const variant of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://localhost:4336/dispositif/${article}/?columns=multi`);
  await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.documentElement.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]"));
  await page.waitForTimeout(800);
  if (variant !== "site") await page.evaluate(() => window.addEventListener("scroll", (e) => e.stopPropagation(), { capture: true }));
  if (variant === "noclip") await page.addStyleTag({ content: ".cl-track { clip-path: none !important; }" });
  if (variant === "nopaper") await page.addStyleTag({ content: ".cl-paper { display: none !important; }" });
  if (variant === "nosource") await page.addStyleTag({ content: ".cl-source { display: none !important; }" });
  if (variant.startsWith("focus")) { await page.keyboard.press("Shift"); await page.locator(".cl-viewport").focus(); }
  if (variant === "focus-nooutline") await page.addStyleTag({ content: ".cl-viewport:focus { outline: none !important; }" });
  await page.waitForTimeout(300);
  await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"] });
  await page.evaluate((delta) => new Promise((resolve) => {
    const v = document.querySelector(".cl-viewport");
    let n = 0, x = v.scrollLeft;
    const step = () => { x += delta; v.scrollTo({ left: x, top: v.scrollTop, behavior: "instant" }); if (++n < 12) requestAnimationFrame(step); else resolve(); };
    requestAnimationFrame(step);
  }), Number(process.env.STEP ?? 40));
  await page.waitForTimeout(200);
  const json = JSON.parse((await browser.stopTracing()).toString());
  const main = json.traceEvents.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain"
    && json.traceEvents.some((x) => x.pid === e.pid && x.name === "PrePaint"));
  const durs = (name) => json.traceEvents.filter((e) => e.pid === main.pid && e.tid === main.tid && e.name === name).map((e) => Math.round(e.dur / 1000));
  const objects = await page.evaluate(() => { const v = document.querySelector(".cl-viewport"); return [document.querySelectorAll(".cl-plane *").length, v.scrollLeft, v.scrollWidth - v.clientWidth]; });
  console.log(variant, "elements in plane", objects, "PrePaint", JSON.stringify(durs("PrePaint")), "Paint", JSON.stringify(durs("Paint")));
  await page.close();
}
await browser.close();
