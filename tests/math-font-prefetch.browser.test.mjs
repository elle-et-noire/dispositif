import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';
const selected = process.env.RM_ENGINES?.split(',');
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
      const familiesBefore = await page.evaluate(() => [...document.fonts].map(face => face.family).sort());

      // An article without math has no list and loads nothing.
      const plain = page.locator('a[href$="tips-python/"]');
      assert.equal(await plain.getAttribute('data-math-fonts'), null);
      await plain.hover();
      await page.waitForTimeout(300);
      assert.deepEqual(await mathFontRequests(page), []);

      // Passing over a math link for less than the hover delay loads nothing.
      const math = page.locator('a[href$="symmetric-polynomial/"]');
      await math.hover();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
      assert.deepEqual(await mathFontRequests(page), [], 'a brief pass should not prefetch');

      const expected = (await math.getAttribute('data-math-fonts')).split(' ').map(url => new URL(url, base).pathname).sort();
      assert.ok(expected.length > 0 && expected.every(path => path.endsWith('.woff2')));
      await math.hover();
      await page.waitForFunction(count => performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('/fonts/mjx/')).length >= count, expected.length);
      await page.waitForTimeout(200);
      assert.deepEqual(await mathFontRequests(page), expected);
      // The prefetched faces stay private to the prefetch; the index's fonts are unchanged.
      assert.deepEqual(await page.evaluate(() => [...document.fonts].map(face => face.family).sort()), familiesBefore);

      // Hovering again or focusing the link does not request the fonts twice.
      await page.mouse.move(2, 2);
      await math.hover();
      await math.focus();
      await page.waitForTimeout(300);
      assert.equal((await mathFontRequests(page)).length, expected.length);

      await math.click();
      await page.waitForFunction(() => document.documentElement.classList.contains('rm-ready')
        && !document.documentElement.classList.contains('rm-pending') && location.pathname.endsWith('/symmetric-polynomial/'));
      assert.equal(await page.evaluate(() => document.querySelectorAll('mjx-container').length > 0), true);
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
}
