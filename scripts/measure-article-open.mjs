// Measure the time from clicking an article on the index to the article being
// visible, split at Astro's navigation events, with the resources fetched after
// the click. Chromium also records a trace and reports main-thread self time
// per category (style, layout, paint, script, parse, GC) for each span.
//
// Conditions: tips-python (no math) and symmetric-polynomial (math), single and
// multi, "cold" (fresh context) and "warm" (another article with the same kind
// of content opened first), 1440x900, 300 ms hover before the click.
//
// NAV=direct measures a direct load instead (address bar, reload): from the
// navigation start to the article being visible, with the same criterion.
// "cold" is a fresh context; "warm" loads the other article first, directly.
//
// Usage (against a production build served by `astro preview`):
//   node scripts/measure-article-open.mjs http://localhost:4321/dispositif/ 3 > out.jsonl
// Browser warm-up: after launching each browser, a math article (tips-julia)
// is opened once in a throwaway context, closed before any measured context.
// Firefox rebuilds its system font list once per browser session, triggered by
// the first math page (PContent::Msg_RebuildFontList); without the warm-up this
// adds ~90 ms at a variable time to the first measured "cold" runs. It is not a
// site cost. WARMUP=0 disables it.
//
// Environment: ENGINES=chromium,firefox  ARTICLES=…  MODES=…  CACHES=…  NAV=click|direct  WARMUP=0
// TRACE=0 (disable the Chromium trace; tracing adds overhead, so compare
// wall-clock times with TRACE=0).
// "visible" is when rm-pending is removed, inside the reader's first frame;
// "painted" is the first task after that frame, so visible→painted holds the
// style, layout and paint of the first frame that shows the article.
import { chromium, firefox } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4321/dispositif/';
const runs = Number(process.argv[3] ?? 3);
const only = (name, all) => process.env[name] ? all.filter((value) => process.env[name].split(',').includes(value)) : all;
const articles = only('ARTICLES', ['tips-python', 'symmetric-polynomial']);
const modes = only('MODES', ['single', 'multi']);
const caches = only('CACHES', ['cold', 'warm']);
const engines = Object.entries({ chromium, firefox }).filter(([n]) => !process.env.ENGINES || process.env.ENGINES.split(',').includes(n));
const direct = process.env.NAV === 'direct';

const probe = () => {
  const t = (name) => {
    const times = (window.rmT ??= {});
    if (times[name] !== undefined) return;
    times[name] = performance.now();
    if (window.rmTracing) performance.mark(`rm:${name}`);
  };
  window.rmMark = t;
  for (const e of ['astro:before-preparation', 'astro:after-preparation', 'astro:before-swap', 'astro:after-swap', 'astro:page-load']) {
    document.addEventListener(e, () => t(e.slice(6)));
  }
  window.rmFonts = [];
  document.fonts.addEventListener('loadingdone', (e) => window.rmFonts.push([performance.now(), e.fontfaces.map(f => f.family).join(',')]));
  const observe = () => new MutationObserver(() => {
    const c = document.documentElement.classList;
    if (c.contains('rm-pending')) t('pending');
    if (c.contains('rm-ready')) t('ready');
    if (window.rmT?.pending && !c.contains('rm-pending') && c.contains('rm-ready') && window.rmT.visible === undefined) {
      t('visible');
      // rm-pending is removed in the reader's first animation frame; a task
      // posted now runs after that frame's style, layout and paint.
      const channel = new MessageChannel();
      channel.port1.onmessage = () => t('painted');
      channel.port2.postMessage(null);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  observe();
  window.rmLoaf = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.rmLoaf.push({
        start: e.startTime, duration: e.duration, blocking: e.blockingDuration,
        render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
        styleLayout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
        scripts: e.scripts.map(s => ({ fn: s.sourceFunctionName, url: s.sourceURL.split('/').pop(), dur: s.duration, forced: s.forcedStyleAndLayoutDuration, invoker: s.invoker })),
      });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* Firefox has no LoAF */ }
};

// Self time per category on the renderer main thread, split at the rm:* marks.
const CATEGORY = [
  [/^(ParseHTML)$/, 'parse'],
  [/^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|ScheduleStyleRecalculation)$/, 'style'],
  [/^(Layout)$/, 'layout'],
  [/^(Paint|PrePaint|Layerize|UpdateLayer|UpdateLayerTree|CompositeLayers|Commit|RasterTask|PaintImage|Decode.*)$/, 'paint'],
  [/(GC|gc|Scavenge|MarkCompact)/, 'gc'],
  [/^(FunctionCall|EvaluateScript|v8\.|V8\.|TimerFire|EventDispatch|FireAnimationFrame|RunMicrotasks|v8\.compile|v8\.run|CompileScript|CompileCode|v8\.callFunction)/, 'script'],
];
const categorize = (name) => CATEGORY.find(([re]) => re.test(name))?.[1] ?? 'other';
function summarizeTrace(json) {
  const events = json.traceEvents ?? json;
  const main = events.find(e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain'
    && events.some(m => m.pid === e.pid && m.name?.startsWith?.('rm:')));
  if (!main) return { error: 'no main thread' };
  const marks = Object.fromEntries(events.filter(e => e.pid === main.pid && e.name?.startsWith?.('rm:') && e.ph !== 'e')
    .map(e => [e.name.slice(3), e.ts]));
  // The direct load's document starts at its navigationStart mark (the last one).
  const navigation = events.filter(e => e.pid === main.pid && e.name === 'navigationStart').at(-1);
  if (navigation) marks.navigation = navigation.ts;
  const order = (marks.click !== undefined ? ['click', 'after-swap', 'page-load', 'visible', 'painted'] : ['navigation', 'ready', 'visible', 'painted'])
    .filter(k => marks[k] !== undefined);
  const spans = order.slice(1).map((k, i) => [`${order[i]}→${k}`, marks[order[i]], marks[k]]);
  const xs = events.filter(e => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && e.dur)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  // The rest of the trace (500 ms after visible): work the opening still
  // causes after the first frame, such as the end of the view transition.
  if (marks.painted !== undefined) spans.push(['painted→end', marks.painted, Math.max(...xs.map(e => e.ts + e.dur))]);
  // Self time: subtract direct children.
  const self = new Map();
  const stack = [];
  for (const e of xs) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
    const parent = stack.at(-1);
    if (parent) self.set(parent, (self.get(parent) ?? parent.dur) - Math.min(e.dur, parent.ts + parent.dur - e.ts));
    stack.push(e);
  }
  const result = {};
  for (const [label, from, to] of spans) {
    const bucket = { wall: Math.round((to - from) / 1000) };
    for (const e of xs) {
      const start = Math.max(e.ts, from), end = Math.min(e.ts + e.dur, to);
      if (end <= start) continue;
      const own = (self.get(e) ?? e.dur) * (end - start) / e.dur;
      const cat = categorize(e.name);
      if (cat === 'other' && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask')) { bucket.task = (bucket.task ?? 0) + own / 1000; continue; }
      bucket[cat] = (bucket[cat] ?? 0) + own / 1000;
      if (e.name === 'Layout' && e.dur >= 5000 && e.ts >= from) (bucket.layouts ??= []).push(
        [Math.round(e.dur / 1000), e.args?.beginData?.dirtyObjects ?? null, e.args?.beginData?.totalObjects ?? null]);
      if (cat === 'other') (bucket.otherNames ??= {})[e.name] = ((bucket.otherNames ??= {})[e.name] ?? 0) + own / 1000;
    }
    for (const k of Object.keys(bucket)) if (typeof bucket[k] === 'number') bucket[k] = Math.round(bucket[k]);
    if (bucket.otherNames) bucket.otherNames = Object.fromEntries(Object.entries(bucket.otherNames).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [k, Math.round(v)]));
    result[label] = bucket;
  }
  return result;
}

const out = (row) => process.stdout.write(JSON.stringify(row) + '\n');
for (const [engineName, engine] of engines) {
  const browser = await engine.launch();
  if (process.env.WARMUP !== '0') {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(new URL('tips-julia/', base).href);
    await page.waitForFunction(() => document.documentElement.classList.contains('rm-ready')
      && !document.documentElement.classList.contains('rm-pending'), null, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await context.close();
  }
  for (let run = 0; run < runs; run++) for (const article of articles) for (const mode of modes) for (const cache of caches) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(([mode]) => {
      if (location.protocol !== 'about:') localStorage.setItem('dispositif:reading-mode', mode);
    }, [mode]);
    await context.addInitScript(probe);
    const tracing = engineName === 'chromium' && process.env.TRACE !== '0';
    const page = await context.newPage();
    if (direct) {
      const url = (name) => new URL(`${name}/`, base).href;
      const shown = () => page.waitForFunction(() => window.rmT?.visible, null, { timeout: 30_000 });
      if (cache === 'warm') {
        // The other article of the same kind, loaded directly, primes the HTTP cache.
        await page.goto(url(article === 'tips-python' ? 'tips-wsl' : 'tips-julia'));
        await shown();
        await page.evaluate(() => document.fonts.ready);
      }
      if (tracing) {
        await context.addInitScript(() => { window.rmTracing = true; });
        await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'loading', 'v8', 'disabled-by-default-v8.gc'] });
      }
      await page.goto(url(article));
      await shown();
      await page.waitForTimeout(500);
      const trace = tracing ? summarizeTrace(JSON.parse((await browser.stopTracing()).toString())) : undefined;
      // performance.now() counts from this document's navigation start.
      const data = await page.evaluate(() => {
        const [nav] = performance.getEntriesByType('navigation');
        return { t: window.rmT, fonts: window.rmFonts, loaf: window.rmLoaf,
          nav: nav && { responseEnd: nav.responseEnd, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd },
          resources: performance.getEntriesByType('resource').map(r => ({
            name: r.name.split('/').slice(-2).join('/'), type: r.initiatorType, start: r.startTime, end: r.responseEnd,
            transfer: r.transferSize, body: r.decodedBodySize })) };
      });
      const round = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, Math.round(v)]));
      out({ engine: engineName, nav: 'direct', run, article, mode, cache, rel: round(data.t), navTiming: round(data.nav), trace,
        fonts: data.fonts.map(([t, f]) => [Math.round(t), f]),
        resources: data.resources.map(r => ({ ...r, start: Math.round(r.start), end: Math.round(r.end) })),
        loaf: data.loaf.map(l => ({ ...l, start: Math.round(l.start) })) });
      await context.close();
      continue;
    }
    if (cache === 'warm') {
      // Load another article directly first so shared fonts/CSS/JS are cached.
      const other = article === 'tips-python' ? 'tips-wsl' : 'tips-julia';
      await page.goto(new URL(`${other}/`, base).href);
      await page.waitForFunction(() => document.documentElement.classList.contains('rm-ready') && !document.documentElement.classList.contains('rm-pending'));
      await page.evaluate(() => document.fonts.ready);
    }
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    const link = page.locator(`a[href$="${article}/"]`).first();
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await page.waitForTimeout(300);
    if (tracing) await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'v8', 'disabled-by-default-v8.gc'] });
    const clickAt = await page.evaluate((tracing) => {
      window.rmT = {}; window.rmLoaf = []; window.rmFonts = []; window.rmTracing = tracing;
      performance.clearResourceTimings(); performance.mark('rm:click'); return performance.now();
    }, tracing);
    await link.click();
    await page.waitForFunction(() => window.rmT?.visible, null, { timeout: 30_000 });
    await page.waitForTimeout(500);
    const trace = tracing ? summarizeTrace(JSON.parse((await browser.stopTracing()).toString())) : undefined;
    const data = await page.evaluate((clickAt) => ({
      t: window.rmT, fonts: window.rmFonts, loaf: window.rmLoaf.filter(l => l.start >= clickAt - 5),
      resources: performance.getEntriesByType('resource').map(r => ({
        name: r.name.split('/').slice(-2).join('/'), type: r.initiatorType, start: r.startTime, end: r.responseEnd,
        transfer: r.transferSize, body: r.decodedBodySize })),
    }), clickAt);
    const rel = Object.fromEntries(Object.entries(data.t).map(([k, v]) => [k, Math.round(v - clickAt)]));
    out({ engine: engineName, run, article, mode, cache, rel, trace,
      fonts: data.fonts.map(([t, f]) => [Math.round(t - clickAt), f]),
      resources: data.resources.map(r => ({ ...r, start: Math.round(r.start - clickAt), end: Math.round(r.end - clickAt) })),
      loaf: data.loaf.map(l => ({ ...l, start: Math.round(l.start - clickAt) })) });
    await context.close();
  }
  await browser.close();
}
