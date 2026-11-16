// Experiment: main-thread work over a whole ArrowRight animation (and one
// PageDown) in n段, with optional injected CSS. Usage: node exp-arrow.mjs <css-variant>
import { chromium } from "playwright-core";
import { analyze } from "./trace-analyze.mjs";
const variants = {
  base: "",
  noblur: ".cl-backdrop { backdrop-filter: none !important; }",
  willchange: ".cl-viewport { will-change: scroll-position; } .cl-backdrop { backdrop-filter: none !important; }",
  nomath: "mjx-container { visibility: hidden !important; } .cl-backdrop { backdrop-filter: none !important; }",
};
const article = process.env.ARTICLE ?? "symmetric-polynomial";
const browser = await chromium.launch();
for (const name of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://localhost:4336/dispositif/${article}/?columns=multi`);
  await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.documentElement.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]"));
  if (variants[name]) await page.addStyleTag({ content: variants[name] });
  await page.waitForTimeout(800);
  await page.locator(".cl-viewport").focus();
  for (const key of ["ArrowRight", "ArrowRight", "PageDown", "PageDown", "ArrowLeft"]) {
    await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack", "blink.user_timing"] });
    await page.evaluate(() => performance.mark("inp:t0"));
    await page.keyboard.press(key, { delay: 80 });
    await page.waitForTimeout(500);
    const json = JSON.parse((await browser.stopTracing()).toString());
    const t = analyze(json, "inp:t0", [0, 500]);
    // Count frames and the longest PrePaint.
    const events = json.traceEvents;
    const mark = events.find((e) => e.name === "inp:t0");
    const pre = events.filter((e) => e.pid === mark.pid && e.name === "PrePaint" && e.ts >= mark.ts).map((e) => Math.round(e.dur / 1000));
    console.log(name, key, JSON.stringify(t.mainTop.slice(0, 6)), "prepaints", JSON.stringify(pre));
    await page.waitForTimeout(300);
  }
  await page.close();
}
await browser.close();
