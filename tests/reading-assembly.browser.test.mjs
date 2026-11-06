import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox } from 'playwright-core';

const base = process.env.RM_BASE_URL ?? 'http://localhost:4321/dispositif/';
const selected = process.env.RM_ENGINES?.split(',');
const engines = Object.entries({ chromium, firefox }).filter(([name]) => !selected || selected.includes(name));

// Columns that a slot shows but that lie outside the viewport, and whether
// each has its copied blocks yet. Columns outside the article have no paper.
const columns = () => {
  const viewport = document.querySelector('.rm-viewport');
  const bounds = viewport.getBoundingClientRect();
  return [...document.querySelectorAll('.rm-slot')]
    .filter((slot) => slot.querySelector('.rm-paper').getBoundingClientRect().height > 0)
    .map((slot) => {
      const box = slot.parentElement.getBoundingClientRect();
      return {
        k: Number(slot.dataset.rmK),
        source: slot.firstElementChild.classList.contains('rm-source'),
        onScreen: box.right > bounds.left && box.left < bounds.right,
        filled: slot.firstElementChild.childElementCount > 0,
      };
    });
};

const check = async (engine) => {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript((columnsSource) => {
      if (location.protocol === 'about:') return;
      localStorage.setItem('dispositif:reading-mode', 'multi');
      const columns = new Function(`return (${columnsSource})()`);
      new MutationObserver(() => {
        const classes = document.documentElement.classList;
        if (window.rmShown || !classes.contains('rm-ready') || classes.contains('rm-pending')) return;
        window.rmShown = columns();
      // Chromium runs init scripts before <html> exists.
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }, columns.toString());
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(new URL('symmetric-polynomial/', base).href);
    await page.waitForFunction(() => window.rmShown);

    // The reader's layout variables stay on the elements that use them. An
    // inherited change would restyle every element of the article.
    const leaked = await page.evaluate(() => {
      const inside = document.querySelector('.rm-source p, .rm-source mjx-container');
      const style = getComputedStyle(inside);
      return ['--rm-w', '--rm-h', '--rm-l', '--rm-p', '--rm-step', '--rm-edge', '--rm-overlap', '--rm-header-height']
        .filter((name) => style.getPropertyValue(name).trim() !== '');
    });
    assert.deepEqual(leaked, []);
    assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.rm-content')).getPropertyValue('--rm-w').trim().endsWith('px')),
      'the column width does not reach the columns');

    // When the article is shown, the visible columns are complete and at
    // least one column outside the viewport is still waiting.
    const shown = await page.evaluate(() => window.rmShown);
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
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      if (location.protocol !== 'about:') localStorage.setItem('dispositif:reading-mode', 'multi');
    });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(base);
    await page.evaluate(() => {
      window.rmWidths = [];
      document.addEventListener('astro:after-swap', () => {
        const source = document.querySelector('.rm-source');
        // Force the first layout after the swap, wherever the text is now,
        // then record every later size the text is laid out at.
        window.rmWidths.push({ at: 'swap', width: source.getBoundingClientRect().width,
          inColumn: Boolean(source.closest('.rm-slot')) });
        new ResizeObserver((entries) => {
          for (const entry of entries) window.rmWidths.push({ at: 'resize', width: entry.borderBoxSize[0].inlineSize });
        }).observe(source);
      }, { once: true });
    });
    await page.locator('a[href$="symmetric-polynomial/"]').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('rm-active')
      && !document.documentElement.classList.contains('rm-pending'));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const { widths, final, inColumn } = await page.evaluate(() => {
      const source = document.querySelector('.rm-source');
      return { widths: window.rmWidths, final: parseFloat(source.style.width), inColumn: Boolean(source.closest('.rm-slot')) };
    });
    assert.ok(inColumn);
    assert.equal(final, 608);
    assert.equal(widths[0].at, 'swap');
    assert.ok(widths[0].inColumn, JSON.stringify(widths));
    assert.deepEqual(widths.filter((entry) => Math.abs(entry.width - final) > 0.01), [], JSON.stringify(widths));
    assert.equal(await page.locator('.rm-plane .rm-source').count(), 1);
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
