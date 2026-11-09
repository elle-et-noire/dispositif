import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

const base = process.env.TEST_BASE_URL ?? 'http://localhost:4321/dispositif/';
const selected = process.env.TEST_ENGINES?.split(',');
const engines = Object.entries({ chromium, firefox }).filter(([name]) => !selected || selected.includes(name));

const mathFontRequests = page => page.evaluate(() => performance.getEntriesByType('resource')
  .map(entry => new URL(entry.name).pathname).filter(path => path.includes('/fonts/mjx/')).sort());

for (const [name, engine] of engines) {
  test(`${name}: hovering an article link loads exactly its math fonts`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
      const page = await context.newPage();
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);
      const familiesBefore = await page.evaluate(() => [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family));

      // An article without math has no list and loads nothing.
      const plain = page.locator('a[href$="tips-python/"]');
      assert.equal(await plain.getAttribute('data-math-fonts'), null);
      await plain.hover();
      await page.waitForTimeout(300);
      assert.deepEqual(await mathFontRequests(page), []);

      // A finger resting on a card (before a scroll) is not a hover.
      const math = page.locator('a[href$="symmetric-polynomial/"]');
      await math.dispatchEvent('pointerover', { pointerType: 'touch', bubbles: true });
      await page.waitForTimeout(300);
      assert.deepEqual(await mathFontRequests(page), [], 'a touch should not prefetch');

      // Passing over a math link for less than the hover delay loads nothing.
      await math.hover();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
      assert.deepEqual(await mathFontRequests(page), [], 'a brief pass should not prefetch');

      const fonts = JSON.parse(await math.getAttribute('data-math-fonts'));
      const expected = fonts.map(([, url]) => new URL(url, base).pathname).sort();
      assert.ok(expected.length > 0 && expected.every(path => path.endsWith('.woff2')));
      assert.ok(fonts.every(([family]) => family.startsWith('MJX-')), JSON.stringify(fonts));
      await math.hover();
      await page.waitForFunction(count => performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('/fonts/mjx/')).length >= count, expected.length);
      await page.waitForTimeout(200);
      assert.deepEqual(await mathFontRequests(page), expected);
      // The loaded faces wait outside the index's font set until a swap.
      assert.deepEqual(await page.evaluate(() => [...document.fonts].filter(face => face.status === 'loaded')
        .map(face => face.family)), familiesBefore);

      // Hovering again or focusing the link does not request the fonts twice.
      await page.mouse.move(2, 2);
      await math.hover();
      await math.focus();
      await page.waitForTimeout(300);
      assert.equal((await mathFontRequests(page)).length, expected.length);

      const clickedAt = await page.evaluate(() => performance.now());
      await math.click();
      await page.waitForFunction(() => document.documentElement.classList.contains('cl-ready')
        && !document.documentElement.classList.contains('cl-pending') && location.pathname.endsWith('/symmetric-polynomial/'));
      assert.equal(await page.evaluate(() => document.querySelectorAll('mjx-container').length > 0), true);
      // The article uses the loaded faces instead of loading its own copies:
      // its @font-face rules and <link rel="preload"> for them are dropped
      // before the swap, so no math font is requested again.
      await page.evaluate(() => document.fonts.ready);
      const reloaded = await page.evaluate(clickedAt => performance.getEntriesByType('resource')
        .filter(entry => entry.startTime >= clickedAt && entry.name.includes('/fonts/mjx/'))
        .map(entry => new URL(entry.name).pathname.split('/').pop()), clickedAt);
      assert.deepEqual(reloaded, []);
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
}

// The article's own @font-face rules for the hovered faces must not load
// after the swap: MathJax's stacks start with the nearly empty MJX-TEX-ZERO,
// so a second face of that name, still unloaded at the first layout, loads
// right after it and lays the whole article out again.
for (const [name, engine] of engines) {
  test(`${name}: after a hover, opening the math article loads no math font again`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
      for (const mode of ['multi', 'single']) {
        const page = await context.newPage();
        await page.addInitScript(mode => localStorage.setItem('dispositif:columns', mode), mode);
        await page.goto(base);
        await page.evaluate(() => document.fonts.ready);
        const math = page.locator('a[href$="symmetric-polynomial/"]');
        const fonts = JSON.parse(await math.getAttribute('data-math-fonts'));
        const families = fonts.map(([family]) => family);
        await math.hover();
        await page.waitForFunction(count => performance.getEntriesByType('resource')
          .filter(entry => entry.name.includes('/fonts/mjx/')).length >= count, fonts.length);
        // Let the hovered faces finish loading (only loaded ones replace the article's).
        await page.waitForTimeout(500);
        const clickedAt = await page.evaluate(() => {
          window.mathFontLoads = [];
          // Firefox's event lists no faces; the resource and face checks below cover it.
          document.fonts.addEventListener('loadingdone', event => window.mathFontLoads
            .push(...(event.fontfaces ?? []).map(face => face.family).filter(family => family.startsWith('MJX-'))));
          return performance.now();
        });
        await math.click();
        await page.waitForFunction(() => document.documentElement.classList.contains('cl-ready')
          && !document.documentElement.classList.contains('cl-pending') && location.pathname.endsWith('/symmetric-polynomial/'));
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const state = await page.evaluate(({ clickedAt, families }) => {
          const context = document.createElement('canvas').getContext('2d');
          const width = (font) => { context.font = font; return context.measureText('\u2211').width; };
          return {
            requested: performance.getEntriesByType('resource')
              .filter(entry => entry.startTime >= clickedAt && entry.name.includes('/fonts/mjx/'))
              .map(entry => new URL(entry.name).pathname.split('/').pop()),
            loads: window.mathFontLoads,
            faces: [...document.fonts].filter(face => families.includes(face.family))
              .map(({ family, status }) => ({ family, status })),
            math: document.querySelectorAll('.cl-article mjx-container').length,
            glyphs: [width('20px MJX-TEX-N, monospace'), width('20px monospace')],
          };
        }, { clickedAt, families });
        const detail = JSON.stringify({ mode, ...state });
        assert.deepEqual(state.requested, [], detail);
        assert.deepEqual(state.loads, [], detail);
        // One loaded face per family: the hovered one, not a second one from the article.
        assert.deepEqual(state.faces.map(face => face.family).sort(), [...families].sort(), detail);
        assert.ok(state.faces.every(face => face.status === 'loaded'), detail);
        assert.ok(state.math > 0, detail);
        assert.notEqual(Math.round(state.glyphs[0]), Math.round(state.glyphs[1]), `MJX-TEX-N does not render: ${detail}`);
        await page.close();
      }
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });

  test(`${name}: math faces still loading keep the article's rules; back, forward and another math article reuse loaded ones`, { timeout: 120_000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
      const page = await context.newPage();
      // A slow network: the hovered faces are still loading at the click.
      let slow = true;
      await page.route('**/fonts/mjx/*', async route => {
        if (slow) await new Promise(resolve => setTimeout(resolve, 1500));
        await route.continue();
      });
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);
      const familiesOf = async slug => JSON.parse(await page.locator(`a[href$="${slug}/"]`).getAttribute('data-math-fonts'))
        .map(([family]) => family);
      const families = await familiesOf('symmetric-polynomial');
      const math = page.locator('a[href$="symmetric-polynomial/"]');
      await math.hover();
      await page.waitForTimeout(300);
      await math.click();
      await page.waitForURL('**/symmetric-polynomial/');
      await page.waitForSelector('html.cl-ready:not(.cl-pending)');
      const kept = await page.evaluate(() => [...document.querySelectorAll('style[data-math-font]')].map(style => style.dataset.mathFont));
      assert.deepEqual(kept.sort(), [...families].sort(), 'rules of faces not yet loaded must stay');
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => [...document.fonts]
        .some(face => face.family === 'MJX-TEX-N' && face.status === 'loaded')));
      slow = false;

      const mathState = families => page.evaluate(families => ({
        rules: document.querySelectorAll('style[data-math-font]').length,
        preload: document.querySelectorAll('link[data-math-font-preload]').length,
        unloaded: [...document.fonts].filter(face => families.includes(face.family) && face.status !== 'loaded')
          .map(face => `${face.family}:${face.status}`),
        math: document.querySelectorAll('.cl-article mjx-container').length,
        swapped: window.sameDocument === true,
      }), families);
      // Each step waits for Astro's swap: the URL changes before it.
      const swap = async action => {
        const swapped = page.evaluate(() => new Promise(resolve =>
          document.addEventListener('astro:page-load', () => resolve(), { once: true })));
        await action();
        await swapped;
        await page.waitForFunction(() => !document.querySelector('.cl-article')
          || document.documentElement.classList.contains('cl-ready'));
        await page.evaluate(() => document.fonts.ready);
      };
      // Back to the index and forward again: the faces loaded on hover serve the article.
      await page.evaluate(() => { window.sameDocument = true; });
      await swap(() => page.goBack());
      await swap(() => page.goForward());
      assert.ok(page.url().endsWith('/symmetric-polynomial/'));
      let state = await mathState(families);
      assert.deepEqual({ ...state, math: state.math > 0 }, { rules: 0, preload: 0, unloaded: [], math: true, swapped: true }, JSON.stringify(state));

      // Another math article: only the rules of faces loaded here go.
      const other = 'tips-julia';
      const otherFamilies = await familiesOf(other);
      await swap(() => page.locator(`a[href$="${other}/"]`).evaluate(link => link.click()));
      assert.ok(page.url().endsWith(`/${other}/`));
      const rules = await page.evaluate(() => [...document.querySelectorAll('style[data-math-font]')].map(style => style.dataset.mathFont));
      assert.deepEqual(rules.sort(), otherFamilies.filter(family => !families.includes(family)).sort());
      state = await mathState(otherFamilies);
      assert.ok(state.math > 0 && state.unloaded.length === 0 && state.swapped, JSON.stringify(state));
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
}
