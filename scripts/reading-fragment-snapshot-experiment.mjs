// Run against `astro dev --background --host 127.0.0.1`.
// This exercises a geometry transfer; it is not yet wired into navigation.
import { chromium, firefox } from 'playwright-core';
import assert from 'node:assert/strict';

const base = process.env.RM_BASE_URL ?? 'http://127.0.0.1:4322/dispositif/';
for (const [name, engine] of Object.entries({ chromium, firefox })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('dispositif:reading-mode', 'multi'));
    const prepare = async () => {
      const page = await context.newPage();
      await page.goto(new URL('symmetric-polynomial/', base).href);
      await page.waitForSelector('.rm-slot');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      return page;
    };
    const source = await prepare();
    const measured = await source.evaluate(async (base) => {
      const { ReadingFragments } = await import(new URL('scripts/experiments/reading-fragment-snapshot.ts', base).href);
      const fragments = new ReadingFragments(document.querySelector('.rm-source'));
      const start = performance.now();
      fragments.measure(true);
      const measured = performance.now();
      const snapshot = fragments.snapshot();
      return { snapshot, measureMs: measured - start, serializeMs: performance.now() - measured };
    }, base);
    const destination = await prepare();
    const result = await destination.evaluate(async ({ base, snapshot }) => {
      const { ReadingFragments } = await import(new URL('scripts/experiments/reading-fragment-snapshot.ts', base).href);
      const source = document.querySelector('.rm-source');
      const fresh = new ReadingFragments(source);
      const start = performance.now();
      fresh.measure(true);
      const measureMs = performance.now() - start;
      const restored = new ReadingFragments(source);
      const restoreStart = performance.now();
      const accepted = restored.restore(snapshot);
      const restoreMs = performance.now() - restoreStart;
      const expected = fresh.snapshot();
      const actual = restored.snapshot();
      const boxDelta = Math.max(...expected.boxes.flatMap((entry, i) =>
        Object.keys(entry.box).map((key) => Math.abs(entry.box[key] - actual.boxes[i].box[key]))));
      const length = source.getBoundingClientRect().height;
      const render = (fragments, from) => {
        const content = fragments.createContent();
        fragments.render(content, from, 800, length);
        return content.outerHTML;
      };
      const sameRendering = [0, 800, 1600, 3200, 6400].every((from) => render(fresh, from) === render(restored, from));
      // Invalidate source layout first, then include the layout that a reader
      // actually needs. Restoring numbers alone does not lay out the original.
      const originalWidth = source.style.width;
      const invalidate = () => {
        source.style.width = `${parseFloat(originalWidth) + 1}px`;
        source.getBoundingClientRect();
        source.style.width = originalWidth;
      };
      invalidate();
      const coldStart = performance.now();
      new ReadingFragments(source).measure(true);
      const coldMeasureMs = performance.now() - coldStart;
      invalidate();
      const coldRestoreStart = performance.now();
      new ReadingFragments(source).restore(snapshot);
      source.getBoundingClientRect();
      const coldRestoreAndLayoutMs = performance.now() - coldRestoreStart;
      const added = document.createElement('i');
      source.insertBefore(added, source.firstChild);
      const rejectedChangedTree = !new ReadingFragments(source).restore(snapshot);
      added.remove();
      return { accepted, boxDelta, sameRendering, rejectedChangedTree, measureMs, restoreMs, coldMeasureMs, coldRestoreAndLayoutMs, bytes: JSON.stringify(snapshot).length, blocks: snapshot.blocks.length };
    }, { base, snapshot: measured.snapshot });
    console.log(name, JSON.stringify({ preloadMeasureMs: measured.measureMs, serializeMs: measured.serializeMs, ...result }));
    assert.equal(result.accepted, true);
    assert.ok(result.boxDelta < 0.01, `geometry differs by ${result.boxDelta}px`);
    assert.equal(result.sameRendering, true);
    assert.equal(result.rejectedChangedTree, true);
    await context.close();
  } finally { await browser.close(); }
}
