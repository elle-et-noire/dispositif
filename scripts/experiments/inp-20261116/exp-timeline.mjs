// Experiment: dump the main-thread timeline (slices >= 2 ms, 3 levels) of one
// key press in n段 on the math article, with 4x CPU throttling.
import { chromium } from "playwright-core";
const key = process.argv[2] ?? "PageDown";
const rate = Number(process.argv[3] ?? 4);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await page.goto("http://localhost:4336/dispositif/symmetric-polynomial/?columns=multi");
await page.waitForFunction(() => document.documentElement.classList.contains("cl-ready") && !document.documentElement.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]"));
await page.waitForTimeout(800);
await cdp.send("Emulation.setCPUThrottlingRate", { rate });
await page.locator(".cl-viewport").focus();
if (key === "Home") { await page.keyboard.press("End"); await page.waitForTimeout(800); }
await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "blink", "cc", "benchmark"] });
await page.evaluate(() => performance.mark("inp:t0"));
await page.keyboard.press(key, { delay: 80 });
await page.waitForTimeout(600);
const json = JSON.parse((await browser.stopTracing()).toString());
const ev = json.traceEvents;
const mark = ev.find((e) => e.name === "inp:t0");
const main = ev.find((e) => e.name === "thread_name" && e.pid === mark.pid && e.args?.name === "CrRendererMain");
const xs = ev.filter((e) => e.pid === mark.pid && e.tid === main.tid && e.ph === "X" && e.dur >= 1000 && e.ts >= mark.ts)
  .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const stack = [];
for (const e of xs) {
  while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
  if (stack.length < 7) console.log(`${"  ".repeat(stack.length)}${Math.round((e.ts - mark.ts) / 1000)} +${Math.round(e.dur / 1000)} ${e.name}${e.args?.data?.type ? ` (${e.args.data.type})` : ""}${e.args?.data?.functionName ? ` ${e.args.data.functionName}` : ""}`);
  stack.push(e);
}
await browser.close();
