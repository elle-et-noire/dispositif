import { toggleColumns } from "./column-controls.mjs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { ARTICLE_URL, launch, storeColumns } from "./browser.mjs";

const ROW_HEIGHT = 40;
const ROW_COUNT = 300;
const COLORS = [[170, 51, 0, 255], [0, 68, 170, 255]];

async function layout(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector(".cl-viewport");
    const plane = document.querySelector(".cl-plane");
    const rect = viewport.getBoundingClientRect();
    return {
      x: viewport.scrollLeft,
      y: viewport.scrollTop + parseFloat(document.querySelector(".cl-plane").dataset.clOriginY),
      nativeY: viewport.scrollTop,
      origin: Number(document.querySelector(".cl-plane").dataset.clOriginColumn),
      originY: parseFloat(document.querySelector(".cl-plane").dataset.clOriginY),
      maxX: viewport.scrollWidth - viewport.clientWidth,
      maxY: viewport.scrollHeight - viewport.clientHeight,
      h: viewport.clientHeight,
      p: parseFloat(plane.style.getPropertyValue("--cl-p")),
      edge: parseFloat(plane.style.getPropertyValue("--cl-edge")),
      leading: Number(plane.dataset.clLeading),
      l: parseFloat(plane.style.getPropertyValue("--cl-l")),
      top: rect.top,
      left: rect.left,
      width: viewport.clientWidth,
      slots: [...document.querySelectorAll(".cl-slot")].map((slot) => {
        const frame = slot.getBoundingClientRect();
        const style = getComputedStyle(slot.querySelector(".cl-content"));
        const textLeft = frame.left + parseFloat(style.paddingLeft);
        const textRight = frame.right - parseFloat(style.paddingRight);
        return {
          k: Number(slot.dataset.clK),
          paperTop: parseFloat(slot.querySelector(".cl-paper").style.top),
          paperHeight: parseFloat(slot.querySelector(".cl-paper").style.height),
          contentShift: parseFloat(slot.querySelector(".cl-content").style.translate.split(/\s+/)[1] ?? "0") + Number(slot.dataset.clK) * parseFloat(plane.style.getPropertyValue("--cl-h")) + Number(plane.dataset.clOriginY),
          left: frame.left,
          width: frame.width,
          top: frame.top,
          height: frame.height,
          visible: parseFloat(slot.querySelector(".cl-paper").style.height) > 1 && textRight > rect.left + 8 && textLeft < rect.left + viewport.clientWidth - 8,
          sampleX: Math.floor(Math.min(Math.max(textLeft + (textRight - textLeft) * 0.85, rect.left + 8),
            rect.left + viewport.clientWidth - 8)),
        };
      }),
    };
  });
}

async function readPixels(page, samples, captured) {
  await page.locator("astro-dev-toolbar").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  const screenshot = captured ?? await page.screenshot();
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
      const t = slot.k * state.h + state.y + y + 0.5 - state.top - slot.contentShift;
      samples.push({
        x: slot.sampleX,
        y,
        expected: t < 0 || t >= state.l || offset < slot.paperTop || offset >= slot.paperTop + slot.paperHeight ? [160, 186, 200, 255] : COLORS[Math.floor(t / ROW_HEIGHT) % 2],
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

async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

async function scrollLogical(page, column, y, phase = 0) {
  // Native limits describe the CURRENT row/column. Open the requested range
  // before moving along the other axis, as a reader would do.
  await page.locator(".cl-viewport").focus();
  await page.keyboard.press("Home");
  await settle(page);
  for (const axis of y >= 0 ? ["y", "x"] : ["x", "y"]) {
    await page.locator(".cl-viewport").evaluate((viewport, { column, y, phase, axis }) => {
      const style = document.querySelector(".cl-plane").style;
      const p = parseFloat(style.getPropertyValue("--cl-p"));
      const origin = Number(document.querySelector(".cl-plane").dataset.clOriginColumn);
      const originY = parseFloat(document.querySelector(".cl-plane").dataset.clOriginY);
      if (axis === "x") viewport.scrollLeft = (column - origin) * p + phase + Number(document.querySelector(".cl-plane").dataset.clLeading);
      else viewport.scrollTop = y - originY;
    }, { column, y, phase, axis });
    await settle(page);
  }
}

test("スクロール後も固定高さの各段が続きの本文で描画される", { timeout: 120_000 }, async (t) => {
  const browser = await launch(chromium);
  try {
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
      await t.test(`${viewport.width}px の表示領域`, async () => {
        const page = await browser.newPage({ reducedMotion: "reduce", viewport, deviceScaleFactor: 1 });
        try {
          await storeColumns(page, "multi");
          await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
          // Synthetic row pixels use a flat canvas; the real list backdrop is
          // exercised separately in column-background.browser.test.mjs.
          await page.addStyleTag({ content: "astro-dev-toolbar, .article-index-shell, .cl-backdrop { display: none !important; }" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector("html.cl-multi .cl-slot");
          await page.locator(".cl-source").evaluate((source, { rowHeight, rowCount }) => {
            // Solid alternating rows make a missing lower section unambiguous;
            // ordinary article whitespace must not hide a rendering regression.
            source.innerHTML = Array.from({ length: rowCount }, (_, i) =>
              `<div style="height:${rowHeight}px;margin:0;background:${i % 2 ? "#0044aa" : "#aa3300"}"></div>`,
            ).join("");
          }, { rowHeight: ROW_HEIGHT, rowCount: ROW_COUNT });
          await page.waitForFunction((length) =>
            parseFloat(document.querySelector(".cl-plane").style.getPropertyValue("--cl-l")) === length,
          ROW_HEIGHT * ROW_COUNT);
          await settle(page);
          const initial = await layout(page);

          // Partial sheets and side canvas are now reachable; horizontal
          // gestures must keep the current vertical text coordinate.
          for (const y of [0, Math.floor(initial.h / 2), initial.h - 1]) {
            await scrollLogical(page, 0, y);
            await page.locator(".cl-viewport").focus();
            await page.keyboard.press("ArrowLeft");
            await settle(page);
            const moved = await layout(page);
            assert.ok(Math.abs(moved.y - y) < 1);
            await page.mouse.move(moved.left + 100, moved.top + 100);
            await page.mouse.wheel(-180, 0);
            await settle(page);
            assert.ok(Math.abs((await layout(page)).y - y) < 1);
          }

          // The user's example: down one text advance, then left one column.
          await scrollLogical(page, 0, initial.h);
          await page.locator(".cl-viewport").focus();
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          const negative = await layout(page);
          assert.equal(Math.floor((negative.x - negative.leading + 0.01) / negative.p) + negative.origin, -1);
          assert.equal(negative.y, initial.h);
          await assertPainted(page);
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          const beforePageUp = await layout(page);
          await page.keyboard.press("PageUp");
          await settle(page);
          const afterPageUp = await layout(page);
          assert.ok(Math.abs(afterPageUp.x + afterPageUp.origin * afterPageUp.p - beforePageUp.x - beforePageUp.origin * beforePageUp.p) < 1);
          assert.ok(afterPageUp.y <= beforePageUp.y);

          await scrollLogical(page, 0, 2 * initial.h);
          await page.keyboard.press("ArrowLeft");
          await page.keyboard.press("ArrowLeft");
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          const two = await layout(page);
          assert.equal(two.x, 0);
          assert.ok(two.slots.some(slot => slot.visible && slot.k === -2));
          assert.equal(two.y, 2 * initial.h);
          await assertPainted(page);

          for (const y of [0, 37, 220, initial.h - 1, initial.h + 47, 2 * initial.h + 173,
            initial.l - initial.h - 17]) {
            await scrollLogical(page, 0, y);
            await assertPainted(page);
          }
          // Recycling and diagonal movement must paint the right source rows too.
          await scrollLogical(page, 3, 220);
          await assertPainted(page);

          const beforeWheel = await layout(page);
          await page.mouse.move(beforeWheel.left + 100, beforeWheel.top + 100);
          await page.mouse.wheel(97, 129);
          await page.waitForFunction(({ x, y }) => {
            const viewport = document.querySelector(".cl-viewport");
            return viewport.scrollLeft >= x + 96 && viewport.scrollTop >= y + 128;
          }, { x: beforeWheel.x, y: beforeWheel.nativeY });
          await settle(page);
          const afterWheel = await layout(page);
          assert.ok(Math.abs(afterWheel.x - beforeWheel.x - 97) < 1);
          assert.ok(Math.abs(afterWheel.y - beforeWheel.y - 129) < 1);
          await assertPainted(page);

          // Follow the same text far beyond the original first/last columns.
          // Earn the range before spending it at the article's leading edge.
          await scrollLogical(page, 0, 220, 73);
          const slotCount = (await layout(page)).slots.length;
          const origins = new Set();
          for (const [direction, cycles] of [[-1, 16], [1, 32]]) {
            for (let cycle = 0; cycle < cycles; cycle++) {
              for (const axis of direction < 0 ? ["y", "x"] : ["x", "y"]) {
                if (axis === "x") {
                  for (let i = 0; i < 8; i++) await page.keyboard.press(direction < 0 ? "ArrowLeft" : "ArrowRight");
                } else {
                  await page.locator(".cl-viewport").evaluate((viewport, direction) => {
                    const h = parseFloat(document.querySelector(".cl-plane").style.getPropertyValue("--cl-h"));
                    viewport.scrollBy({ top: -direction * 8 * h, behavior: "instant" });
                  }, direction);
                }
                await settle(page);
              }
              const moved = await layout(page);
              const k = Math.floor((moved.x - moved.leading + 0.01) / moved.p) + moved.origin;
              assert.ok(Math.abs(k * moved.h + moved.y - 220) < 1,
                `座標の組み替えで本文位置がずれた: ${JSON.stringify({ direction, cycle, k, x: moved.x, y: moved.y, h: moved.h, origin: moved.origin, originY: moved.originY })}`);
              assert.ok(Math.abs((moved.x - moved.leading) % moved.p - 73) < 1, "横移動が段境界に吸着した");
              assert.equal(moved.slots.length, slotCount, "移動するほど本文複製が増えた");
              origins.add(`${moved.origin}:${moved.originY}`);
              if (cycle % 8 === 0 || cycle === cycles - 1) await assertPainted(page);
            }
          }
          assert.ok(origins.size >= 4, "スクロール領域の端を越す移動を確認できない");

          // The final real page stays visible; no input can expose an empty one.
          for (const y of [0, Math.floor(initial.h / 2), initial.h, 2 * initial.h]) {
            await scrollLogical(page, 0, y);
            // The scrollbar spans a finite native window. Keep moving
            // across rebases until the logical article end is reached.
            let previous = -Infinity;
            for (let i = 0; i < 30; i++) {
              await page.locator(".cl-viewport").evaluate((v) => { v.scrollLeft = v.scrollWidth; });
              await settle(page);
              const s = await layout(page);
              const logicalX = s.x + s.origin * s.p;
              if (Math.abs(logicalX - previous) < 1) break;
              previous = logicalX;
            }
            const right = await layout(page);
            assert.equal(right.x, right.maxX);
            const visible = right.slots.filter((slot) => slot.visible);
            assert.ok(visible.every((slot) => slot.k * right.h + right.y < right.l));
            const last = visible.reduce((a, b) => a.k > b.k ? a : b);
            assert.ok(last.k * right.h + right.y < right.l);
            assert.ok(last.k * right.h + right.y + right.h >= right.l - 1);
            const exterior = right.left + right.width - last.left - last.width;
            assert.ok(exterior >= right.edge - 1 && exterior <= right.p + right.edge + 1,
              "末尾の余白が1段幅を超えた");
            await page.locator(".cl-viewport").focus();
            await page.keyboard.press("ArrowRight");
            await page.keyboard.press("ArrowRight");
            await page.mouse.move(right.left + right.width - 100, right.top + 100);
            await page.mouse.wheel(250, 0);
            await settle(page);
            const stopped = await layout(page);
            assert.equal(stopped.x, stopped.maxX);
            assert.ok(Math.abs(stopped.y - right.y) < 1);
            assert.equal(Math.floor((stopped.x - stopped.leading + 0.01) / stopped.p) + stopped.origin,
              Math.floor((right.x - right.leading + 0.01) / right.p) + right.origin);
            await assertPainted(page);

            // At the last partial sheet, further vertical input must not grow
            // the range or move x. Repeated
            // wheel, scrollbar, and keyboard input cannot send the tail upward.
            await page.locator(".cl-viewport").evaluate((v) => { v.scrollTop = v.scrollHeight; });
            await settle(page);
            const atBottom = await layout(page);
            const bottomColumn = Math.max(...atBottom.slots.filter((slot) => slot.visible).map((slot) => slot.k));
            assert.ok(bottomColumn * atBottom.h + atBottom.y < atBottom.l);
            assert.ok(bottomColumn * atBottom.h + atBottom.y + atBottom.h >= atBottom.l - 1);
            assert.ok(Math.abs(atBottom.nativeY - atBottom.maxY) < 1);
            for (const key of ["PageDown", " "]) {
              await page.keyboard.press(key);
              await settle(page);
              const blocked = await layout(page);
              assert.ok(Math.abs(blocked.y - atBottom.y) < 1, "キー操作で本文末尾が上へ抜けた");
              assert.ok(Math.abs(blocked.x + blocked.origin * blocked.p
                - atBottom.x - atBottom.origin * atBottom.p) < 1);
            }
            await page.mouse.wheel(0, 600);
            await page.locator(".cl-viewport").evaluate((v) => { v.scrollTop = 1e9; });
            await settle(page);
            const blocked = await layout(page);
            assert.ok(Math.abs(blocked.y - atBottom.y) < 1, "本文末尾の後ろに空白が増えた");
            await assertPainted(page);
            await page.mouse.wheel(0, -160);
            await settle(page);
            assert.ok((await layout(page)).y < atBottom.y - 150, "末尾から前の本文へ戻れない");
          }

          // Native edges either rebase or stop at the article's beginning.
          for (const edge of ["left", "right", "top", "bottom"]) {
            await page.locator(".cl-viewport").evaluate((viewport, edge) => {
              viewport.scrollTo({
                left: edge === "left" ? 0 : edge === "right" ? viewport.scrollWidth : viewport.scrollLeft,
                top: edge === "top" ? 0 : edge === "bottom" ? viewport.scrollHeight : viewport.scrollTop,
                behavior: "instant",
              });
            }, edge);
            await settle(page);
            const actual = await layout(page);
            assert.ok(actual.slots.some(slot => slot.visible && slot.k * actual.h + actual.y < actual.l && slot.k * actual.h + actual.y + actual.h > 0));
            assert.ok(actual.slots.filter((slot) => slot.visible).every((slot) => slot.k * actual.h + actual.y < actual.l));
            await assertPainted(page);
          }
          // Home/End work regardless of how far away the virtual origin is.
          await page.locator(".cl-viewport").focus();
          for (const key of ["Home", "End"]) {
            await page.keyboard.press(key);
            await settle(page);
            const state = await layout(page);
            const t = (Math.floor((state.x - state.leading + 0.01) / state.p) + state.origin) * state.h + state.y;
            if (key === "Home") assert.ok(Math.abs(t) < 1);
            else assert.ok(state.slots.filter((slot) => slot.visible).some((slot) => {
              const py = state.l - 1 - slot.k * state.h - state.y;
              return py >= 0 && py < state.h;
            }), "Endで本文末尾が表示されない");
            await assertPainted(page);
          }
          await page.setViewportSize({ width: viewport.width, height: viewport.height - 130 });
          await page.waitForFunction(() =>
            parseFloat(document.querySelector(".cl-plane").style.getPropertyValue("--cl-h"))
              === document.querySelector(".cl-viewport").clientHeight);
          await settle(page);
          await assertPainted(page);
        } catch (error) {
          const path = join(tmpdir(), `dispositif-column-paint-${viewport.width}.png`);
          await page.screenshot({ path }).catch(() => {});
          t.diagnostic(`描画確認画像: ${path}`);
          throw error;
        } finally {
          await page.close();
        }
      });
    }

    await t.test("有限なスクロール面より長い記事でもハッシュとHome/Endが使える", async () => {
      const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 900, height: 800 } });
      try {
        await storeColumns(page, "multi");
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".cl-slot");
        await page.locator(".cl-source").evaluate((source) => {
          source.innerHTML = '<h2 id="cl-far-start" style="margin:0;height:40px">先頭</h2><div style="height:1000000px"></div><h2 id="cl-far-end" style="margin:0;height:1000px;background:#0044aa">遠い見出し</h2>';
        });
        await page.waitForFunction(() =>
          parseFloat(document.querySelector(".cl-plane").style.getPropertyValue("--cl-l")) > 1000000);
        await settle(page);
        assert.ok(await page.locator(".cl-viewport").evaluate((v) => v.scrollHeight <= 128 * v.clientHeight + 1),
          "本文の長さに応じてスクロール面まで大きくなった");
        const count = await page.locator(".cl-content").count();
        await page.evaluate(() => { location.hash = "cl-far-end"; });
        await page.waitForFunction(() => {
          const v = document.querySelector(".cl-viewport"), s = document.querySelector(".cl-plane").style;
          const h = parseFloat(s.getPropertyValue("--cl-h"));
          const target = document.getElementById("cl-far-end").getBoundingClientRect().top
            - document.querySelector(".cl-source").getBoundingClientRect().top;
          const vr = v.getBoundingClientRect();
          return [...document.querySelectorAll(".cl-slot")].some((slot) => {
            const r = slot.getBoundingClientRect();
            const py = target - Number(slot.dataset.clK) * h - v.scrollTop - parseFloat(document.querySelector(".cl-plane").dataset.clOriginY);
            return r.left >= vr.left - 1 && r.right <= vr.right + 1 && py >= -1 && py < v.clientHeight;
          });
        });
        await settle(page);
        const atHash = await layout(page);
        const headingT = await page.locator("#cl-far-end").evaluate((heading) =>
          heading.getBoundingClientRect().top - document.querySelector(".cl-source").getBoundingClientRect().top);
        const target = atHash.slots.filter((slot) => slot.visible).map((slot) => ({
          ...slot, py: headingT - slot.k * atHash.h - atHash.y,
        })).find((slot) => slot.py >= 0 && slot.py < atHash.h - 23);
        assert.ok(target, "遠い見出しが可視段の中にない");
        const [pixel] = await readPixels(page, [{
          x: target.sampleX, y: Math.floor(atHash.top + Math.min(target.py + 111, atHash.h - 23)),
        }]);
        assert.deepEqual(pixel, [0, 68, 170, 255], "遠い見出しの実際の描画が空白になった");
        await page.locator(".cl-viewport").focus();
        for (const key of ["Home", "End"]) {
          await page.keyboard.press(key);
          await settle(page);
          const s = await layout(page);
          const t = (Math.floor((s.x - s.leading + 0.01) / s.p) + s.origin) * s.h + s.y;
          if (key === "Home") assert.ok(Math.abs(t) < 1);
          else assert.ok(s.slots.filter((slot) => slot.visible).some((slot) => {
            const py = s.l - 1 - slot.k * s.h - s.y;
            return py >= 0 && py < s.h;
          }));
          assert.equal(await page.locator(".cl-content").count(), count);
        }
      } finally { await page.close(); }
    });

    await t.test("末尾直前のハッシュ見出しは下端の内側に収まり、リサイズ後も末尾で止まる", async () => {
      for (const width of [1600, 390]) {
        const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width, height: 900 } });
        try {
          await storeColumns(page, "multi");
          await page.goto(ARTICLE_URL);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector(".cl-slot");
          await page.locator(".cl-source").evaluate((source) => {
            source.innerHTML = '<div style="height:20000px"></div><h2 id="cl-tail-marker" data-test-tail style="height:80px;margin:0;background:#0044aa">末尾</h2>';
          });
          await page.waitForFunction(() => document.querySelector(".cl-plane").style.getPropertyValue("--cl-l") === "20080px");
          await settle(page);
          await page.evaluate(() => { location.hash = "cl-tail-marker"; });
          await settle(page);
          const state = await layout(page);
          const markers = await page.locator(".cl-slot [data-test-tail]").evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              return { x: r.left, y: r.top, width: r.width, bottom: r.bottom };
            }));
          const marker = markers.find((r) => r.x >= state.left - 1
            && r.x + r.width <= state.left + state.width + 1
            && r.y >= state.top && r.bottom <= state.top + state.h + 1);
          assert.ok(marker, "末尾直前の見出しが枠から消えた");
          const [pixel] = await readPixels(page, [{
            x: Math.floor(marker.x + marker.width * 0.85), y: Math.floor(marker.y + 20),
          }]);
          assert.deepEqual(pixel, [0, 68, 170, 255]);
          await page.setViewportSize({ width, height: 760 });
          await settle(page);
          await page.locator(".cl-viewport").focus();
          await page.keyboard.press("End");
          await settle(page);
          const resized = await layout(page);
          const last = Math.max(...resized.slots.filter((slot) => slot.visible).map((slot) => slot.k));
          assert.ok(Math.abs(last * resized.h + resized.y + resized.h - resized.l) < 1, JSON.stringify({ last, resized }));
          await page.keyboard.press("PageDown");
          await settle(page);
          const afterPage = await layout(page);
          const logicalX = resized.x + resized.origin * resized.p - resized.leading;
          const w = resized.slots[0].width;
          const extra = Math.min(resized.p, Math.max(0, resized.width - w - 2 * resized.edge));
          const boundaryColumn = Math.ceil((logicalX + resized.width - w - 2 * resized.edge - extra) / resized.p);
          const stop = resized.l - resized.h - boundaryColumn * resized.h;
          assert.ok(Math.abs(afterPage.y - stop) < 1, "縦操作専用の余白の終点で止まらない");
          assert.ok(Math.abs(afterPage.x + afterPage.origin * afterPage.p - afterPage.leading - logicalX) < 1,
            "End後の縦操作で横位置が動いた");
          await page.keyboard.press("PageDown"); await settle(page);
          assert.equal((await layout(page)).y, afterPage.y);
        } finally { await page.close(); }
      }
    });

    await t.test("画面より短い記事は1段で止まり、白紙の段を作らない", async () => {
      const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1600, height: 900 } });
      try {
        await storeColumns(page, "multi");
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".cl-slot");
        await page.locator(".cl-source").evaluate((source) => {
          source.innerHTML = '<div style="height:200px;background:#0044aa">短い記事</div>';
        });
        await page.waitForFunction(() => parseFloat(document.querySelector(".cl-plane").style.getPropertyValue("--cl-l")) === 200);
        await settle(page);
        await page.locator(".cl-viewport").focus();
        await page.keyboard.press("ArrowRight");
        await page.locator(".cl-viewport").evaluate((v) => { v.scrollLeft = 1000000; });
        await settle(page);
        assert.equal((await layout(page)).maxX, (await layout(page)).leading);
        assert.equal((await layout(page)).x, (await layout(page)).maxX);
        assert.equal(await page.locator(".cl-slot").count(), 1);
        await page.keyboard.press("End");
        await page.keyboard.press("PageDown");
        await page.locator(".cl-viewport").evaluate((v) => { v.scrollTop = 1e9; });
        await settle(page);
        assert.equal((await layout(page)).y, 0);
        assert.equal((await layout(page)).maxY, 0);
      } finally { await page.close(); }
    });

    await t.test("印刷時と表示枠を減らしたときも元本文を残し、1段へ戻すと段組みのスタイルを外す", async () => {
      const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
      try {
        await storeColumns(page, "multi");
        await page.goto(ARTICLE_URL);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector(".cl-slot .cl-source");
        const original = await page.locator(".cl-source").elementHandle();
        // Leave the original's column, so that it is outside the wanted range
        // when the frames are reduced below.
        await page.locator(".cl-viewport").focus();
        await page.keyboard.press("ArrowRight");
        await settle(page);
        await page.emulateMedia({ media: "print" });
        await page.waitForSelector(".cl-layout > .cl-source", { state: "attached" });
        assert.ok(await page.locator(".cl-source").isVisible(), "印刷時に元本文が消えた");
        await page.emulateMedia({ media: "screen" });
        await page.waitForSelector(".cl-slot .cl-source");
        await settle(page);
        const frames = await page.locator(".cl-slot").count();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction((frames) => document.querySelectorAll(".cl-slot").length < frames, frames);
        assert.ok(await original.evaluate((source) => source.isConnected && !!source.closest(".cl-slot")));
        // Shrink to a single short column while the original's old column is
        // outside the wanted range. Its node and IDs must survive pool removal.
        await page.locator(".cl-source").evaluate((source) => {
          source.innerHTML = '<div style="height:200px">短い記事</div>';
        });
        await page.waitForFunction(() => document.querySelectorAll(".cl-slot").length === 1);
        assert.ok(await original.evaluate((source) => source.isConnected && !!source.closest(".cl-slot")));
        for (let i = 0; i < 2; i++) {
          await toggleColumns(page);
          assert.ok(await original.evaluate((source) => source.parentElement.classList.contains("cl-layout")
            && !source.style.width && !source.style.left && !source.style.translate));
          await toggleColumns(page);
          await page.waitForSelector(".cl-slot .cl-source");
        }
      } finally { await page.close(); }
    });

    await t.test("数式記事の高速移動で本文全体のスタイルを再計算しない", async (t) => {
      const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1600, height: 900 } });
      try {
        await storeColumns(page, "multi");
        await page.goto(ARTICLE_URL);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector(".cl-content mjx-container");
        await page.locator("astro-dev-toolbar").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
        await settle(page);
        const initial = await layout(page);
        const sourceElements = await page.locator(".cl-source").evaluate((source) => source.getElementsByTagName("*").length);
        const client = await page.context().newCDPSession(page);
        const events = [];
        client.on("Tracing.dataCollected", ({ value }) => events.push(...value));
        const traced = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
        await client.send("Tracing.start", { categories: "devtools.timeline", transferMode: "ReportEvents" });
        await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        for (const distance of [-8000, 8000]) {
          await client.send("Input.synthesizeScrollGesture", {
            x: initial.left + 100, y: initial.top + 150,
            xDistance: distance, yDistance: 0, speed: 12000,
            gestureSourceType: "mouse", preventFling: true,
          });
        }
        await client.send("Tracing.end");
        await traced;
        const restyles = events.filter((event) => event.name === "UpdateLayoutTree" && event.ph === "X");
        const elements = restyles.map((event) => event.args?.elementCount);
        t.diagnostic(`CPU 4倍減速: スタイル再計算 ${restyles.length}回 / `
          + `${(restyles.reduce((sum, event) => sum + event.dur, 0) / 1000).toFixed(1)}ms / `
          + `最大 ${Math.max(...elements)}要素（本文 ${sourceElements}要素）`);
        assert.ok(restyles.length > 0 && elements.every(Number.isFinite), "スタイル再計算の要素数を記録できない");
        // Count elements, not milliseconds, so that a slow CI runner does not
        // fail the test. Mounting a fragment into a new column restyles that
        // fragment (at most about 55% of the article body). The former bug, an
        // inherited value changing on an ancestor of the article, restyled the
        // whole document (more than the article body) on every update.
        assert.ok(Math.max(...elements) < sourceElements,
          "段の移動で数式本文全体のスタイル再計算が発生している");
        assert.equal(await page.locator(".cl-slot").count(), initial.slots.length);
        await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await client.detach();
      } finally { await page.close(); }
    });

    await t.test("横のホイール操作で見える段を欠かさず、移動量と数式の横スクロールを保ち、描画更新の停止中も動く", async () => {
      // Every column that overlaps the viewport has a frame showing it.
      const assertVisibleMounted = async (page) => {
        const current = await layout(page);
        const first = Math.floor((current.x - current.leading + 0.01) / current.p) + current.origin;
        const last = Math.floor((current.x - current.leading + current.width - 0.01) / current.p) + current.origin;
        const mounted = new Set(current.slots.map((slot) => slot.k));
        for (let k = first; k <= last; k++) assert.ok(mounted.has(k), "可視段が用意されていない");
      };
      for (const width of [1600, 390]) {
        const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width, height: 900 } });
        try {
          await storeColumns(page, "multi");
          await page.goto(ARTICLE_URL);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector(".cl-slot");
          await page.locator(".cl-source").evaluate((source) => {
            source.innerHTML = '<div style="height:300000px;background:#0044aa"></div>';
          });
          await page.waitForFunction(() => document.querySelector(".cl-plane").style.getPropertyValue("--cl-l") === "300000px");
          await settle(page);
          const initial = await layout(page);
          await page.mouse.move(initial.left + 100, initial.top + 150);
          for (let i = 0; i < 20; i++) {
            await page.mouse.wheel((i < 12 ? 1 : -1) * 1.7 * initial.p, 0);
            await settle(page);
            await assertVisibleMounted(page);
          }
          // Large wheel deltas keep their full logical distance across a rebase.
          const beforeJump = await layout(page);
          await page.mouse.wheel(20 * beforeJump.p, 0);
          await settle(page);
          const afterJump = await layout(page);
          assert.ok(Math.abs((afterJump.x + afterJump.origin * afterJump.p)
            - (beforeJump.x + beforeJump.origin * beforeJump.p) - 20 * beforeJump.p) < 1,
          "高速入力の移動距離がスクロール面の端で切り捨てられた");
          await page.mouse.wheel(-20 * beforeJump.p, 0);
          await settle(page);
          // A large wheel gesture over a formula/code-like scroller must still
          // belong to that element, rather than jumping the article.
          await page.locator(".cl-viewport").focus();
          await page.keyboard.press("Home");
          await page.locator(".cl-source > div").evaluate((body) => {
            body.innerHTML = '<div data-test-scroll style="height:80px;width:120px;overflow:auto"><div style="width:30000px;height:40px"></div></div>';
          });
          await settle(page);
          const nested = page.locator('.cl-slot[data-cl-k="0"] [data-test-scroll]');
          await nested.waitFor();
          const box = await nested.boundingBox();
          await page.mouse.move(box.x + 40, box.y + 40);
          await page.mouse.wheel(4000, 0);
          await page.waitForFunction(() => document.querySelector('.cl-slot[data-cl-k="0"] [data-test-scroll]').scrollLeft > 3000);
          const nestedState = await layout(page);
          assert.ok(Math.abs(nestedState.x + nestedState.origin * nestedState.p - nestedState.leading) < 1, "数式やコードの横スクロールを奪った");
          await page.mouse.move(initial.left + 100, initial.top + 150);
          // No offscreen overscan: native motion still works with JS updates
          // suspended, but the newly exposed text is mounted when JS resumes.
          const originalRAF = await page.evaluateHandle(() => window.requestAnimationFrame);
          await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
          for (const delta of [initial.p * 1.7, -initial.p * 1.7]) {
            const before = await layout(page);
            await page.mouse.wheel(delta, 0);
            // Wait for the native scroll itself, not a fixed time: a slow CI
            // runner may apply it later. Poll with timers, since rAF is stubbed.
            await page.waitForFunction((target) => Math.abs(document.querySelector(".cl-viewport").scrollLeft - target) < 1,
              before.x + delta, { polling: 20, timeout: 3000 }).catch(() => {});
            const state = await layout(page);
            assert.ok(Math.abs(state.x - before.x - delta) < 1, "JSの更新待ちで高速スクロールが止まった");
          }
          await page.evaluate((raf) => { window.requestAnimationFrame = raf; }, originalRAF);
          // Trigger a new scroll after restoring rAF to resume the reader.
          await page.mouse.wheel(initial.p * 1.7, 0);
          await settle(page);
          await assertVisibleMounted(page);
          await originalRAF.dispose();
        } finally { await page.close(); }
      }
    });
  } finally {
    await browser.close();
  }
});
