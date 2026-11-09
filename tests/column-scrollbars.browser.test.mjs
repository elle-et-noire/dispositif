import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { columnScrollbar } from "./column-controls.mjs";
import { ARTICLE_URL, launch, storeColumns } from "./browser.mjs";

const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});
const position = page => page.locator(".cl-plane").evaluate(p => ({
  x: Number(p.dataset.clXTicks) / 1024, y: Number(p.dataset.clYTicks) / 1024,
}));

test("本文自身の縦バーを右端に表示し、上下矢印・長押し・ドラッグ・キーで操作できる", { timeout: 60_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const width of [390, 1280]) for (const zoom of [1, 1.25]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await storeColumns(page, "multi");
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".cl-slot"); await page.evaluate(() => document.fonts.ready);
        // Synthetic CSS zoom also enlarges 100dvh. Keep both native arrow
        // buttons inside the physical browser viewport for pointer input.
        await page.addStyleTag({ content: `html { zoom: ${zoom}; } .cl-reader { max-height: ${600 / zoom}px; } astro-dev-toolbar { display: none; }` });
        await page.locator(".cl-source").evaluate(s => { s.innerHTML = '<div style="height:20000px;background:#a33b00"></div>'; });
        await page.waitForFunction(() => document.querySelector(".cl-plane").style.getPropertyValue("--cl-l") === "20000px");
        await page.locator(".cl-viewport").focus(); await page.keyboard.press("Home"); await settle(page);
        await page.locator(".cl-viewport").evaluate(v => { v.scrollLeft += 100; }); await settle(page);
        const bar = await columnScrollbar(page, "y");
        assert.ok(Math.abs(bar.x + bar.width - width) < 1, "縦バーが画面右端にない");
        assert.ok(Math.abs(bar.width - 8 * zoom) < 1, "縦バーの幅が8pxではない");
        const initial = await position(page);
        const mouseX = bar.x + bar.width / 2;
        await page.mouse.move(mouseX, bar.center); await page.mouse.down();
        await page.mouse.move(mouseX, bar.center + 60 * zoom, { steps: 12 }); await page.mouse.up(); await settle(page);
        const dragged = await position(page);
        assert.ok(dragged.y > initial.y + 100, "縦のつまみをドラッグできない");
        assert.equal(dragged.x, initial.x, "縦バー操作で横位置が動いた");
        assert.equal(new URL(page.url()).pathname, new URL(ARTICLE_URL).pathname, "縦バーの操作で記事が閉じた");
        const after = await columnScrollbar(page, "y");
        assert.equal(after.x, bar.x, "本文のスクロールで縦バーの配置が動いた");
        const downY = bar.y + bar.height + 8 * zoom, upY = bar.y - 8 * zoom;
        await page.mouse.click(mouseX, downY);
        await page.waitForFunction(y => Number(document.querySelector(".cl-plane").dataset.clYTicks) / 1024 > y + 1, dragged.y);
        await page.waitForTimeout(200); await settle(page);
        const clicked = await position(page);
        await page.mouse.move(mouseX, downY); await page.mouse.down();
        await page.waitForTimeout(650); await page.mouse.up();
        await page.waitForTimeout(200); await settle(page);
        const held = await position(page);
        assert.ok(held.y > clicked.y + 80, "下矢印の長押しで連続移動できない");
        await page.mouse.click(mouseX, upY);
        await page.waitForFunction(y => Number(document.querySelector(".cl-plane").dataset.clYTicks) / 1024 < y - 1, held.y);
        await page.waitForTimeout(200); await settle(page);
        const beforeKey = await position(page);
        assert.equal(beforeKey.x, initial.x, "上下矢印で横位置が変わった");
        assert.equal(new URL(page.url()).pathname, new URL(ARTICLE_URL).pathname, "上下矢印の操作で記事が閉じた");
        await page.keyboard.press("ArrowDown");
        await page.waitForFunction(y => Number(document.querySelector(".cl-plane").dataset.clYTicks) / 1024 > y + 1, beforeKey.y);
        assert.equal((await position(page)).x, dragged.x);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
