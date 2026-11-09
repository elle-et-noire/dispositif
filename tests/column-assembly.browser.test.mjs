import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_URL, engines, launch } from "./browser.mjs";


// Columns that a slot shows but that lie outside the viewport, and whether
// each has its copied blocks yet. Columns outside the article have no paper.
const columns = () => {
  const viewport = document.querySelector('.cl-viewport');
  const bounds = viewport.getBoundingClientRect();
  return [...document.querySelectorAll('.cl-slot')]
    .filter((slot) => slot.querySelector('.cl-paper').getBoundingClientRect().height > 0)
    .map((slot) => {
      const box = slot.parentElement.getBoundingClientRect();
      return {
        k: Number(slot.dataset.clK),
        source: slot.firstElementChild.classList.contains('cl-source'),
        onScreen: box.right > bounds.left && box.left < bounds.right,
        filled: slot.firstElementChild.childElementCount > 0,
      };
    });
};

const check = async (engine) => {
  const browser = await launch(engine);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((columnsSource) => {
      if (location.protocol === 'about:') return;
      localStorage.setItem('dispositif:columns', 'multi');
      const columns = new Function(`return (${columnsSource})()`);
      new MutationObserver(() => {
        const classes = document.documentElement.classList;
        if (window.clShown || !classes.contains('cl-ready') || classes.contains('cl-pending')) return;
        window.clShown = columns();
      // Chromium runs init scripts before <html> exists.
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }, columns.toString());
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(new URL('symmetric-polynomial/', BASE_URL).href);
    await page.waitForFunction(() => window.clShown);

    // The reader's layout variables stay on the elements that use them. An
    // inherited change would restyle every element of the article.
    const leaked = await page.evaluate(() => {
      const inside = document.querySelector('.cl-source p, .cl-source mjx-container');
      const style = getComputedStyle(inside);
      return ['--cl-w', '--cl-h', '--cl-l', '--cl-p', '--cl-step', '--cl-edge', '--cl-overlap', '--cl-header-height']
        .filter((name) => style.getPropertyValue(name).trim() !== '');
    });
    assert.deepEqual(leaked, []);
    assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.cl-content')).getPropertyValue('--cl-w').trim().endsWith('px')),
      'the column width does not reach the columns');

    // When the article is shown, the visible columns are complete and at
    // least one column outside the viewport is still waiting.
    const shown = await page.evaluate(() => window.clShown);
    assert.ok(shown.some((column) => column.source && column.onScreen), JSON.stringify(shown));
    assert.deepEqual(shown.filter((column) => column.onScreen && !column.filled), [], JSON.stringify(shown));
    assert.ok(shown.some((column) => !column.onScreen && !column.filled), JSON.stringify(shown));
    // A frame later, every column with paper has its blocks.
    await page.waitForFunction(new Function(`return (${columns.toString()})().every((column) => column.filled)`));

    // Scrolling to the following column shows its text immediately.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(new Function(`return (${columns.toString()})().filter((column) => column.onScreen).every((column) => column.filled)`));
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
};

// With n段 stored, opening an article from the index lays the text out only at
// the column width: at the swap, the original already sits in the first column.
const checkPremount = async (engine) => {
  const browser = await launch(engine);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      if (location.protocol !== 'about:') localStorage.setItem('dispositif:columns', 'multi');
    });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(BASE_URL);
    await page.evaluate(() => {
      window.clWidths = [];
      document.addEventListener('astro:after-swap', () => {
        const source = document.querySelector('.cl-source');
        // Force the first layout after the swap, wherever the text is now,
        // then record every later size the text is laid out at.
        window.clWidths.push({ at: 'swap', width: source.getBoundingClientRect().width,
          inColumn: Boolean(source.closest('.cl-slot')) });
        new ResizeObserver((entries) => {
          for (const entry of entries) window.clWidths.push({ at: 'resize', width: entry.borderBoxSize[0].inlineSize });
        }).observe(source);
      }, { once: true });
    });
    await page.locator('a[href$="symmetric-polynomial/"]').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('cl-multi')
      && !document.documentElement.classList.contains('cl-pending'));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const { widths, final, inColumn } = await page.evaluate(() => {
      const source = document.querySelector('.cl-source');
      return { widths: window.clWidths, final: parseFloat(source.style.width), inColumn: Boolean(source.closest('.cl-slot')) };
    });
    assert.ok(inColumn);
    assert.equal(final, 608);
    assert.equal(widths[0].at, 'swap');
    assert.ok(widths[0].inColumn, JSON.stringify(widths));
    assert.deepEqual(widths.filter((entry) => Math.abs(entry.width - final) > 0.01), [], JSON.stringify(widths));
    assert.equal(await page.locator('.cl-plane .cl-source').count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
};

// The same on a direct load and a reload: the head script moves the original
// into the first column as soon as the parser attaches it. A ResizeObserver
// attached as soon as the original is parsed reports every size it is rendered
// at, from the first frame on. Frames of the original while it is still empty
// are ignored.
const checkDirectPremount = async (engine) => {
  const browser = await launch(engine);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      if (location.protocol === 'about:') return;
      localStorage.setItem('dispositif:columns', 'multi');
      window.clWidths = [];
      const watch = new MutationObserver(() => {
        const source = document.querySelector('.cl-source');
        if (!source) return;
        watch.disconnect();
        new ResizeObserver((entries) => {
          for (const entry of entries) window.clWidths.push({ width: entry.borderBoxSize[0].inlineSize,
            // The text parsed so far, laid out in this frame.
            text: entry.target.childElementCount - entry.target.querySelectorAll(':scope > script').length,
            inColumn: Boolean(entry.target.closest('.cl-slot')) });
        }).observe(source);
      });
      // Chromium runs init scripts before <html> exists.
      watch.observe(document, { childList: true, subtree: true });
    });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const shown = async (label) => {
      await page.waitForFunction(() => document.documentElement.classList.contains('cl-multi')
        && !document.documentElement.classList.contains('cl-pending'));
      await frames();
      const { widths, final, count } = await page.evaluate(() => ({ widths: window.clWidths.filter((entry) => entry.text > 0),
        final: parseFloat(document.querySelector('.cl-plane .cl-source')?.style.width),
        count: document.querySelectorAll('.cl-source').length }));
      assert.equal(count, 1, label);
      assert.equal(final, 608, label);
      assert.ok(widths.length > 0 && widths[0].inColumn, `${label}: ${JSON.stringify(widths)}`);
      assert.deepEqual(widths.filter((entry) => Math.abs(entry.width - final) > 0.01), [], `${label}: ${JSON.stringify(widths)}`);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('cl-premount')), false, label);
    };
    const position = () => page.evaluate(() => {
      const { clXTicks, clYTicks } = document.querySelector('.cl-plane').dataset;
      return [clXTicks, clYTicks];
    });
    const article = new URL('symmetric-polynomial/', BASE_URL).href;
    await page.goto(article);
    await shown('direct');
    // A reload restores the saved reading position after the same premount.
    await page.locator('.cl-viewport').evaluate((viewport) => { viewport.scrollLeft += 700; viewport.scrollTop += 150; });
    await frames();
    const before = await position();
    assert.notDeepEqual(before, ['0', '0']);
    await page.reload();
    await shown('reload');
    assert.deepEqual(await position(), before, 'reload');
    // A fragment in the address is followed from the premounted column.
    await page.goto(`${article}#${encodeURIComponent('cauchy和公式')}`);
    await shown('hash');
    assert.notDeepEqual(await position(), ['0', '0'], 'hash');
    // Astro runs inline scripts again after swapping a page in. There the
    // navigation has already premounted the article.
    await page.locator('.cl-close:visible').click();
    await page.waitForSelector('html[data-page-kind="index"]');
    await page.locator('a[href$="symmetric-polynomial/"]').first().click();
    await page.waitForFunction(() => document.documentElement.classList.contains('cl-multi')
      && !document.documentElement.classList.contains('cl-pending'));
    assert.equal(await page.locator('.cl-source').count(), 1);
    assert.equal(await page.locator('.cl-plane .cl-source').count(), 1);
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
};

for (const [name, engine] of engines) {
  test(`${name}: 一覧から開くn段の本文は、差し替えの時点で段の幅にある`, { timeout: 120_000 }, async () => {
    try {
      await checkPremount(engine);
    } catch (error) {
      if (!/Execution context was destroyed/.test(String(error))) throw error;
      await checkPremount(engine);
    }
  });

  test(`${name}: 直接開く・再読み込みするn段の本文は、最初のレイアウトから段の幅にある`, { timeout: 120_000 }, async () => {
    try {
      await checkDirectPremount(engine);
    } catch (error) {
      if (!/Execution context was destroyed/.test(String(error))) throw error;
      await checkDirectPremount(engine);
    }
  });

  test(`${name}: n段の組み立ては本文全体を再計算させず、画面外の列は表示後に埋める`, { timeout: 120_000 }, async () => {
    try {
      await check(engine);
    } catch (error) {
      // On the dev server, another test touching watched files can make Vite
      // reload this page midway. Only that is retried, once.
      if (!/Execution context was destroyed/.test(String(error))) throw error;
      await check(engine);
    }
  });
}
