import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { toggleColumns, columnScrollbar } from "./column-controls.mjs";
import { ARTICLE_URL, launch, storeColumns } from "./browser.mjs";


async function settle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}

async function state(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".cl-viewport");
    const plane = document.querySelector(".cl-plane");
    const p = parseFloat(plane.style.getPropertyValue("--cl-p"));
    const w = parseFloat(plane.style.getPropertyValue("--cl-w"));
    const h = parseFloat(plane.style.getPropertyValue("--cl-h"));
    const edge = parseFloat(plane.style.getPropertyValue("--cl-edge"));
    const x = viewport.scrollLeft + Number(plane.dataset.clOriginColumn) * p - Number(plane.dataset.clLeading);
    const y = viewport.scrollTop + Number(plane.dataset.clOriginY);
    let first = Math.ceil((x - edge - 0.01) / p);
    let last = Math.floor((x + viewport.clientWidth - edge - w + 0.01) / p);
    if (first > last) first = last = Math.round((x + viewport.clientWidth / 2 - edge - w / 2) / p);
    return { x, y, p, w, first, last, edge, width: viewport.clientWidth,
      h: viewport.clientHeight, l: parseFloat(plane.style.getPropertyValue("--cl-l")),
      hasEnd: [...document.querySelectorAll(".cl-slot")].some(slot => {
        const r = slot.getBoundingClientRect(), v = viewport.getBoundingClientRect();
        return r.left >= v.left - 1 && r.right <= v.right + 1
          && parseFloat(slot.querySelector(".cl-paper").style.height) >= viewport.clientHeight - 1
          && Math.abs(Number(slot.dataset.clK) * h + y + viewport.clientHeight - parseFloat(plane.style.getPropertyValue("--cl-l"))) < 2;
      }) };
  });
}

test("切り替えボタンを直接表示し、標準バーとHome・Endで先頭・末尾へ到達できる", { timeout: 45_000 }, async () => {
  const browser = await launch(chromium, { ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await storeColumns(page, "multi");
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".cl-slot");
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const rect = await page.locator(".cl-viewport").boundingBox();
        assert.ok(Math.abs(rect.x) < 1);
        assert.ok(Math.abs(width - rect.x - rect.width) < 1);
        assert.equal(await page.locator(".cl-settings, [data-cl-overlap], [data-cl-edge]").count(), 0);
        assert.equal(await page.locator("[data-site-header] .cl-toggle").isVisible(), true);
        assert.equal(await page.locator("article .cl-toolbar").count(), 0);
        // Use the real native scrollbar, with Chromium's headless hiding off.
        const bar = await columnScrollbar(page);
        await page.mouse.move(bar.center, bar.y + bar.height / 2);
        await page.mouse.down();
        await page.mouse.move(bar.x + bar.width - 6, bar.y + bar.height / 2, { steps: 12 });
        await page.mouse.up();
        await settle(page);
        assert.ok((await state(page)).x > 100, "横バーをドラッグできない");
        await page.locator(".cl-viewport").focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(await page.locator(".cl-viewport").evaluate((el) => getComputedStyle(el).outlineStyle), "none");
        await page.keyboard.press("End");
        await settle(page);
        const end = await state(page);
        assert.ok(end.hasEnd, "マウスで末尾へ到達できない");
        await page.keyboard.press("Home");
        await settle(page);
        const start = await state(page);
        assert.ok(Math.abs(start.x) < 2 && Math.abs(start.y) < 2);
        await toggleColumns(page);
        await settle(page);
        assert.equal(await page.locator("article .cl-toolbar").count(), 1);
        assert.equal(await page.locator(".cl-settings-toggle").count(), 0);
        assert.equal(await page.locator(".cl-toolbar > .cl-toggle").isVisible(), true);
        await toggleColumns(page);
        await settle(page);
        await page.mouse.click(rect.x + 30, rect.y + 300);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
