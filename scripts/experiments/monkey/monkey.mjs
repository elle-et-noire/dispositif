// Monkey test for the dispositif article reader. One-off investigation, not CI.
//
// node monkey.mjs run  <engine> <article> <mode> <seed> <bursts> [outDir]
// node monkey.mjs replay <file.json> [skipIndexes(comma)]
//
// A run is a list of bursts generated from the seed. Each burst is 1-5
// operations with 0-300 ms between them (no settling, so operations land in
// the middle of the deferred text, key animations and navigations). After a
// burst the page settles and the invariants are checked.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox } from "playwright-core";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:4321/dispositif/";
const ARTICLES = ["symmetric-polynomial", "nextjs-mdx", "how-to-write", "tips-haskell"];
const VIEWPORTS = [[320, 640], [390, 844], [768, 1024], [1440, 900]];
const ZOOMS = [1, 1.25, 1.5];

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- operation generation (pure, from the seed) ----
const OPS = [
  ["wheel", 22], ["key", 22], ["click", 8], ["scrollbar", 5], ["toc", 6], ["eqref", 3],
  ["details", 4], ["copy", 2], ["toggle", 5], ["resize", 3], ["zoom", 2], ["reload", 3],
  ["back", 4], ["forward", 2], ["close", 3], ["direct", 2], ["print", 2], ["touch", 3], ["wait", 3],
];
const TOTAL = OPS.reduce((s, [, w]) => s + w, 0);
const KEYS = ["PageDown", "PageUp", "Space", "Shift+Space", "ArrowLeft", "ArrowRight", "Home", "End", "ArrowUp", "ArrowDown", "Tab", "Shift+Tab"];

function generate(seed, bursts, engine) {
  const rng = mulberry32(seed);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const out = [];
  for (let b = 0; b < bursts; b++) {
    const burst = [];
    const n = 1 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      let r = rng() * TOTAL, type;
      for (const [name, w] of OPS) { if ((r -= w) < 0) { type = name; break; } }
      if (type === "touch" && engine !== "chromium") type = "wheel";
      const op = { type, gap: rng() < 0.3 ? 0 : Math.floor(rng() * 300), r: rng() };
      if (type === "wheel") {
        const dir = pick([[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0.3, 1], [1, 0.3]]);
        const size = pick([3, 40, 120, 400]);
        op.dx = Math.round(dir[0] * size); op.dy = Math.round(dir[1] * size);
        op.n = pick([1, 1, 3, 10, 30]); op.every = pick([0, 8, 16]);
      } else if (type === "key") {
        op.key = pick(KEYS); op.n = pick([1, 1, 1, 2, 5]); op.every = pick([0, 30, 120]);
      } else if (type === "scrollbar") {
        op.axis = rng() < 0.6 ? "x" : "y"; op.to = rng(); op.steps = pick([1, 5, 15]);
      } else if (type === "resize") op.viewport = pick(VIEWPORTS);
      else if (type === "zoom") op.zoom = pick(ZOOMS);
      else if (type === "direct") {
        op.slug = pick(ARTICLES); op.columns = pick([null, "multi", "single"]); op.hash = rng() < 0.4;
      } else if (type === "touch") {
        op.dx = pick([0, 0, 200, -200, 600]); op.dy = pick([300, -300, 900, 0]); op.speed = pick([800, 3000]);
      } else if (type === "wait") op.ms = pick([50, 400, 1500]);
      burst.push(op);
    }
    out.push(burst);
  }
  return out;
}

// ---- page helpers ----
const isArticle = (page) => page.evaluate(() => document.documentElement.dataset.pageKind === "article").catch(() => false);

async function readArea(page) {
  // The rectangle the reader scrolls: n段 viewport or 1段 scrollport.
  return page.evaluate(() => {
    const multi = !document.querySelector(".cl-reader")?.hidden;
    const el = multi ? document.querySelector(".cl-viewport") : document.querySelector(".cl-article-scrollport");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const a = document.querySelector(".cl-article")?.getBoundingClientRect();
    return { multi, x: r.x, y: r.y, w: r.width, h: r.height, ax: a?.x, aw: a?.width };
  }).catch(() => null);
}

async function visibleTarget(page, selector, r) {
  // A visible element matching selector whose centre is not covered by another element.
  return page.evaluate(({ selector, r }) => {
    const list = [...document.querySelectorAll(selector)].filter((el) => {
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return false;
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return hit && (hit === el || el.contains(hit));
    });
    if (!list.length) return null;
    const el = list[Math.floor(r * list.length)];
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, text: (el.textContent || "").trim().slice(0, 40) };
  }, { selector, r }).catch(() => null);
}

// Browser zoom as the page sees it: a CSS viewport of window / zoom and a
// devicePixelRatio of zoom. An `html { zoom }` style is not used: Astro's
// ClientRouter drops it from <head> during a navigation, and the zoom change
// in the middle of the view transition aborts it (a harness artefact).
// Firefox has no CDP, so there zoom only shrinks the CSS viewport.
async function applyMetrics(page, ctx) {
  const [w, h] = ctx.physical, z = ctx.zoom;
  const width = Math.round(w / z), height = Math.round(h / z);
  if (ctx.cdp) await ctx.cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: z, mobile: false });
  else await page.setViewportSize({ width, height });
}

async function perform(page, op, ctx) {
  const area = await readArea(page);
  const cx = area ? area.x + area.w / 2 : 200, cy = area ? area.y + area.h / 2 : 300;
  switch (op.type) {
    case "wheel": {
      await page.mouse.move(cx + (op.r - 0.5) * (area?.w ?? 200) * 0.6, cy);
      for (let i = 0; i < op.n; i++) {
        await page.mouse.wheel(op.dx, op.dy);
        if (op.every) await page.waitForTimeout(op.every);
      }
      return { at: [Math.round(cx), Math.round(cy)] };
    }
    case "key": {
      const before = await deferState(page);
      for (let i = 0; i < op.n; i++) {
        await page.keyboard.press(op.key);
        if (op.every) await page.waitForTimeout(op.every);
      }
      const after = await deferState(page);
      return { before, after };
    }
    case "click": {
      // Anywhere on screen, as a user would: text, links, controls, backdrop.
      const v = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const x = Math.floor(op.r * v.width), y = Math.floor(((op.r * 7919) % 1) * v.height);
      const before = await deferState(page);
      const hit = await page.evaluate(([x, y]) => {
        const e = document.elementFromPoint(x, y);
        return e ? `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} ${e.closest("a")?.getAttribute("href") ?? ""}`.slice(0, 100) : null;
      }, [x, y]).catch(() => null);
      await page.mouse.click(x, y);
      const after = await deferState(page);
      return { at: [x, y], hit, before, after };
    }
    case "scrollbar": {
      if (!area?.multi) return { skipped: "1段" };
      const bar = await page.locator(".cl-viewport").evaluate((v, axis) => {
        const r = v.getBoundingClientRect(), scale = r.width / v.offsetWidth;
        const horizontal = axis === "x", button = 16 * scale;
        const client = horizontal ? v.clientWidth : v.clientHeight;
        const full = horizontal ? v.scrollWidth : v.scrollHeight;
        const offset = horizontal ? v.scrollLeft : v.scrollTop;
        const length = client * scale - 2 * button;
        const thumb = length * client / full;
        const start = (horizontal ? r.x : r.y) + button;
        const cross = horizontal ? r.y + v.clientHeight * scale + (v.offsetHeight - v.clientHeight) * scale / 2
          : r.x + v.clientWidth * scale + (v.offsetWidth - v.clientWidth) * scale / 2;
        if (full <= client) return null;
        return { start, length, thumb, cross, center: start + (length - thumb) * offset / (full - client) + thumb / 2, horizontal };
      }, op.axis).catch(() => null);
      if (!bar) return { skipped: "no bar" };
      const point = (along) => bar.horizontal ? [along, bar.cross] : [bar.cross, along];
      await page.mouse.move(...point(bar.center));
      await page.mouse.down();
      const target = bar.start + bar.thumb / 2 + op.to * (bar.length - bar.thumb);
      await page.mouse.move(...point(target), { steps: op.steps });
      await page.mouse.up();
      return { from: Math.round(bar.center), to: Math.round(target) };
    }
    case "toc": {
      let t = await visibleTarget(page, ".toc-link", op.r);
      if (!t) {
        const toggle = await visibleTarget(page, ".toc-mobile-toggle, .toc-toggle", 0);
        if (!toggle) return { skipped: "no toc" };
        await page.mouse.click(toggle.x, toggle.y);
        await page.waitForTimeout(100);
        t = await visibleTarget(page, ".toc-link", op.r);
        if (!t) return { skipped: "toc closed" };
      }
      await page.mouse.click(t.x, t.y);
      return { text: t.text };
    }
    case "eqref": case "details": case "copy": {
      const selector = { eqref: 'a[href^="#mjx-eqn"]', details: "summary", copy: ".code-copy-button" }[op.type];
      const t = await visibleTarget(page, selector, op.r);
      if (!t) return { skipped: "none visible" };
      const before = await deferState(page);
      await page.mouse.click(t.x, t.y);
      return { text: t.text, before, after: await deferState(page) };
    }
    case "toggle": {
      const t = await visibleTarget(page, ".cl-toggle", 0);
      if (!t) return { skipped: "no toggle" };
      await page.mouse.click(t.x, t.y);
      return {};
    }
    case "resize": ctx.physical = op.viewport; await applyMetrics(page, ctx); return {};
    case "zoom": ctx.zoom = op.zoom; await applyMetrics(page, ctx); return {};
    case "reload": {
      ctx.beforeReload = await position(page);
      await page.reload({ waitUntil: "commit" }).catch((e) => ctx.notes.push(String(e)));
      return {};
    }
    case "back": await page.evaluate(() => history.back()).catch(() => {}); return {};
    case "forward": await page.evaluate(() => history.forward()).catch(() => {}); return {};
    case "close": {
      if (await isArticle(page)) {
        ctx.closedSlug = await page.evaluate(() => location.pathname.split("/").filter(Boolean).pop());
        const t = await visibleTarget(page, ".cl-close", 0);
        if (!t) return { skipped: "no close" };
        await page.mouse.click(t.x, t.y);
        return { slug: ctx.closedSlug };
      }
      const t = await visibleTarget(page, "a.site-article-index, .article-index-shell a[href]", op.r);
      if (!t) return { skipped: "no card" };
      await page.mouse.click(t.x, t.y);
      return { opened: t.text };
    }
    case "direct": {
      const suffix = `${op.columns ? `?columns=${op.columns}` : ""}`;
      let url = new URL(`${op.slug}/${suffix}`, BASE).href;
      if (op.hash) {
        // A heading id of that article, read from the built page.
        const html = await (await fetch(url)).text();
        const ids = [...html.matchAll(/<h[23][^>]* id="([^"]+)"/g)].map((m) => m[1]);
        if (ids.length) url += `#${ids[Math.floor(op.r * ids.length)]}`;
      }
      await page.goto(url, { waitUntil: "commit" }).catch((e) => ctx.notes.push(String(e)));
      return { url };
    }
    case "print": {
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(200);
      await page.emulateMedia({ media: "screen" });
      return {};
    }
    case "touch": {
      if (!ctx.cdp) return { skipped: "no cdp" };
      await ctx.cdp.send("Input.synthesizeScrollGesture", {
        x: Math.round(cx), y: Math.round(cy), xDistance: op.dx, yDistance: -op.dy,
        gestureSourceType: "touch", speed: op.speed,
      }).catch((e) => ctx.notes.push(`touch: ${e.message}`));
      return {};
    }
    case "wait": await page.waitForTimeout(op.ms); return {};
  }
}

function deferState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      article: root.dataset.pageKind === "article",
      ready: root.classList.contains("cl-ready") && !root.classList.contains("cl-pending"),
      deferred: Boolean(document.querySelector(".cl-source [data-cl-defer]")),
    };
  }).catch(() => null);
}

async function position(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    if (root.dataset.pageKind !== "article") return { list: true, key: history.state?.dispositifReadingKey };
    const multi = !document.querySelector(".cl-reader")?.hidden;
    const plane = document.querySelector(".cl-plane");
    const sp = document.querySelector(".cl-article-scrollport");
    return {
      path: location.pathname, key: history.state?.dispositifReadingKey, multi,
      w: innerWidth, h: innerHeight, zoom: devicePixelRatio,
      open: [...document.querySelectorAll(".cl-source details")].map((d) => d.open).join(""),
      x: multi ? Number(plane?.dataset.clXTicks) : null,
      y: multi ? Number(plane?.dataset.clYTicks) : null,
      top: multi ? null : sp?.scrollTop,
    };
  }).catch(() => null);
}

// Settled: the page's state has held for 300 ms on one URL. A navigation from
// the list starts on the list page, so a single true poll is not enough.
async function settle(page) {
  let ok = false, streak = 0, last = "";
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const snap = await page.evaluate(() => {
      const root = document.documentElement;
      const article = root.dataset.pageKind === "article";
      const done = document.readyState !== "loading" && (!article || (root.classList.contains("cl-ready")
        && !root.classList.contains("cl-pending") && !document.querySelector(".cl-source [data-cl-defer]")
        && !document.querySelector("[data-cl-animating]")));
      return { key: `${location.href}|${root.dataset.pageKind}`, done };
    }).catch(() => ({ key: "", done: false }));
    streak = snap.done && snap.key === last ? streak + 1 : 0;
    last = snap.key;
    if (streak >= 6) { ok = true; break; }
    await page.waitForTimeout(50);
  }
  await page.evaluate(async () => { for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame); }).catch(() => {});
  await page.waitForTimeout(60);
  await page.evaluate(async () => { for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame); }).catch(() => {});
  return ok;
}

// ---- invariants ----
async function check(page, ctx) {
  const problems = [];
  const state = await page.evaluate(() => {
    const out = {};
    const root = document.documentElement;
    out.kind = root.dataset.pageKind;
    out.overflow = root.scrollWidth - root.clientWidth;
    out.width = innerWidth;
    const active = document.activeElement;
    out.focus = active && active !== document.body ? {
      tag: active.tagName, cls: active.className?.baseVal ?? active.className,
      hidden: Boolean(active.closest('[aria-hidden="true"]')), inert: Boolean(active.closest("[inert]")),
      copy: Boolean(active.closest(".cl-content") && !active.closest(".cl-source")),
      href: active.getAttribute?.("href"),
    } : null;
    const shell = document.querySelector(".article-index-shell");
    out.index = shell ? { inert: shell.inert, hidden: shell.getAttribute("aria-hidden") } : null;
    if (out.kind !== "article") return out;
    const source = document.querySelector(".cl-source");
    out.hiddenBlocks = [...(source?.querySelector(":scope > .post")?.children ?? [])]
      .filter((b) => getComputedStyle(b).display === "none").length;
    out.deferred = Boolean(source?.querySelector("[data-cl-defer]"));
    out.multi = !document.querySelector(".cl-reader")?.hidden;
    if (!out.multi) return out;

    const v = document.querySelector(".cl-viewport"), plane = document.querySelector(".cl-plane");
    const num = (n) => parseFloat(plane.style.getPropertyValue(`--cl-${n}`));
    const p = num("p"), h = num("h"), l = num("l"), leading = Number(plane.dataset.clLeading);
    const x = Number(plane.dataset.clXTicks) / 1024, y = Number(plane.dataset.clYTicks) / 1024;
    out.coords = {
      x, y, p, h, l,
      projectedX: v.scrollLeft + Number(plane.dataset.clOriginColumn) * p - leading,
      projectedY: v.scrollTop + Number(plane.dataset.clOriginY),
    };
    const vr = v.getBoundingClientRect();
    const zoom = vr.width / v.offsetWidth;
    const textOf = (el) => {
      let s = "";
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest("button, script, style, .code-copy-button")) continue;
        s += n.data;
      }
      return s.replace(/\s+/g, " ").trim();
    };
    // Source blocks, as column-fragments.ts measures them.
    const sb = source.getBoundingClientRect();
    const blocks = [];
    const visit = (parent) => {
      for (const el of parent.children) {
        if (el.matches("script, style") || getComputedStyle(el).display === "none") continue;
        const loose = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (el.classList.contains("post") && !loose) { visit(el); continue; }
        const r = el.getBoundingClientRect();
        blocks.push({ el, top: (r.top - sb.top) / zoom, bottom: (r.bottom - sb.top) / zoom, height: r.height / zoom, tag: el.tagName });
      }
    };
    visit(source);
    out.slots = [];
    const viewW = vr.left + v.clientWidth * zoom;
    for (const slot of document.querySelectorAll(".cl-slot")) {
      const k = Number(slot.dataset.clK);
      const frame = slot.getBoundingClientRect();
      const content = slot.firstElementChild;
      const paper = slot.querySelector(".cl-paper").getBoundingClientRect();
      const clipped = getComputedStyle(slot.parentElement).clipPath === "inset(50%)";
      const paperTop = Math.max(paper.top, frame.top), paperBottom = Math.min(paper.bottom, frame.bottom);
      const paperHeight = clipped ? 0 : Math.max(0, paperBottom - paperTop) / zoom;
      const visibleW = Math.min(frame.right, viewW) - Math.max(frame.left, vr.left);
      const cr = content.getBoundingClientRect();
      const info = { k, original: content === source, paperHeight: Math.round(paperHeight), visibleW: Math.round(visibleW / zoom),
        shift: (frame.top - cr.top) / zoom - (k * h + y) };
      out.slots.push(info);
      if (visibleW <= 8 * zoom || paperHeight <= 1 || content === source) continue;
      // Every source block in the visible part of this window must be in the copy, at the same place.
      const from = (paperTop - cr.top) / zoom, to = (paperBottom - cr.top) / zoom;
      const copies = [...content.querySelectorAll("*")].filter((el) => el.style.position === "absolute" && !(el.classList.contains("post") && el.children.length && el.parentElement === content && false));
      const missing = [];
      for (const b of blocks) {
        if (b.bottom <= from + 1 || b.top >= to - 1) continue;
        const text = textOf(b.el);
        const match = copies.find((c) => {
          if (c.tagName !== b.tag) return false;
          const r = c.getBoundingClientRect();
          return Math.abs((r.top - cr.top) / zoom - b.top) < 1.5 && Math.abs(r.height / zoom - b.height) < 1.5 && textOf(c) === text;
        });
        if (!match) {
          const sameText = copies.find((c) => c.tagName === b.tag && textOf(c) === text);
          missing.push({ tag: b.tag, top: Math.round(b.top), height: Math.round(b.height), text: text.slice(0, 40),
            found: sameText ? { top: Math.round((sameText.getBoundingClientRect().top - cr.top) / zoom), height: Math.round(sameText.getBoundingClientRect().height / zoom) } : null });
        }
      }
      if (missing.length) info.missing = missing.slice(0, 4);
      info.range = [Math.round(from), Math.round(to)];
    }
    out.viewport = { left: vr.left, width: v.clientWidth * zoom, zoom };
    return out;
  }).catch((e) => ({ error: String(e) }));

  if (state.error) { problems.push({ inv: "evaluate", detail: state.error }); return { problems, state }; }
  if (state.overflow > 1 && state.width >= 320) problems.push({ inv: "2-overflow", detail: state.overflow });
  if (state.focus && (state.focus.hidden || state.focus.inert || state.focus.copy)) problems.push({ inv: "6-focus", detail: state.focus });
  if (state.kind === "article") {
    if (state.deferred || state.hiddenBlocks) problems.push({ inv: "5-deferred", detail: { deferred: state.deferred, hidden: state.hiddenBlocks } });
    if (state.index && (!state.index.inert || state.index.hidden !== "true")) problems.push({ inv: "8-index-inert", detail: state.index });
    if (state.multi) {
      const c = state.coords;
      if (Math.abs(c.x - c.projectedX) > 1 / 1024 + 1e-9 || Math.abs(c.y - c.projectedY) > 1 / 1024 + 1e-9)
        problems.push({ inv: "4-native", detail: c });
      for (const s of state.slots) {
        if (s.paperHeight > 1 && s.visibleW > 8 && Math.abs(s.shift) > 1.5) problems.push({ inv: "3-shift", detail: s });
        if (s.missing) problems.push({ inv: "3-missing", detail: s });
      }
      const columns = Math.ceil(c.l / c.h);
      const visible = state.slots.filter((s) => s.visibleW > 8);
      // With one column on screen, a vertical move may leave it blank (docs/column-layout.md).
      if (state.viewport.width / state.viewport.zoom >= 2 * c.p && !visible.some((s) => s.paperHeight > 1)) problems.push({ inv: "4-blank-screen", detail: { coords: c, slots: state.slots } });
      if (columns * c.p > state.viewport.width / state.viewport.zoom + c.p) {
        const blankFull = visible.filter((s) => s.paperHeight <= 1 && s.visibleW >= c.p * 0.5);
        if (blankFull.length > 1) problems.push({ inv: "4-blank-columns", detail: { coords: c, slots: state.slots } });
      }
    }
  } else if (state.index && (state.index.inert || state.index.hidden === "true")) {
    problems.push({ inv: "8-index-inert-on-list", detail: state.index });
  }
  return { problems, state };
}

// ---- run ----
async function run({ engine, article, mode, seed, bursts, plan, skip = new Set(), outDir, viewport, zoom, label }) {
  const browserType = engine === "firefox" ? firefox : chromium;
  const browser = await browserType.launch({ executablePath: engine === "chromium" ? process.env.TEST_BROWSER_PATH || undefined : undefined });
  const context = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] }, hasTouch: false });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await context.addInitScript((mode) => { try { if (!localStorage.getItem("monkey-init")) { localStorage.setItem("dispositif:columns", mode); localStorage.setItem("monkey-init", "1"); } } catch {} }, mode);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  const ctx = { notes: [], zoom, physical: viewport, cdp: engine === "chromium" ? await context.newCDPSession(page) : null };
  const log = [];
  const failures = [];
  const t0 = Date.now();
  const leaving = new Map();
  try {
    await page.goto(BASE);
    await page.goto(new URL(`${article}/`, BASE).href);
    await settle(page);
    if (zoom !== 1) { await applyMetrics(page, ctx); await settle(page); }
    for (let b = 0; b < plan.length; b++) {
      if (skip.has(b)) continue;
      const burst = plan[b];
      const entries = [];
      const before = await position(page);
      for (const [i, op] of burst.entries()) {
        // The position an entry is left at is known only right after settling;
        // later in a burst a load or a smooth scroll may still be going on.
        const pos = await position(page);
        if (pos?.key) { if (i === 0) leaving.set(pos.key, pos); else leaving.delete(pos.key); }
        let result;
        try { result = await perform(page, op, ctx); } catch (e) { result = { error: String(e).slice(0, 200) }; }
        entries.push({ op, result });
        // Immediate check: key and pointer input show all the text first.
        if (result?.before?.article && result.before.ready && result.after?.article && result.after.deferred
          && (op.type === "key" || op.type === "click" || op.type === "details" || op.type === "eqref")) {
          failures.push({ burst: b, inv: "5b-input-shows-all", detail: { op, result } });
        }
        if (op.gap) await page.waitForTimeout(op.gap);
      }
      const settled = await settle(page);
      const { problems, state } = await check(page, ctx);
      if (!settled) problems.push({ inv: "settle-timeout", detail: await deferState(page) });
      const after = await position(page);
      // 7: reload restores the position, when nothing else in the burst moved it.
      const reloadOnly = burst.length === 1 && burst[0].type === "reload";
      if (reloadOnly && ctx.beforeReload && after && same(ctx.beforeReload, after) && !close(ctx.beforeReload, after))
        problems.push({ inv: "7-reload-position", detail: { before: ctx.beforeReload, after } });
      // 7: back/forward return to an entry's position, when the burst was only that move.
      if (burst.length === 1 && ["back", "forward"].includes(burst[0].type) && after?.key && leaving.has(after.key)) {
        const left = leaving.get(after.key);
        if (same(left, after) && !close(left, after)) problems.push({ inv: "7-history-position", detail: { left, after } });
      }
      // 8: closing returns focus to the article's card.
      if (burst.length === 1 && burst[0].type === "close" && ctx.closedSlug && state.kind !== "article") {
        if (!state.focus?.href?.includes(ctx.closedSlug)) problems.push({ inv: "8-focus-card", detail: { slug: ctx.closedSlug, focus: state.focus } });
      }
      const checked = {
        copies: (state.slots ?? []).filter((s) => s.range).length,
        reload: Boolean(reloadOnly && ctx.beforeReload && after && same(ctx.beforeReload, after)),
        history: Boolean(burst.length === 1 && ["back", "forward"].includes(burst[0].type) && after?.key && leaving.has(after.key) && same(leaving.get(after.key), after)),
        card: Boolean(burst.length === 1 && burst[0].type === "close" && ctx.closedSlug && state.kind !== "article"),
        immediate: entries.filter((e) => e.result?.before?.article && e.result.before.ready && e.result.before.deferred).length,
      };
      ctx.closedSlug = undefined; ctx.beforeReload = undefined;
      // The browsers abort a view transition when the viewport changes or the
      // document is hidden during it.
      const vt = /Transition was aborted|Skipped (view transition|ViewTransition)/i;
      const aborted = errors.filter((e) => vt.test(e));
      if (aborted.length) ctx.notes.push(...aborted);
      const real = errors.splice(0).filter((e) => !vt.test(e));
      if (real.length) problems.push({ inv: "1-errors", detail: real });
      for (const p of problems) failures.push({ burst: b, ...p });
      log.push({ burst: b, entries, before, after, checked, problems: problems.map((p) => p.inv), notes: ctx.notes.splice(0) });
      if (problems.length && outDir) {
        await page.screenshot({ path: join(outDir, `${label}-b${b}.png`) }).catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
  return { failures, log, seconds: Math.round((Date.now() - t0) / 1000) };
}

const same = (a, b) => !a.list && !b.list && a.path === b.path && a.multi === b.multi && a.w === b.w && a.h === b.h && a.zoom === b.zoom && a.open === b.open;
const close = (a, b) => a.multi ? Math.abs(a.x - b.x) <= 2048 && Math.abs(a.y - b.y) <= 2048 : Math.abs(a.top - b.top) <= 2;

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "run") {
  const [engine, article, mode, seedText, burstsText, outDir = "."] = args;
  const seed = Number(seedText), bursts = Number(burstsText);
  const mixed = seed ^ [...`${article}${mode}`].reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 7);
  const rng = mulberry32(mixed ^ 0x9e3779b9);
  const viewport = VIEWPORTS[Math.floor(rng() * VIEWPORTS.length)];
  const zoom = rng() < 0.7 ? 1 : ZOOMS[1 + Math.floor(rng() * 2)];
  const plan = generate(mixed, bursts, engine);
  const label = `${engine}-${article}-${mode}-${seed}`;
  mkdirSync(outDir, { recursive: true });
  const result = await run({ engine, article, mode, seed, bursts, plan, outDir, viewport, zoom, label });
  const record = { engine, article, mode, seed, viewport, zoom, plan, ...result };
  writeFileSync(join(outDir, `${label}.json`), JSON.stringify(record, null, 1));
  const kinds = {};
  for (const f of result.failures) kinds[f.inv] = (kinds[f.inv] ?? 0) + 1;
  console.log(JSON.stringify({ label, viewport, zoom, seconds: result.seconds, failures: kinds }));
} else if (cmd === "selftest") {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("dispositif:columns", "multi"));
  const page = await context.newPage();
  await page.goto(new URL("symmetric-polynomial/", BASE).href);
  await settle(page);
  await page.mouse.move(700, 500); await page.mouse.wheel(0, 3000); await settle(page);
  const show = (label, r) => console.log(label, JSON.stringify(r.problems.map((p) => p.inv)), JSON.stringify(r.state.slots?.map((s) => [s.k, s.original, s.visibleW, s.paperHeight, s.range, s.missing?.length, Math.round(s.shift * 100) / 100])));
  show("clean", await check(page, {}));
  const copySlot = () => [...document.querySelectorAll(".cl-slot")].find((s) => s.firstElementChild !== document.querySelector(".cl-source") && s.getBoundingClientRect().left > 0 && s.getBoundingClientRect().left < innerWidth - 100);
  await page.evaluate(`(${copySlot})()`).then(() => {});
  await page.evaluate((f) => {
    const slot = eval(f)();
    const blocks = [...slot.firstElementChild.querySelectorAll("*")].filter((e) => e.style.position === "absolute" && !e.classList.contains("post"));
    blocks[Math.floor(blocks.length / 2)].remove();
  }, `(${copySlot})`);
  show("removed block", await check(page, {}));
  await page.evaluate((f) => {
    const c = eval(f)().firstElementChild;
    const [x, y = 0] = c.style.translate.split(/\s+/).map(parseFloat);
    c.style.translate = `${x}px ${y - 40}px`;
  }, `(${copySlot})`);
  show("shifted copy", await check(page, {}));
  await page.evaluate(() => { const p = document.querySelector(".cl-plane"); p.dataset.clYTicks = String(Number(p.dataset.clYTicks) + 5000); });
  show("desynced", await check(page, {}));
  await browser.close();
} else if (cmd === "replay") {
  const [file, skipText = "", only] = args;
  const rec = JSON.parse(readFileSync(file, "utf8"));
  const skip = new Set(skipText ? skipText.split(",").map(Number) : []);
  const result = await run({ ...rec, skip, outDir: null, label: "replay" });
  const kinds = {};
  for (const f of result.failures) kinds[f.inv] = (kinds[f.inv] ?? 0) + 1;
  console.log(JSON.stringify({ failures: kinds, first: result.failures.slice(0, 3) }, null, 1));
}
