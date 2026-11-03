import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";

const ARTICLE_URL = new URL("symmetric-polynomial/",
  process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/").href;

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

test("本文の左右余白は段と流れ、横バーの左右余白は固定される", { timeout: 90_000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.RM_BROWSER_PATH || undefined, ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const zoom of [1, 1.25, 1.5]) {
      for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
          await page.goto(ARTICLE_URL);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector(".rm-slot .rm-source");
          await page.addStyleTag({ content: `html { zoom: ${zoom}; } astro-dev-toolbar { display: none; }` });
          await page.locator(".rm-source").evaluate((source) => {
            source.innerHTML = Array.from({ length: 300 }, (_, i) =>
              `<div style="height:40px;margin:0;background:${i % 2 ? "#0044aa" : "#aa3300"}"></div>`).join("");
          });
          await page.waitForFunction(() => document.querySelector(".rm-plane").style.getPropertyValue("--rm-l") !== "");
          await settle(page);
          await page.locator(".rm-viewport").focus();
          await page.keyboard.press("Home");
          await settle(page);
          const initial = await page.evaluate(() => {
            const viewport = document.querySelector(".rm-viewport").getBoundingClientRect();
            const frame = document.querySelector('.rm-slot[data-rm-k="0"]').getBoundingClientRect();
            const edge = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rm-edge-space")) * parseFloat(getComputedStyle(document.documentElement).fontSize);
            return { viewportLeft: viewport.left, viewportRight: viewport.right, firstLeft: frame.left, edge };
          });
          assert.ok(Math.abs(initial.viewportLeft) < 1, "本文の左端に固定の余白が残った");
          assert.ok(Math.abs(width - initial.viewportRight) < 1.5, "本文の右端に固定の余白が残った");
          if (zoom === 1) {
            const barImage = await page.screenshot();
            const barPixels = await page.evaluate(async ({ png, zoom }) => {
              const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
              const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
              const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
              const rect = document.querySelector(".rm-viewport").getBoundingClientRect();
              const y = Math.floor(rect.bottom - 6 * zoom);
              const v = document.querySelector(".rm-viewport"), track = v.clientWidth - 32;
              const thumb = track * v.clientWidth / v.scrollWidth;
              const center = 16 + (track - thumb) * v.scrollLeft / (v.scrollWidth - v.clientWidth) + thumb / 2;
              return [1, Math.floor(center * zoom)].map((x) => [...context.getImageData(x, y, 1, 1).data]);
            }, { png: barImage.toString("base64"), zoom });
            assert.notDeepEqual(barPixels[0], [148, 163, 184, 255], "横バーの左余白が消えた");
            assert.deepEqual(barPixels[1], [148, 163, 184, 255], "左右余白を残した横バーがない");
          }
          assert.ok(Math.abs(initial.firstLeft - initial.edge * zoom) < 1.5, "先頭の左余白が指定幅と違う");
          await page.locator(".rm-viewport").evaluate((viewport) => { viewport.scrollLeft += 100; });
          await settle(page);
          const point = await page.evaluate((zoom) => {
            const rect = document.querySelector(".rm-viewport").getBoundingClientRect();
            const x = Math.ceil(rect.left + 1), y = Math.floor(rect.top + 100 * zoom);
            return { x, y, inColumn: !!document.elementFromPoint(x, y)?.closest(".rm-slot") };
          }, zoom);
          assert.ok(point.inColumn, "余白の内側に本文が描画されていない");
          assert.equal(await page.evaluate((y) => !!document.elementFromPoint(1, y)?.closest(".rm-slot"), point.y), true, "スクロール後も左端が固定の余白に遮られている");
          const screenshot = await page.screenshot();
          const pixel = await page.evaluate(async ({ png, x, y }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${png}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            return [...context.getImageData(x, y, 1, 1).data];
          }, { png: screenshot.toString("base64"), ...point });
          assert.ok(["170,51,0,255", "0,68,170,255"].includes(pixel.join()),
            `左端の画素が本文ではない: ${JSON.stringify({ zoom, width, pixel })}`);
          await page.keyboard.press("End");
          await settle(page);
          const endMargin = await page.evaluate(() => {
            const viewport = document.querySelector(".rm-viewport").getBoundingClientRect();
            const frames = [...document.querySelectorAll(".rm-slot")].filter(slot => parseFloat(slot.querySelector(".rm-paper").style.height) > 1)
              .map(slot => slot.getBoundingClientRect()).filter(rect => rect.left < viewport.right && rect.right > viewport.left);
            return { gap: viewport.right - Math.max(...frames.map(rect => rect.right)),
              period: parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-p")) };
          });
          assert.ok(endMargin.gap >= initial.edge * zoom - 1.5 && endMargin.gap <= (endMargin.period + initial.edge) * zoom + 1.5,
            "Endで外側余白が1段幅を超えた");
          await page.keyboard.press("Home");
          await settle(page);
          assert.ok(Math.abs(await page.locator('.rm-slot[data-rm-k="0"]').evaluate((slot) =>
            slot.getBoundingClientRect().left) - initial.firstLeft) < 1.5);
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
});
