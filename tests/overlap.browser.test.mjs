import { openReadingSettings, toggleReadingMode } from "./reading-controls.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";

const BASE_URL = process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/";
const ARTICLE_URL = new URL("symmetric-polynomial/", BASE_URL).href;

async function state(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".rm-viewport");
    const plane = document.querySelector(".rm-plane");
    const input = document.querySelector("[data-rm-overlap]");
    const p = parseFloat(plane.style.getPropertyValue("--rm-p"));
    const step = parseFloat(plane.style.getPropertyValue("--rm-step"));
    const originColumn = Number(document.querySelector(".rm-plane").dataset.rmOriginColumn);
    const originY = parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY);
    return {
      t: (Math.floor((viewport.scrollLeft - Number(plane.dataset.rmLeading) + 0.01) / p) + originColumn) * step + viewport.scrollTop + originY,
      overlap: viewport.clientHeight - step,
      max: Number(input.max),
      value: input.valueAsNumber,
    };
  });
}

async function waitForOverlap(page, overlap) {
  await page.waitForFunction((overlap) => {
    const input = document.querySelector("[data-rm-overlap]");
    const plane = document.querySelector(".rm-plane");
    return input && plane && input.valueAsNumber === overlap
      && parseFloat(plane.style.getPropertyValue("--rm-overlap")) === overlap;
  },
  overlap);
}

test("本文の重なりをpx単位で変更・保存できる", { timeout: 90_000 }, async (t) => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined });
  try {
    for (const width of [1600, 390]) {
      await t.test(`${width}px で重なり量を調整する`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
          await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector("html.rm-active .rm-settings-toggle");
          await openReadingSettings(page);
          const input = page.locator("[data-rm-overlap]");
          assert.equal(await input.count(), 1);
          assert.equal(await input.getAttribute("step"), "1");
          assert.equal((await state(page)).value, (await state(page)).overlap);

          await page.locator(".rm-viewport").evaluate((viewport) => {
            const style = document.querySelector(".rm-plane").style;
            const p = parseFloat(style.getPropertyValue("--rm-p"));
            const origin = Number(document.querySelector(".rm-plane").dataset.rmOriginColumn);
            const y = parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY);
            viewport.scrollTo({ left: (3 - origin) * p + 73 + Number(document.querySelector(".rm-plane").dataset.rmLeading), top: 143 - y, behavior: "instant" });
          });
          await page.evaluate(async () => {
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
          });
          const before = await state(page);
          await input.fill("32");
          await waitForOverlap(page, 32);
          assert.ok(Math.abs((await state(page)).t - before.t) < 1, "調整で読書位置がずれた");

          await input.press("ArrowUp");
          await waitForOverlap(page, 33);
          assert.ok(Math.abs((await state(page)).t - before.t) < 1);
          await input.press("ArrowDown");
          await waitForOverlap(page, 32);
          await input.fill("");
          assert.equal((await state(page)).overlap, 32);
          await input.blur();
          assert.equal(await input.inputValue(), "32");

          await input.fill("0");
          await waitForOverlap(page, 0);
          assert.ok(Math.abs((await state(page)).t - before.t) < 1);
          assert.equal(await page.locator(".rm-slot").first().evaluate((slot) =>
            getComputedStyle(slot.querySelector(".rm-shade"), "::after").height), "0px");
          await page.reload({ waitUntil: "domcontentloaded" });
          await waitForOverlap(page, 0);
          await openReadingSettings(page);

          await input.fill("9999");
          await page.waitForFunction(() => {
            const input = document.querySelector("[data-rm-overlap]");
            return input.valueAsNumber === Number(input.max)
              && parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-overlap")) === Number(input.max);
          });
          const maximum = (await state(page)).max;
          assert.ok(await input.evaluate((input) => input.checkValidity()));
          await page.setViewportSize({ width, height: 500 });
          await page.waitForFunction(() => {
            const input = document.querySelector("[data-rm-overlap]");
            const h = document.querySelector(".rm-viewport").clientHeight;
            return input.valueAsNumber === Math.floor(h / 4) && Number(input.max) === Math.floor(h / 4);
          });
          assert.equal((await state(page)).value, (await state(page)).overlap);
          await page.setViewportSize({ width, height: 900 });
          await waitForOverlap(page, maximum);

          await toggleReadingMode(page);
          assert.equal(await input.isVisible(), false);
          await toggleReadingMode(page);
          await waitForOverlap(page, maximum);
          await page.locator(".rm-toolbar > a").click();
          await page.waitForURL(BASE_URL);
          await page.locator('a[href*="/tips-julia"]').first().click();
          await waitForOverlap(page, maximum);
        } finally {
          await page.close();
        }
      });
    }

    await t.test("localStorageが使えなくても調整できる", async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.addInitScript(() => {
          // Reject the app's storage without breaking Astro's development UI.
          const getItem = Storage.prototype.getItem;
          const setItem = Storage.prototype.setItem;
          Storage.prototype.getItem = function (key) {
            if (String(key).startsWith("dispositif:")) throw new Error("storage denied");
            return getItem.call(this, key);
          };
          Storage.prototype.setItem = function (key, value) {
            if (String(key).startsWith("dispositif:")) throw new Error("storage denied");
            return setItem.call(this, key, value);
          };
        });
        await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("html.rm-ready > body .rm-toolbar > .rm-toggle");
        await toggleReadingMode(page);
        await openReadingSettings(page);
        await page.locator("[data-rm-overlap]").fill("17");
        await waitForOverlap(page, 17);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  } finally {
    await browser.close();
  }
});
