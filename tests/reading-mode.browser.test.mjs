import { toggleReadingMode } from "./reading-controls.mjs";
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
      y: viewport.scrollTop + parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY),
      nativeY: viewport.scrollTop,
      origin: Number(document.querySelector(".rm-plane").dataset.rmOriginColumn),
      originY: parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY),
      maxX: viewport.scrollWidth - viewport.clientWidth,
      maxY: viewport.scrollHeight - viewport.clientHeight,
      h: viewport.clientHeight,
      step: parseFloat(plane.style.getPropertyValue("--rm-step")),
      p: parseFloat(plane.style.getPropertyValue("--rm-p")),
      edge: parseFloat(plane.style.getPropertyValue("--rm-edge")),
      leading: Number(plane.dataset.rmLeading),
      l: parseFloat(plane.style.getPropertyValue("--rm-l")),
      top: rect.top,
      left: rect.left,
      width: viewport.clientWidth,
      slots: [...document.querySelectorAll(".rm-slot")].map((slot) => {
        const frame = slot.getBoundingClientRect();
        const style = getComputedStyle(slot.querySelector(".rm-content"));
        const textLeft = frame.left + parseFloat(style.paddingLeft);
        const textRight = frame.right - parseFloat(style.paddingRight);
        return {
          k: Number(slot.dataset.rmK),
          paperTop: parseFloat(slot.querySelector(".rm-paper").style.top),
          paperHeight: parseFloat(slot.querySelector(".rm-paper").style.height),
          contentShift: parseFloat(slot.querySelector(".rm-content").style.translate.split(/\s+/)[1] ?? "0") + Number(slot.dataset.rmK) * parseFloat(plane.style.getPropertyValue("--rm-step")) + Number(plane.dataset.rmOriginY),
          left: frame.left,
          width: frame.width,
          top: frame.top,
          height: frame.height,
          visible: parseFloat(slot.querySelector(".rm-paper").style.height) > 1 && textRight > rect.left + 8 && textLeft < rect.left + viewport.clientWidth - 8,
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
      const t = slot.k * state.step + state.y + y + 0.5 - state.top - slot.contentShift;
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

async function assertContextOverlap(page) {
  const state = await layout(page);
  const overlap = state.h - state.step;
  assert.ok(overlap > 0 && overlap <= state.h / 4);
  const visible = state.slots.filter((slot) => slot.visible);
  const samples = [];
  const sample = (slot, offset) => {
    const y = Math.floor(state.top + offset);
    const t = slot.k * state.step + state.y + y + 0.5 - state.top - slot.contentShift;
    if (t < 0 || t >= state.l || offset < slot.paperTop || offset >= slot.paperTop + slot.paperHeight) return;
    samples.push({ x: slot.sampleX, y,
      expected: COLORS[Math.floor(t / ROW_HEIGHT) % 2] });
    return t;
  };
  for (const slot of visible) {
    // The edge taper translates surviving duplicate context with its sheet.
    // Matching viewport-edge samples apply to unchanged interior windows.
    if (Math.abs(slot.contentShift) > .01) continue;
    const from = slot.k * state.step + state.y;
    const bottom = from + state.h < state.l ? sample(slot, state.step + overlap / 2) : undefined;
    if (from > 0) sample(slot, overlap / 2);
    const next = visible.find((other) => other.k === slot.k + 1);
    if (next && bottom !== undefined && Math.abs(slot.contentShift) < .01 && Math.abs(next.contentShift) < .01) {
      const top = next.k * state.step + state.y
        + Math.floor(state.top + overlap / 2) + 0.5 - state.top - next.contentShift;
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

async function scrollLogical(page, column, y, phase = 0) {
  // Native limits describe the CURRENT row/column. Open the requested range
  // before moving along the other axis, as a reader would do.
  await page.locator(".rm-viewport").focus();
  await page.keyboard.press("Home");
  await settle(page);
  for (const axis of y >= 0 ? ["y", "x"] : ["x", "y"]) {
    await page.locator(".rm-viewport").evaluate((viewport, { column, y, phase, axis }) => {
      const style = document.querySelector(".rm-plane").style;
      const p = parseFloat(style.getPropertyValue("--rm-p"));
      const origin = Number(document.querySelector(".rm-plane").dataset.rmOriginColumn);
      const originY = parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY);
      if (axis === "x") viewport.scrollLeft = (column - origin) * p + phase + Number(document.querySelector(".rm-plane").dataset.rmLeading);
      else viewport.scrollTop = y - originY;
    }, { column, y, phase, axis });
    await settle(page);
  }
}

test("スクロール後も固定高さの各段が続きの本文で描画される", { timeout: 120_000 }, async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.RM_BROWSER_PATH || undefined,
  });
  try {
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
      await t.test(`${viewport.width}px の表示領域`, async () => {
        const page = await browser.newPage({ reducedMotion: "reduce", viewport, deviceScaleFactor: 1 });
        try {
          await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
          await page.goto(ARTICLE_URL, { waitUntil: "domcontentloaded" });
          // Synthetic row pixels use a flat canvas; the real list backdrop is
          // exercised separately in reading-background.browser.test.mjs.
          await page.addStyleTag({ content: "astro-dev-toolbar, .article-index-shell, .rm-backdrop { display: none !important; }" });
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

          // Partial sheets and side canvas are now reachable; horizontal
          // gestures must keep the current vertical text coordinate.
          for (const y of [0, Math.floor(initial.step / 2), initial.step - 1]) {
            await scrollLogical(page, 0, y);
            await page.locator(".rm-viewport").focus();
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
          await scrollLogical(page, 0, initial.step);
          await page.locator(".rm-viewport").focus();
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          const negative = await layout(page);
          assert.equal(Math.floor((negative.x - negative.leading + 0.01) / negative.p) + negative.origin, -1);
          assert.equal(negative.y, initial.step);
          await assertPainted(page);
          await assertContextOverlap(page);
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          const beforePageUp = await layout(page);
          await page.keyboard.press("PageUp");
          await settle(page);
          const afterPageUp = await layout(page);
          assert.ok(Math.abs(afterPageUp.x + afterPageUp.origin * afterPageUp.p - beforePageUp.x - beforePageUp.origin * beforePageUp.p) < 1);
          assert.ok(afterPageUp.y <= beforePageUp.y);

          await scrollLogical(page, 0, 2 * initial.step);
          await page.keyboard.press("ArrowLeft");
          await page.keyboard.press("ArrowLeft");
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          const two = await layout(page);
          assert.equal(two.x, 0);
          assert.ok(two.slots.some(slot => slot.visible && slot.k === -2));
          assert.equal(two.y, 2 * initial.step);
          await assertPainted(page);

          for (const y of [0, 37, 220, initial.h - 1, initial.h + 47, 2 * initial.h + 173,
            initial.l - initial.h - 17]) {
            await scrollLogical(page, 0, y);
            await assertPainted(page);
            await assertContextOverlap(page);
          }
          // Recycling and diagonal movement must paint the right source rows too.
          await scrollLogical(page, 3, 220);
          await assertPainted(page);
          await assertContextOverlap(page);

          const beforeWheel = await layout(page);
          await page.mouse.move(beforeWheel.left + 100, beforeWheel.top + 100);
          await page.mouse.wheel(97, 129);
          await page.waitForFunction(({ x, y }) => {
            const viewport = document.querySelector(".rm-viewport");
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
                  await page.locator(".rm-viewport").evaluate((viewport, direction) => {
                    const step = parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-step"));
                    viewport.scrollBy({ top: -direction * 8 * step, behavior: "instant" });
                  }, direction);
                }
                await settle(page);
              }
              const moved = await layout(page);
              const k = Math.floor((moved.x - moved.leading + 0.01) / moved.p) + moved.origin;
              assert.ok(Math.abs(k * moved.step + moved.y - 220) < 1,
                `座標の組み替えで本文位置がずれた: ${JSON.stringify({ direction, cycle, k, x: moved.x, y: moved.y, step: moved.step, origin: moved.origin, originY: moved.originY })}`);
              assert.ok(Math.abs((moved.x - moved.leading) % moved.p - 73) < 1, "横移動が段境界に吸着した");
              assert.equal(moved.slots.length, slotCount, "移動するほど本文複製が増えた");
              origins.add(`${moved.origin}:${moved.originY}`);
              if (cycle % 8 === 0 || cycle === cycles - 1) await assertPainted(page);
            }
          }
          assert.ok(origins.size >= 4, "スクロール領域の端を越す移動を確認できない");

          // The final real page stays visible; no input can expose an empty one.
          for (const y of [0, Math.floor(initial.step / 2), initial.step, 2 * initial.step]) {
            await scrollLogical(page, 0, y);
            // The scrollbar spans a finite native window. Keep moving
            // across rebases until the logical article end is reached.
            let previous = -Infinity;
            for (let i = 0; i < 30; i++) {
              await page.locator(".rm-viewport").evaluate((v) => { v.scrollLeft = v.scrollWidth; });
              await settle(page);
              const s = await layout(page);
              const logicalX = s.x + s.origin * s.p;
              if (Math.abs(logicalX - previous) < 1) break;
              previous = logicalX;
            }
            const right = await layout(page);
            assert.equal(right.x, right.maxX);
            const visible = right.slots.filter((slot) => slot.visible);
            assert.ok(visible.every((slot) => slot.k * right.step + right.y < right.l));
            const last = visible.reduce((a, b) => a.k > b.k ? a : b);
            assert.ok(last.k * right.step + right.y < right.l);
            assert.ok(last.k * right.step + right.y + right.step >= right.l - 1);
            const exterior = right.left + right.width - last.left - last.width;
            assert.ok(exterior >= right.edge - 1 && exterior <= right.p + right.edge + 1,
              "末尾の余白が1段幅を超えた");
            await page.locator(".rm-viewport").focus();
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
            await page.locator(".rm-viewport").evaluate((v) => { v.scrollTop = v.scrollHeight; });
            await settle(page);
            const atBottom = await layout(page);
            const bottomColumn = Math.max(...atBottom.slots.filter((slot) => slot.visible).map((slot) => slot.k));
            assert.ok(bottomColumn * atBottom.step + atBottom.y < atBottom.l);
            assert.ok(bottomColumn * atBottom.step + atBottom.y + atBottom.h >= atBottom.l - 1);
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
            await page.locator(".rm-viewport").evaluate((v) => { v.scrollTop = 1e9; });
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
            await page.locator(".rm-viewport").evaluate((viewport, edge) => {
              viewport.scrollTo({
                left: edge === "left" ? 0 : edge === "right" ? viewport.scrollWidth : viewport.scrollLeft,
                top: edge === "top" ? 0 : edge === "bottom" ? viewport.scrollHeight : viewport.scrollTop,
                behavior: "instant",
              });
            }, edge);
            await settle(page);
            const actual = await layout(page);
            assert.ok(actual.slots.some(slot => slot.visible && slot.k * actual.step + actual.y < actual.l && slot.k * actual.step + actual.y + actual.h > 0));
            assert.ok(actual.slots.filter((slot) => slot.visible).every((slot) => slot.k * actual.step + actual.y < actual.l));
            await assertPainted(page);
          }
          // Home/End work regardless of how far away the virtual origin is.
          await page.locator(".rm-viewport").focus();
          for (const key of ["Home", "End"]) {
            await page.keyboard.press(key);
            await settle(page);
            const state = await layout(page);
            const t = (Math.floor((state.x - state.leading + 0.01) / state.p) + state.origin) * state.step + state.y;
            if (key === "Home") assert.ok(Math.abs(t) < 1);
            else assert.ok(state.slots.filter((slot) => slot.visible).some((slot) => {
              const py = state.l - 1 - slot.k * state.step - state.y;
              return py >= 0 && py < state.h;
            }), "Endで本文末尾が表示されない");
            await assertPainted(page);
          }
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

    await t.test("有限なスクロール面より長い記事でもハッシュとHome/Endが使える", async () => {
      const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 900, height: 800 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".rm-slot");
        await page.locator(".rm-source").evaluate((source) => {
          source.innerHTML = '<h2 id="rm-far-start" style="margin:0;height:40px">先頭</h2><div style="height:1000000px"></div><h2 id="rm-far-end" style="margin:0;height:1000px;background:#0044aa">遠い見出し</h2>';
        });
        await page.waitForFunction(() =>
          parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-l")) > 1000000);
        await settle(page);
        assert.ok(await page.locator(".rm-viewport").evaluate((v) => v.scrollHeight <= 128 * v.clientHeight + 1),
          "本文の長さに応じてスクロール面まで大きくなった");
        const count = await page.locator(".rm-content").count();
        await page.evaluate(() => { location.hash = "rm-far-end"; });
        await page.waitForFunction(() => {
          const v = document.querySelector(".rm-viewport"), s = document.querySelector(".rm-plane").style;
          const step = parseFloat(s.getPropertyValue("--rm-step"));
          const target = document.getElementById("rm-far-end").getBoundingClientRect().top
            - document.querySelector(".rm-source").getBoundingClientRect().top;
          const vr = v.getBoundingClientRect();
          return [...document.querySelectorAll(".rm-slot")].some((slot) => {
            const r = slot.getBoundingClientRect();
            const py = target - Number(slot.dataset.rmK) * step - v.scrollTop - parseFloat(document.querySelector(".rm-plane").dataset.rmOriginY);
            return r.left >= vr.left - 1 && r.right <= vr.right + 1 && py >= -1 && py < v.clientHeight;
          });
        });
        await settle(page);
        const atHash = await layout(page);
        const headingT = await page.locator("#rm-far-end").evaluate((heading) =>
          heading.getBoundingClientRect().top - document.querySelector(".rm-source").getBoundingClientRect().top);
        const target = atHash.slots.filter((slot) => slot.visible).map((slot) => ({
          ...slot, py: headingT - slot.k * atHash.step - atHash.y,
        })).find((slot) => slot.py >= 0 && slot.py < atHash.h - 23);
        assert.ok(target, "遠い見出しが可視段の中にない");
        const [pixel] = await readPixels(page, [{
          x: target.sampleX, y: Math.floor(atHash.top + Math.min(target.py + 111, atHash.h - 23)),
        }]);
        assert.deepEqual(pixel, [0, 68, 170, 255], "遠い見出しの実際の描画が空白になった");
        await page.locator(".rm-viewport").focus();
        for (const key of ["Home", "End"]) {
          await page.keyboard.press(key);
          await settle(page);
          const s = await layout(page);
          const t = (Math.floor((s.x - s.leading + 0.01) / s.p) + s.origin) * s.step + s.y;
          if (key === "Home") assert.ok(Math.abs(t) < 1);
          else assert.ok(s.slots.filter((slot) => slot.visible).some((slot) => {
            const py = s.l - 1 - slot.k * s.step - s.y;
            return py >= 0 && py < s.h;
          }));
          assert.equal(await page.locator(".rm-content").count(), count);
        }
      } finally { await page.close(); }
    });

    await t.test("末尾直前のハッシュ見出しは下端の内側に収まり、リサイズ後も末尾で止まる", async () => {
      for (const width of [1600, 390]) {
        const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width, height: 900 } });
        try {
          await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
          await page.goto(ARTICLE_URL);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector(".rm-slot");
          await page.locator(".rm-source").evaluate((source) => {
            source.innerHTML = '<div style="height:20000px"></div><h2 id="rm-tail-marker" data-test-tail style="height:80px;margin:0;background:#0044aa">末尾</h2>';
          });
          await page.waitForFunction(() => document.querySelector(".rm-plane").style.getPropertyValue("--rm-l") === "20080px");
          await settle(page);
          await page.evaluate(() => { location.hash = "rm-tail-marker"; });
          await settle(page);
          const state = await layout(page);
          const markers = await page.locator(".rm-slot [data-test-tail]").evaluateAll((nodes) =>
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
          await page.locator(".rm-viewport").focus();
          await page.keyboard.press("End");
          await settle(page);
          const resized = await layout(page);
          const last = Math.max(...resized.slots.filter((slot) => slot.visible).map((slot) => slot.k));
          assert.ok(Math.abs(last * resized.step + resized.y + resized.h - resized.l) < 1, JSON.stringify({ last, resized }));
          await page.keyboard.press("PageDown");
          await settle(page);
          const afterPage = await layout(page);
          const logicalX = resized.x + resized.origin * resized.p - resized.leading;
          const w = resized.slots[0].width;
          const extra = Math.min(resized.p, Math.max(0, resized.width - w - 2 * resized.edge));
          const boundaryColumn = Math.ceil((logicalX + resized.width - w - 2 * resized.edge - extra) / resized.p);
          const stop = resized.l - resized.h - boundaryColumn * resized.step;
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
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.waitForSelector(".rm-slot");
        await page.locator(".rm-source").evaluate((source) => {
          source.innerHTML = '<div style="height:200px;background:#0044aa">短い記事</div>';
        });
        await page.waitForFunction(() => parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-l")) === 200);
        await settle(page);
        await page.locator(".rm-viewport").focus();
        await page.keyboard.press("ArrowRight");
        await page.locator(".rm-viewport").evaluate((v) => { v.scrollLeft = 1000000; });
        await settle(page);
        assert.equal((await layout(page)).maxX, (await layout(page)).leading);
        assert.equal((await layout(page)).x, (await layout(page)).maxX);
        assert.equal(await page.locator(".rm-slot").count(), 1);
        await page.keyboard.press("End");
        await page.keyboard.press("PageDown");
        await page.locator(".rm-viewport").evaluate((v) => { v.scrollTop = 1e9; });
        await settle(page);
        assert.equal((await layout(page)).y, 0);
        assert.equal((await layout(page)).maxY, 0);
      } finally { await page.close(); }
    });

    await t.test("全文1個と表示断片に抑え、元本文と印刷・1段表示を維持する", async () => {
      const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector(".rm-slot .rm-source");
        const original = await page.locator(".rm-source").elementHandle();
        const initialPool = await layout(page);
        const poolSize = Math.ceil(initialPool.width / initialPool.p) + 1;
        assert.equal(await page.locator(".rm-source, .rm-content").count(), poolSize);
        assert.equal(await page.locator(".rm-content:not(.rm-source)").count(), poolSize - 1);
        assert.equal(await page.locator("[data-rm-fragmented]").count(), poolSize - 1);
        const fullSize = await page.locator(".rm-source").evaluate((source) => source.querySelectorAll("*").length);
        assert.ok(await page.locator("[data-rm-fragmented]").evaluateAll((roots, fullSize) =>
          roots.every((root) => root.querySelectorAll("*").length < fullSize / 2), fullSize),
        "各段に全文を複製している");
        const firstId = await page.locator(".rm-source [id]").first().getAttribute("id");
        assert.equal(await page.evaluate((id) => [...document.querySelectorAll("[id]")].filter((node) => node.id === id).length, firstId), 1);
        await page.locator(".rm-viewport").focus();
        await page.keyboard.press("ArrowRight");
        await settle(page);
        const position = await layout(page);
        await page.emulateMedia({ media: "print" });
        await page.waitForSelector(".rm-layout > .rm-source", { state: "attached" });
        assert.ok(await page.locator(".rm-source").isVisible(), "印刷時に元本文が消えた");
        assert.equal(await page.locator(".rm-content").count(), 0);
        await page.emulateMedia({ media: "screen" });
        await page.waitForSelector(".rm-slot .rm-source");
        await settle(page);
        const resumed = await layout(page);
        const readingPosition = (s) => (Math.floor((s.x - s.leading + 0.01) / s.p) + s.origin) * s.step + s.y;
        assert.ok(Math.abs(readingPosition(position) - readingPosition(resumed)) < 1, "印刷で読書位置がずれた");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => {
          const v = document.querySelector(".rm-viewport"), p = parseFloat(document.querySelector(".rm-plane").style.getPropertyValue("--rm-p"));
          return document.querySelectorAll(".rm-slot").length === Math.ceil(v.clientWidth / p) + 1;
        });
        assert.ok(await original.evaluate((source) => source.isConnected && !!source.closest(".rm-slot")));
        // Shrink to a single short column while the original's old column is
        // outside the wanted range. Its node and IDs must survive pool removal.
        await page.locator(".rm-source").evaluate((source) => {
          source.innerHTML = '<div style="height:200px">短い記事</div>';
        });
        await page.waitForFunction(() => document.querySelectorAll(".rm-slot").length === 1);
        assert.equal(await page.locator(".rm-source, .rm-content").count(), 1);
        assert.ok(await original.evaluate((source) => source.isConnected && !!source.closest(".rm-slot")));
        for (let i = 0; i < 2; i++) {
          await toggleReadingMode(page);
          assert.equal(await page.locator(".rm-content").count(), 0);
          assert.ok(await original.evaluate((source) => source.parentElement.classList.contains("rm-layout")
            && !source.style.width && !source.style.left && !source.style.translate));
          await toggleReadingMode(page);
          await page.waitForSelector(".rm-slot .rm-source");
          assert.equal(await page.locator(".rm-source, .rm-content").count(), 1);
        }
      } finally { await page.close(); }
    });

    await t.test("数式記事の高速移動で本文全体のスタイルを再計算しない", async (t) => {
      const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1600, height: 900 } });
      try {
        await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
        await page.goto(ARTICLE_URL);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForSelector(".rm-content mjx-container");
        await page.locator("astro-dev-toolbar").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
        await settle(page);
        const initial = await layout(page);
        const client = await page.context().newCDPSession(page);
        await client.send("Performance.enable");
        await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const metrics = async () => Object.fromEntries(
          (await client.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]),
        );
        const before = await metrics();
        for (const distance of [-8000, 8000]) {
          await client.send("Input.synthesizeScrollGesture", {
            x: initial.left + 100, y: initial.top + 150,
            xDistance: distance, yDistance: 0, speed: 12000,
            gestureSourceType: "mouse", preventFling: true,
          });
        }
        const after = await metrics();
        const count = after.RecalcStyleCount - before.RecalcStyleCount;
        const duration = after.RecalcStyleDuration - before.RecalcStyleDuration;
        t.diagnostic(`CPU 4倍減速: スタイル再計算 ${count}回 / ${(duration * 1000).toFixed(1)}ms`);
        // Allow ample headroom for CI, but catch the former whole-MathJax-tree
        // invalidation (hundreds of milliseconds per update on this article).
        assert.ok(duration / Math.max(1, count) < 0.05,
          "段の移動で数式本文全体のスタイル再計算が発生している");
        assert.equal(await page.locator(".rm-slot").count(), initial.slots.length);
        await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        await client.detach();
      } finally { await page.close(); }
    });

    await t.test("少数の本文を使い回し、連続横移動と左右キーの1段送りを両立する", async () => {
      for (const width of [1600, 390]) {
        const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width, height: 900 } });
        try {
          await page.addInitScript(() => localStorage.setItem("dispositif:reading-mode", "multi"));
          await page.goto(ARTICLE_URL);
          await page.evaluate(() => document.fonts.ready);
          await page.waitForSelector(".rm-slot");
          await page.locator(".rm-source").evaluate((source) => {
            source.innerHTML = '<div style="height:300000px;background:#0044aa"></div>';
          });
          await page.waitForFunction(() => document.querySelector(".rm-plane").style.getPropertyValue("--rm-l") === "300000px");
          await settle(page);
          const initial = await layout(page);
          const trace = await page.evaluateHandle(() => {
            return { frames: new Set(document.querySelectorAll(".rm-slot")), source: document.querySelector(".rm-source") };
          });
          const session = await page.context().newCDPSession(page);
          const object = await session.send("Runtime.evaluate", {
            expression: 'document.querySelector(".rm-viewport")',
          });
          const { listeners } = await session.send("DOMDebugger.getEventListeners", { objectId: object.result.objectId });
          assert.ok(!listeners.some((listener) => listener.type === "wheel" && !listener.passive),
            "非passiveなホイール処理がネイティブスクロールを待たせる");
          assert.ok(initial.maxX > 50 * initial.p, "ネイティブスクロール面が数段に制限されている");
          assert.ok(initial.slots.length <= Math.ceil(initial.width / initial.p) + 1);
          assert.equal(await page.locator(".rm-content").count(), initial.slots.length,
            "表示枠の外に計測専用の全文が残っている");
          assert.equal(await page.locator(".rm-slot .rm-source").count(), 1);
          assert.equal(await page.locator(".rm-source").evaluate((source) => source.closest('[aria-hidden="true"]')), null);
          await page.mouse.move(initial.left + 100, initial.top + 150);
          for (let i = 0; i < 20; i++) {
            await page.mouse.wheel((i < 12 ? 1 : -1) * 1.7 * initial.p, 0);
            await settle(page);
            const current = await layout(page);
            const first = Math.floor((current.x - current.leading + 0.01) / current.p) + current.origin;
            const last = Math.floor((current.x - current.leading + current.width - 0.01) / current.p) + current.origin;
            const mounted = new Set(current.slots.map((slot) => slot.k));
            for (let k = first; k <= last; k++) assert.ok(mounted.has(k), "可視段が用意されていない");
          }
          assert.ok(await trace.evaluate((state) => [...document.querySelectorAll(".rm-slot")].every((slot) => state.frames.has(slot))),
            "横移動で表示枠を作り直した");
          await page.locator(".rm-viewport").focus();
          const beforeKey = await layout(page);
          await page.keyboard.press("ArrowRight");
          await settle(page);
          const afterKey = await layout(page);
          assert.ok(Math.abs(afterKey.x + afterKey.origin * afterKey.p
            - beforeKey.x - beforeKey.origin * beforeKey.p - beforeKey.p) < 1);
          assert.ok(Math.abs(afterKey.y - beforeKey.y) < 1);
          await page.keyboard.press("ArrowLeft");
          await settle(page);
          assert.ok(Math.abs((await layout(page)).x - beforeKey.x) < 1);
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
          if (width === 1600) {
            const count = initial.slots.length;
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.waitForFunction((count) => document.querySelectorAll(".rm-slot").length < count, count);
            assert.ok(await trace.evaluate((state) => [...document.querySelectorAll(".rm-slot")].every((slot) => state.frames.has(slot))),
              "枠を減らす際に残すべき枠まで削除した");
            await page.setViewportSize({ width, height: 900 });
            await page.waitForFunction((count) => document.querySelectorAll(".rm-slot").length === count, count);
            const retained = await trace.evaluate((state) => [...document.querySelectorAll(".rm-slot")].filter((slot) => state.frames.has(slot)).length);
            assert.equal(retained, count - 1, "枠を増やす際に既存の枠まで作り直した");
          }
          // A large wheel gesture over a formula/code-like scroller must still
          // belong to that element, rather than jumping the article.
          await page.locator(".rm-viewport").focus();
          await page.keyboard.press("Home");
          await page.locator(".rm-source > div").evaluate((body) => {
            body.innerHTML = '<div data-test-scroll style="height:80px;width:120px;overflow:auto"><div style="width:30000px;height:40px"></div></div>';
          });
          await settle(page);
          const nested = page.locator('.rm-slot[data-rm-k="0"] [data-test-scroll]');
          await nested.waitFor();
          const box = await nested.boundingBox();
          await page.mouse.move(box.x + 40, box.y + 40);
          await page.mouse.wheel(4000, 0);
          await page.waitForFunction(() => document.querySelector('.rm-slot[data-rm-k="0"] [data-test-scroll]').scrollLeft > 3000);
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
            await page.waitForTimeout(80);
            const state = await layout(page);
            assert.ok(Math.abs(state.x - before.x - delta) < 1, "JSの更新待ちで高速スクロールが止まった");
          }
          await page.evaluate((raf) => { window.requestAnimationFrame = raf; }, originalRAF);
          // Trigger a new scroll after restoring rAF to resume the reader.
          await page.mouse.wheel(initial.p * 1.7, 0);
          await settle(page);
          assert.ok(await trace.evaluate((state) => document.querySelector(".rm-source") === state.source
            && state.source.closest(".rm-slot")), "元本文のDOMが入れ替わった");
          await originalRAF.dispose();
          await session.detach();
          await trace.dispose();
        } finally { await page.close(); }
      }
    });
  } finally {
    await browser.close();
  }
});
