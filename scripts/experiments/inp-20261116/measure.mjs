// Temporary: measure the responsiveness (INP-like) of operations after an
// article has loaded. Not committed.
// Usage: node .measure-inp/measure.mjs <base> <runs> > out.jsonl
// Env: ENGINES=chromium,firefox  THROTTLE=1,4  ARTICLES=...  VIEWPORTS=desktop,mobile  OPS=main,close
import { chromium, firefox } from "playwright-core";
import { analyze } from "./trace-analyze.mjs";

const base = process.argv[2] ?? "http://localhost:4336/dispositif/";
const runs = Number(process.argv[3] ?? 12);
const only = (name, all) => process.env[name] ? all.filter((v) => process.env[name].split(",").includes(String(v))) : all;
const articles = only("ARTICLES", ["symmetric-polynomial", "nextjs-mdx"]);
const viewports = only("VIEWPORTS", ["desktop", "mobile"]);
const sizes = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
const opsSets = only("OPS", ["main", "close"]);
const conditions = [];
for (const e of only("ENGINES", ["chromium", "firefox"])) {
  for (const rate of e === "chromium" ? only("THROTTLE", ["1", "4"]).map(Number) : [1]) conditions.push([e, rate]);
}
const engines = { chromium, firefox };
// How long a key is held (ms). 0 sends keyup right after keydown.
const KEY_DELAY = Number(process.env.KEY_DELAY ?? 0);
const out = (row) => process.stdout.write(JSON.stringify(row) + "\n");

const probe = () => {
  window.inpEvents = [];
  window.inpLoaf = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.inpEvents.push({
        name: e.name, id: e.interactionId, start: e.startTime, duration: e.duration,
        pStart: e.processingStart, pEnd: e.processingEnd,
        target: e.target ? (e.target.className?.baseVal ?? e.target.className ?? e.target.tagName) : null,
      });
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
  } catch (error) { window.inpError = String(error); }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.inpLoaf.push({
        start: e.startTime, duration: e.duration, blocking: e.blockingDuration,
        renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart,
        scripts: e.scripts.map((s) => ({
          invoker: s.invoker, invokerType: s.invokerType, fn: s.sourceFunctionName,
          url: s.sourceURL.split("/").pop(), pos: s.sourceCharPosition,
          start: s.startTime, dur: s.duration, forced: s.forcedStyleAndLayoutDuration,
        })),
      });
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch { /* Firefox */ }
};

const settle = (page, ms = 400) => page.evaluate((ms) => new Promise((r) =>
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ms)))), ms);

const waitForColumnLayout = (page) => page.waitForFunction(() => {
  const root = document.documentElement;
  return root.dataset.pageKind === "article" && root.classList.contains("cl-ready")
    && !root.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]");
}, null, { timeout: 120_000 });

let current;
const traceOps = process.env.TRACE_OPS?.split(",");
const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-v8.cpu_profiler", "v8.execute", "blink.user_timing"];
async function measureOp(page, op, action, wait = 400) {
  const recordOps = process.env.RECORD_OPS?.split(",");
  if ((process.env.TRACE_ONLY && !traceOps?.includes(op)) || (recordOps && !recordOps.includes(op))) {
    await action(); await settle(page, wait); return;
  }
  const tracing = current.engine === "chromium" && traceOps?.includes(op);
  const browser = page.context().browser();
  if (tracing) await browser.startTracing(page, { categories: TRACE_CATEGORIES });
  const t0 = await page.evaluate(() => performance.mark("inp:t0").startTime);
  try { await action(); } catch (error) {
    if (tracing) await browser.stopTracing();
    process.stderr.write(`skip ${op} run ${current.run}: ${error.message.split("\n")[0]}\n`);
    return;
  }
  await settle(page, wait);
  const traceJson = tracing ? JSON.parse((await browser.stopTracing()).toString()) : undefined;
  const data = await page.evaluate((t0) => ({
    events: window.inpEvents.filter((e) => e.start >= t0 && e.id > 0),
    loaf: window.inpLoaf.filter((l) => l.start + l.duration >= t0),
    error: window.inpError,
  }), t0);
  const groups = new Map();
  for (const e of data.events) groups.set(e.id, [...(groups.get(e.id) ?? []), e]);
  let worst;
  for (const list of groups.values()) for (const e of list) if (!worst || e.duration > worst.duration) worst = e;
  const row = { ...current, op, inp: worst ? worst.duration : null, interactions: groups.size };
  if (worst) {
    row.event = worst.name; row.target = worst.target;
    const group = groups.get(worst.id);
    const first = Math.min(...group.map((e) => e.start)), lastEnd = Math.max(...group.map((e) => e.pEnd));
    row.inputDelay = Math.round(Math.min(...group.map((e) => e.pStart)) - first);
    row.processing = Math.round(group.reduce((sum, e) => sum + e.pEnd - e.pStart, 0));
    row.presentation = Math.round(Math.max(...group.map((e) => e.start + e.duration)) - lastEnd);
    row.events = group.map((e) => `${e.name}:${e.duration}`).join(" ");
    const end = worst.start + worst.duration;
    row.loaf = data.loaf.filter((l) => l.start < end && l.start + l.duration > worst.start).map((l) => ({
      start: Math.round(l.start - worst.start), duration: Math.round(l.duration),
      render: l.renderStart ? Math.round(l.start + l.duration - l.renderStart) : 0,
      styleLayout: l.styleAndLayoutStart ? Math.round(l.start + l.duration - l.styleAndLayoutStart) : 0,
      scripts: l.scripts.map((s) => ({ ...s, start: Math.round(s.start - worst.start), dur: Math.round(s.dur), forced: Math.round(s.forced) })),
    }));
    if (traceJson) row.trace = analyze(traceJson, "inp:t0", [worst.start - t0, worst.start + worst.duration - t0]);
  }
  if (data.error) row.error = data.error;
  out(row);
  return row;
}

// Clicks the visible instance (original or copy) of the index-th element of
// `selector` inside .cl-source, at its centre, with a real mouse event.
async function visiblePoint(page, selector, index, copyAttr) {
  return page.evaluate(([selector, index, copyAttr]) => {
    const vp = document.querySelector(".cl-viewport");
    const multi = document.documentElement.classList.contains("cl-multi");
    const original = document.querySelectorAll(`.cl-source ${selector}`)[index];
    const candidates = [original];
    if (multi) {
      // Copies of the same element: same position among the copies' matches is
      // not reliable, so match by text and tag.
      const key = (el) => (el.closest("figure, details") ?? el).textContent;
      for (const el of document.querySelectorAll(`.cl-copies ${selector}`)) {
        if (key(el) === key(original) && el.tagName === original.tagName) candidates.push(el);
      }
    }
    const bounds = multi ? vp.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (const el of candidates) {
      for (const r of el.getClientRects()) {
        const x = Math.min(r.left + 8, r.right - 2), y = (r.top + r.bottom) / 2;
        if (x < bounds.left || x > bounds.right || y < bounds.top + 4 || y > bounds.bottom - 4) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y };
      }
    }
    return null;
  }, [selector, index, copyAttr]);
}

// Brings an element of the original into view without an interaction: focus
// in n段 (the reader follows focus), scrollIntoView in 1段.
async function reveal(page, selector, index) {
  await page.evaluate(([selector, index]) => {
    const el = document.querySelectorAll(`.cl-source ${selector}`)[index];
    if (document.documentElement.classList.contains("cl-multi")) {
      el.focus({ preventScroll: true });
      el.blur();
    } else el.scrollIntoView({ block: "center", behavior: "instant" });
  }, [selector, index]);
  await settle(page, 300);
}

async function clickElement(page, selector, index) {
  let point = await visiblePoint(page, selector, index);
  if (!point) { await reveal(page, selector, index); point = await visiblePoint(page, selector, index); }
  if (!point) throw new Error(`no visible ${selector}[${index}]`);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(50);
  await page.mouse.click(point.x, point.y);
}

async function newPage(browser, engineName, rate, viewport) {
  const context = await browser.newContext({ viewport: sizes[viewport] });
  if (engineName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript(probe);
  const page = await context.newPage();
  let cdp;
  if (engineName === "chromium") cdp = await context.newCDPSession(page);
  const throttle = async (on) => { if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: on ? rate : 1 }); };
  return { context, page, throttle };
}

async function mainOps(browser, engineName, rate, article, viewport) {
  const { context, page, throttle } = await newPage(browser, engineName, rate, viewport);
  await page.goto(new URL(`${article}/?columns=single`, base).href);
  await waitForColumnLayout(page);
  await page.evaluate(() => document.fonts.ready);
  if (process.env.EXTRA_CSS) await page.addStyleTag({ content: process.env.EXTRA_CSS });
  if (process.env.NO_BLUR) await page.addStyleTag({ content: ".cl-backdrop { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }" });
  await settle(page, 1000);
  await throttle(true);
  const tocLinks = await page.locator("[data-toc-variant=sidebar] .toc-link").count();
  // Only elements outside a (closed) details element can be clicked directly.
  const detailsIdx = await page.evaluate(() => [...document.querySelectorAll(".cl-source details > summary")]
    .map((s, i) => s.parentElement.parentElement.closest("details") ? -1 : i).filter((i) => i >= 0));
  const copyIdx = await page.evaluate(() => [...document.querySelectorAll(".cl-source .code-copy-button")]
    .map((b, i) => b.closest("details") ? -1 : i).filter((i) => i >= 0));
  const detailsCount = detailsIdx.length, copyCount = copyIdx.length;
  const mobile = viewport === "mobile";
  for (let run = 0; run < runs; run++) {
    current.run = run;
    const linkIndex = (run * 3 + 1) % tocLinks;
    // --- 1段 ---
    await page.evaluate(() => document.querySelector(".cl-article-scrollport").scrollTo({ top: 0, behavior: "instant" }));
    await settle(page, 200);
    if (mobile) {
      await measureOp(page, "toc-mobile-open", () => page.locator(".toc-mobile-toggle").click());
      await measureOp(page, "toc-single", () => page.locator("[data-toc-variant=mobile] .toc-link").nth(linkIndex).click(), 600);
    } else {
      await measureOp(page, "toc-single", () => page.locator("[data-toc-variant=sidebar] .toc-link").nth(linkIndex).click(), 600);
    }
    await reveal(page, ".post > p", 0);
    await measureOp(page, "click-text-single", () => clickElement(page, ".post > p", 0));
    if (detailsCount) {
      const i = detailsIdx[run % detailsCount];
      await reveal(page, "details > summary", i);
      await measureOp(page, "details-open-single", () => clickElement(page, "details > summary", i));
      await measureOp(page, "details-close-single", () => clickElement(page, "details > summary", i));
    }
    if (copyCount) {
      const i = copyIdx[run % copyCount];
      await reveal(page, ".code-copy-button", i);
      await page.locator(".cl-source .code-copy-button").nth(i).scrollIntoViewIfNeeded();
      await measureOp(page, "copy-single", () => page.locator(".cl-source .code-copy-button").nth(i).click({ force: true }));
    }
    // Toggle from a point in the middle of the article (the TOC link's heading).
    await page.locator("[data-toc-variant=sidebar] .toc-link").nth(linkIndex).evaluate((a) =>
      document.getElementById(decodeURIComponent(a.hash.slice(1)))?.scrollIntoView({ block: "start", behavior: "instant" }));
    await settle(page, 300);
    await measureOp(page, "toggle-to-multi", () => page.locator(".cl-toggle:visible").click(), 800);
    // --- n段 ---
    await measureOp(page, "toc-multi", () => page.locator("[data-toc-variant=header] .toc-link").nth((linkIndex + 2) % tocLinks).click(), 600);
    await page.locator(".cl-viewport").focus();
    await measureOp(page, "key-Home", () => page.keyboard.press("Home", { delay: KEY_DELAY }), 600);
    await measureOp(page, "key-PageDown", () => page.keyboard.press("PageDown", { delay: KEY_DELAY }), 600);
    await measureOp(page, "key-ArrowRight", () => page.keyboard.press("ArrowRight", { delay: KEY_DELAY }), 800);
    await measureOp(page, "key-ArrowLeft", () => page.keyboard.press("ArrowLeft", { delay: KEY_DELAY }), 800);
    await measureOp(page, "key-End", () => page.keyboard.press("End", { delay: KEY_DELAY }), 600);
    await measureOp(page, "key-Home2", () => page.keyboard.press("Home", { delay: KEY_DELAY }), 600);
    await measureOp(page, "click-text-multi", () => clickElement(page, ".post > p", 0));
    if (detailsCount) {
      const i = detailsIdx[run % detailsCount];
      await reveal(page, "details > summary", i);
      await measureOp(page, "details-open-multi", () => clickElement(page, "details > summary", i), 600);
      await measureOp(page, "details-close-multi", () => clickElement(page, "details > summary", i), 600);
    }
    if (copyCount) {
      const i = copyIdx[run % copyCount];
      await reveal(page, ".code-copy-button", i);
      await measureOp(page, "copy-multi", () => clickElement(page, ".code-copy-button", i));
    }
    // Back to 1段 from the middle of the article.
    await page.locator(".cl-viewport").focus();
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await settle(page, 400);
    await measureOp(page, "toggle-to-single", () => page.locator(".cl-toggle:visible").click(), 800);
  }
  await context.close();
}

async function closeOps(browser, engineName, rate, article, viewport) {
  for (let run = 0; run < runs; run++) for (const mode of ["single", "multi"]) {
    current.run = run;
    const { context, page, throttle } = await newPage(browser, engineName, rate, viewport);
    await page.goto(new URL(`${article}/?columns=${mode}`, base).href);
    await waitForColumnLayout(page);
    await page.evaluate(() => document.fonts.ready);
    await settle(page, 800);
    await throttle(true);
    const close = page.locator(".cl-close:visible");
    await close.hover();
    await page.waitForTimeout(300);
    await measureOp(page, `close-${mode}`, async () => {
      await close.click();
      await page.waitForFunction(() => document.documentElement.dataset.pageKind !== "article", null, { timeout: 60_000 });
    }, 600);
    await context.close();
  }
}

for (const [engineName, rate] of conditions) {
  const browser = await engines[engineName].launch();
  // Warm-up (Firefox font list rebuild, caches).
  {
    const { context, page } = await newPage(browser, engineName, 1, "desktop");
    await page.goto(new URL("symmetric-polynomial/?columns=multi", base).href);
    await waitForColumnLayout(page);
    await context.close();
  }
  for (const article of articles) for (const viewport of viewports) {
    current = { engine: engineName, version: browser.version(), rate, article, viewport };
    if (opsSets.includes("main")) await mainOps(browser, engineName, rate, article, viewport);
    if (opsSets.includes("close")) await closeOps(browser, engineName, rate, article, viewport);
  }
  await browser.close();
}
