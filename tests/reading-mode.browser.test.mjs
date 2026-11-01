import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

const ARTICLE_URL = new URL(
  "symmetric-polynomial/",
  process.env.RM_BASE_URL ?? "http://localhost:4321/dispositif/",
).href;
const ROW_HEIGHT = 40;
const ROW_COUNT = 300;
const COLORS = [[170, 51, 0, 255], [0, 68, 170, 255]];

async function layout(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".rm-viewport");
    const plane = document.querySelector(".rm-plane");
    const rect = viewport.getBoundingClientRect();
    return {
      x: viewport.scrollLeft,
      y: viewport.scrollTop,
      h: viewport.clientHeight,
      step: parseFloat(plane.style.getPropertyValue("--rm-step")),
      p: parseFloat(plane.style.getPropertyValue("--rm-p")),
      l: parseFloat(plane.style.getPropertyValue("--rm-l")),
      top: rect.top,
      slots: [...document.querySelectorAll(".rm-slot")].map((slot) => {
        const frame = slot.getBoundingClientRect();
        return {
          k: Number(slot.dataset.rmK),
          left: frame.left,
          width: frame.width,
          top: frame.top,
          height: frame.height,
          visible: frame.left >= rect.left - 0.5 && frame.right <= rect.right + 0.5,
        };
      }),
    };
  });
}

async function readPixels(page, samples) {
  const screenshot = await page.screenshot();
  return page.evaluate(async ({ base64, samples }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return samples.map(({ x, y }) => [...context.getImageData(x, y, 1, 1).data]);
  }, { base64: screenshot.toString("base64"), samples });
}

async function assertPainted(page) {
  const state = await layout(page);
  const samples = [];
  for (const slot of state.slots.filter((slot) => slot.visible)) {
    assert.ok(Math.abs(slot.height - state.h) < 1, "段の高さが表示領域と違う");
    assert.ok(Math.abs(slot.top - state.top) < 1, "縦スクロールで段の枠が動いた");
    for (const offset of [23, 111, Math.floor(state.h / 2) + 7, state.h - 23]) {
      const y = Math.floor(state.top + offset);
      // Sample the actual pixel center, avoiding text at the row's left edge.
      const t = slot.k * state.step + state.y + y + 0.5 - state.top;
      if (t < 0 || t >= state.l) continue;
      samples.push({
        x: Math.floor(slot.left + slot.width * 0.85),
        y,
        expected: COLORS[Math.floor(t / ROW_HEIGHT) % 2],
        column: slot.k,
      });
    }
  }
  assert.ok(samples.length >= 4, "表示中の段の描画を検証できない");

  // Bounding rectangles stay correct even when the old overflow clip discards
  // pixels. Read the screenshot itself, not DOM geometry or computed colors.
  const pixels = await readPixels(page, samples);

  for (let i = 0; i < samples.length; i++) {
    assert.deepEqual(pixels[i], samples[i].expected,
      `段 ${samples[i].column} の画素 (${samples[i].x}, ${samples[i].y}) が本文と一致しない。scrollTop=${state.y}`);
  }
}

async function assertContextOverlap(page) {
  const state = await layout(page);
  const overlap = state.h - state.step;
  assert.ok(overlap > 0 && overlap <= state.h / 4);
  const visible = state.slots.filter((slot) => slot.visible);
  const samples = [];
  const sample = (slot, offset) => {
    const y = Math.floor(state.top + offset);
    const t = slot.k * state.step + state.y + y + 0.5 - state.top;
    if (t >= state.l) return;
    samples.push({ x: Math.floor(slot.left + slot.width * 0.85), y,
      expected: COLORS[Math.floor(t / ROW_HEIGHT) % 2] });
    return t;
  };
  for (const slot of visible) {
    const bottom = sample(slot, state.step + overlap / 2);
    if (slot.k > 0) sample(slot, overlap / 2);
    const next = visible.find((other) => other.k === slot.k + 1);
    if (next && bottom !== undefined) {
      const top = next.k * state.step + state.y
        + Math.floor(state.top + overlap / 2) + 0.5 - state.top;
      assert.ok(Math.abs(bottom - top) < 1, "上下端が同じ文脈を表示していない");
    }
  }
  const pixels = await readPixels(page, samples);
  for (let i = 0; i < samples.length; i++) {
    const expected = samples[i].expected;
    // Edge text should be gently softened, not erased or replaced with a band.
    const alpha = (pixels[i][2] - expected[2]) / (248 - expected[2]);
    assert.ok(alpha > 0.05 && alpha < 0.5, `文脈が薄すぎるか消えている: ${pixels[i]}`);
    for (let channel = 0; channel < 3; channel++) {
      const blended = expected[channel] * (1 - alpha) + 248 * alpha;
      assert.ok(Math.abs(pixels[i][channel] - blended) < 5,
        "重なり部分に別の本文が描画されている");
    }
  }
}

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

test("スクロール後も固定高さの各段が続きの本文で描画される", { timeout: 90_000 }, async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.RM_BROWSER_PATH || undefined,
  });
  try {
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
      await t.test(`${viewport.width}px の表示領域`, async () => {
        const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
        try {
          await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
          await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector("html.rm-active .rm-slot");
          await page.locator(".rm-source").evaluate((source, { rowHeight, rowCount }) => {
            // Solid alternating rows make a missing lower section unambiguous;
            // ordinary article whitespace must not hide a rendering regression.
            source.innerHTML = Array.from({ length: rowCount }, (_, i) =>
              `<div style="height:${rowHeight}px;margin:0;background:${i % 2 ? "#0044aa" : "#aa3300"}"></div>`,
            ).join("");
          }, { rowHeight: ROW_HEIGHT, rowCount: ROW_COUNT });
          await page.waitForFunction((length) =>
            parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-l")) === length,
          ROW_HEIGHT * ROW_COUNT);
          await settle(page);
          const initial = await layout(page);

          for (const y of [0, 37, 220, initial.h - 1, initial.h + 47, 2 * initial.h + 173,
            initial.l - initial.h - 17]) {
            await page.locator(".rm-viewport").evaluate((element, y) =>
              element.scrollTo({ top: y, left: 0, behavior: "instant" }), y);
            await settle(page);
            await assertPainted(page);
            await assertContextOverlap(page);
          }
          // Recycling and diagonal movement must paint the right source rows too.
          await page.locator(".rm-viewport").evaluate((element, p) =>
            element.scrollTo({ top: 220, left: 3 * p, behavior: "instant" }), initial.p);
          await settle(page);
          await assertPainted(page);
          await assertContextOverlap(page);
          await page.setViewportSize({ width: viewport.width, height: viewport.height - 130 });
          await page.waitForFunction(() =>
            parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-h"))
              === document.querySelector(".rm-viewport").clientHeight);
          await settle(page);
          await assertPainted(page);
          await assertContextOverlap(page);
        } catch (error) {
          const path = join(tmpdir(), `dispositif-reading-paint-${viewport.width}.png`);
          await page.screenshot({ path }).catch(() => {});
          t.diagnostic(`描画確認画像: ${path}`);
          throw error;
        } finally {
          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});
