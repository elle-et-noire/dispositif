import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { openReadingSettings, toggleReadingMode } from "./reading-controls.mjs";

const ARTICLE_URL = new URL("symmetric-polynomial/",
  process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/").href;

async function settle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
  });
}

async function state(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".rm-viewport");
    const plane = document.querySelector(".rm-plane");
    const p = parseFloat(plane.style.getPropertyValue("--rm-p"));
    const w = parseFloat(plane.style.getPropertyValue("--rm-w"));
    const step = parseFloat(plane.style.getPropertyValue("--rm-step"));
    const edge = parseFloat(plane.style.getPropertyValue("--rm-edge"));
    const x = viewport.scrollLeft + Number(plane.dataset.rmOriginColumn) * p - Number(plane.dataset.rmLeading);
    const y = viewport.scrollTop + Number(plane.dataset.rmOriginY);
    let first = Math.ceil((x - edge - 0.01) / p);
    let last = Math.floor((x + viewport.clientWidth - edge - w + 0.01) / p);
    if (first > last) first = last = Math.round((x + viewport.clientWidth / 2 - edge - w / 2) / p);
    return { x, y, p, w, step, first, last, edge, width: viewport.clientWidth,
      h: viewport.clientHeight, l: parseFloat(plane.style.getPropertyValue("--rm-l")),
      hasEnd: [...document.querySelectorAll(".rm-slot")].some(slot => {
        const r = slot.getBoundingClientRect(), v = viewport.getBoundingClientRect();
        return r.left >= v.left - 1 && r.right <= v.right + 1
          && parseFloat(slot.querySelector(".rm-paper").style.height) >= viewport.clientHeight - 1
          && Math.abs(Number(slot.dataset.rmK) * step + y + viewport.clientHeight - parseFloat(plane.style.getPropertyValue("--rm-l"))) < 2;
      }) };
  });
}

test("設定パネルは表示領域を押し下げず、マウス操作だけでも先頭・末尾へ到達できる", { timeout: 45_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined, ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".rm-slot");
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        const rect = await page.locator(".rm-viewport").boundingBox();
        assert.ok(Math.abs(rect.x) < 1);
        assert.ok(Math.abs(width - rect.x - rect.width) < 1);
        await openReadingSettings(page);
        assert.deepEqual(await page.locator(".rm-viewport").boundingBox(), rect);
        assert.equal(await page.locator("article .rm-toolbar").count(), 0);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".rm-settings").evaluate((settings) => settings.open), false);
        assert.equal(await page.locator(".rm-settings-toggle").evaluate((summary) => document.activeElement === summary), true);
        // Use the real native scrollbar, with Chromium's headless hiding off.
        const beforeDrag = await page.locator(".rm-viewport").evaluate(v => ({ left: v.scrollLeft, width: v.clientWidth, full: v.scrollWidth }));
        const trackWidth = rect.width - 32;
        const thumbWidth = trackWidth * beforeDrag.width / beforeDrag.full;
        const thumbX = rect.x + 16 + (trackWidth - thumbWidth) * beforeDrag.left / (beforeDrag.full - beforeDrag.width) + thumbWidth / 2;
        await page.mouse.move(thumbX, rect.y + rect.height - 6);
        await page.mouse.down();
        await page.mouse.move(rect.x + rect.width - 22, rect.y + rect.height - 6, { steps: 12 });
        await page.mouse.up();
        await settle(page);
        assert.ok((await state(page)).x > 100, "横バーをドラッグできない");
        await openReadingSettings(page);
        await page.locator('[data-rm-edge="end"]').click();
        await settle(page);
        const end = await state(page);
        assert.ok(end.hasEnd, "マウスで末尾へ到達できない");
        await openReadingSettings(page);
        await page.locator('[data-rm-edge="start"]').click();
        await settle(page);
        const start = await state(page);
        assert.ok(Math.abs(start.x) < 2 && Math.abs(start.y) < 2);
        await toggleReadingMode(page);
        await settle(page);
        assert.equal(await page.locator("article > .rm-toolbar").count(), 1);
        assert.equal(await page.locator(".rm-settings-toggle").isVisible(), false);
        assert.equal(await page.locator(".rm-toolbar > .rm-toggle").isVisible(), true);
        await toggleReadingMode(page);
        await settle(page);
        await openReadingSettings(page);
        await page.mouse.click(rect.x + 30, rect.y + 300);
        assert.equal(await page.locator(".rm-settings").evaluate((settings) => settings.open), false);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
