// Same-document offscreen measurement probe; not used by the application.
// Run against the development server, which exposes the TypeScript module.
import { chromium, firefox } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const slug = process.env.RM_ARTICLE ?? 'symmetric-polynomial';
const fragmentModule = process.env.RM_FRAGMENT_MODULE ?? 'scripts/experiments/reading-fragment-snapshot.ts';
const viewportSize = { width: Number(process.env.RM_WIDTH ?? 1440), height: Number(process.env.RM_HEIGHT ?? 900) };
const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4322/dispositif/';
function usage() {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,cputimes='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const descendants = new Set([process.pid]); let previous;
  do { previous = descendants.size; for (const [pid, parent] of rows) if (descendants.has(parent)) descendants.add(pid); } while (previous !== descendants.size);
  return rows.filter(([pid]) => pid !== process.pid && descendants.has(pid)).reduce((total, row) => {
    try {
      const rollup = readFileSync(`/proc/${row[0]}/smaps_rollup`, 'utf8');
      total.pss += Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1] ?? 0);
      const stat = readFileSync(`/proc/${row[0]}/stat`, 'utf8').split(') ')[1].split(' ');
      total.ticks += Number(stat[11]) + Number(stat[12]);
    } catch { /* A process may exit between ps and /proc. */ }
    total.rss += row[2];
    return total;
  }, {rss: 0, pss: 0, ticks: 0});
}
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: viewportSize, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
    const page = await context.newPage();
    await page.goto(base);
    const before = usage();
    const prepared = await page.evaluate(async ({ base, slug, fragmentModule }) => {
      const started = performance.now();
      const html = await (await fetch(new URL(`${slug}/`, base))).text();
      const fetched = performance.now();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const styles = [...parsed.head.querySelectorAll('style')].map(style => {
        const element = document.createElement('style'); element.textContent = style.textContent; document.head.append(element); return element;
      });
      const box = document.createElement('div');
      box.className = 'rm-active rm-ready';
      box.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;transform:translateX(-200vw);visibility:hidden;pointer-events:none;contain:layout paint;';
      const header = parsed.querySelector('[data-site-header]');
      const port = parsed.querySelector('.rm-article-scrollport');
      box.append(header, port); document.body.append(box);
      const toolbar = box.querySelector('.rm-toolbar');
      header.append(toolbar);
      header.style.position = 'fixed';
      box.querySelector('.rm-reader').hidden = false;
      box.style.setProperty('--rm-header-height', `${header.getBoundingClientRect().height}px`);
      const viewport = box.querySelector('.rm-viewport');
      const source = box.querySelector('.rm-source');
      const probe = document.createElement('div');
      probe.className = 'rm-ruler'; box.append(probe);
      const edge = parseFloat(getComputedStyle(probe).paddingRight);
      const width = Math.min(parseFloat(getComputedStyle(probe).width), Math.max(1, viewport.clientWidth - 2 * edge));
      source.style.width = `${width}px`;
      source.querySelectorAll('img').forEach(img => img.loading = 'eager');
      source.getBoundingClientRect();
      const laidOut = performance.now();
      await document.fonts.ready;
      const { ReadingFragments } = await import(new URL(fragmentModule, base).href);
      const fragments = new ReadingFragments(source);
      const start = performance.now();
      fragments.measure(true);
      const snapshot = fragments.snapshot();
      const rect = source.getBoundingClientRect();
      const fragmentStart = performance.now();
      const rendered = [0, viewport.clientHeight, 2 * viewport.clientHeight].map(offset => {
        const content = fragments.createContent();
        fragments.render(content, offset, viewport.clientHeight, rect.height);
        return content.outerHTML;
      });
      const renderMs = performance.now() - fragmentStart;
      const result = { snapshot, rendered, renderMs, fetchMs: fetched - started, firstLayoutMs: laidOut - fetched, width, length: rect.height, viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight,
        measureMs: performance.now() - start, totalMs: performance.now() - started };
      window.cleanupReadingProbe = () => { box.remove(); styles.forEach(style => style.remove()); };
      return result;
    }, { base, slug, fragmentModule });
    const retained = usage();
    await page.evaluate(() => window.cleanupReadingProbe());
    const target = await context.newPage();
    await target.goto(new URL(`${slug}/`, base).href);
    await target.waitForSelector('.rm-slot');
    await target.evaluate(() => document.fonts.ready);
    await target.waitForTimeout(150);
    const actual = await target.evaluate(async ({ base, fragmentModule, snapshot, rendered }) => {
      const { ReadingFragments } = await import(new URL(fragmentModule, base).href);
      const source = document.querySelector('.rm-source');
      const fragments = new ReadingFragments(source); fragments.measure(true);
      const expected = fragments.snapshot();
      const boxDelta = Math.max(...expected.boxes.flatMap((entry, i) => Object.keys(entry.box).map(key => Math.abs(entry.box[key] - (snapshot.boxes[i]?.box[key] ?? Infinity)))));
      const compare = (html) => {
        const div = document.createElement('div'); div.innerHTML = html;
        div.querySelectorAll('.code-copy-button, .details-close-button').forEach(el => el.remove());
        return div.innerHTML;
      };
      const length = source.getBoundingClientRect().height;
      const height = document.querySelector('.rm-viewport').clientHeight;
      const visible = [0, height, 2 * height].map(offset => {
        const content = fragments.createContent();
        fragments.render(content, offset, document.querySelector('.rm-viewport').clientHeight, length);
        return content.outerHTML;
      });
      const sameFragments = visible.map((html, i) => compare(html) === compare(rendered[i]));
      return { boxDelta, sameFragments, exactFragments: visible.map((html, i) => html === rendered[i]), length: source.getBoundingClientRect().height, width: parseFloat(source.style.width), viewportWidth: document.querySelector('.rm-viewport').clientWidth, viewportHeight: document.querySelector('.rm-viewport').clientHeight,
        accepted: new ReadingFragments(source).restore(snapshot), boxes: expected.boxes.length, preparedBoxes: snapshot.boxes.length };
    }, { base, fragmentModule, snapshot: prepared.snapshot, rendered: prepared.rendered });
    const { snapshot, rendered, ...summary } = prepared;
    console.log(name, JSON.stringify({ slug, prepared: summary, rssDifferenceKiB: retained.rss - before.rss, pssDifferenceKiB: retained.pss - before.pss, cpuTicksDifference: retained.ticks - before.ticks, actual }));
    await context.close();
  } finally { await browser.close(); }
}
