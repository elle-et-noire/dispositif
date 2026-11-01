import assert from "node:assert/strict";
import test from "node:test";
import {
  columnStep, columnWidth, nearestPosition, positionAt, restoredPosition, slotRange,
  type ReadingGeometry,
} from "../src/scripts/reading-geometry.ts";

const geometry: ReadingGeometry = {
  w: 608, p: 640, h: 700, step: 700, l: 70000, n: 100,
  maxX: 100 * 640 - 32 - 1400, maxY: 70000 - 700,
};

test("隣接段の下端と上端は本文の同じ座標を指す", () => {
  for (const y of [0, 123.5, 50000]) {
    for (let k = 0; k < 99; k++) {
      assert.equal(positionAt(k * 640, y + 700, geometry), positionAt((k + 1) * 640, y, geometry));
    }
  }
});

test("長い記事でも全可視段を定数個のスロットで覆う", () => {
  for (const width of [320, 608, 640, 1400, 4000]) {
    for (let x = 0; x <= geometry.maxX; x += 37.25) {
      const { start, count } = slotRange(x, width, geometry);
      assert.ok(count <= Math.ceil(width / geometry.p) + 2);
      const first = Math.floor(x / geometry.p);
      const last = Math.min(geometry.n - 1, Math.floor((x + width - 0.01) / geometry.p));
      assert.ok(start <= first && start + count > last);
    }
  }
});

test("見出しへの移動は全候補のうち最短で、スクロール範囲内に収まる", () => {
  for (const t of [0, 701, 20000, 69000, 69999]) {
    for (const x of [0, 12123, geometry.maxX]) {
      const y = 1200;
      const actual = nearestPosition(t, x, y, geometry);
      const candidates = Array.from({ length: geometry.n }, (_, k) => ({ left: k * geometry.p, top: t - k * geometry.h }))
        .filter((candidate) => candidate.left <= geometry.maxX && candidate.top >= 0 && candidate.top <= geometry.maxY);
      const distance = (candidate: { left: number; top: number }) => (candidate.left - x) ** 2 + (candidate.top - y) ** 2;
      assert.equal(distance(actual), Math.min(...candidates.map(distance)));
      assert.equal(positionAt(actual.left, actual.top, geometry), t);
    }
  }
});

test("リサイズ後は右端のスクロール上限を考慮して読書位置を保つ", () => {
  const resized = { ...geometry, h: 450, step: 450, n: Math.ceil(geometry.l / 450), maxX: Math.ceil(geometry.l / 450) * 640 - 32 - 1400, maxY: geometry.l - 450 };
  for (const t of [0, 1800, 42000, geometry.l - 700]) {
    const result = restoredPosition(t, resized);
    assert.ok(result.left <= resized.maxX && result.top <= resized.maxY);
    assert.equal(positionAt(result.left, result.top, resized), t);
  }
});

test("画面より短い記事は負のスクロール位置を作らない", () => {
  const short = { w: 608, p: 640, h: 700, step: 679, l: 200, n: 1, maxX: 0, maxY: 0 };
  assert.deepEqual(nearestPosition(100, 0, 0, short), { left: 0, top: 0 });
  assert.deepEqual(slotRange(0, 1400, short), { start: 0, count: 1 });
});

test("上下端の文脈が重なり、スクロール中も同じ本文位置を指す", () => {
  const overlapping = { ...geometry, step: columnStep(700, 21) };
  for (const y of [0, 37, 123.5, 50000]) {
    for (let k = 0; k < 99; k++) {
      for (const offset of [0, 7, 14, 21]) {
        assert.equal(
          positionAt(k * 640, y + 679 + offset, overlapping),
          positionAt((k + 1) * 640, y + offset, overlapping),
        );
      }
    }
  }
});

test("重なりがあっても見出しへの移動は最短でリサイズ後の位置を保つ", () => {
  const step = columnStep(geometry.h, 21);
  const n = Math.ceil((geometry.l - geometry.h) / step) + 1;
  const overlapping = { ...geometry, step, n, maxX: n * geometry.p - 32 - 1400 };
  for (const t of [0, 701, 20000, 69000, 69999]) {
    const x = 12123;
    const y = 1200;
    const actual = nearestPosition(t, x, y, overlapping);
    const candidates = Array.from({ length: n }, (_, k) => ({ left: k * geometry.p, top: t - k * step }))
      .filter((candidate) => candidate.left <= overlapping.maxX && candidate.top >= 0 && candidate.top <= overlapping.maxY);
    const distance = (candidate: { left: number; top: number }) => (candidate.left - x) ** 2 + (candidate.top - y) ** 2;
    assert.equal(distance(actual), Math.min(...candidates.map(distance)));
    assert.equal(positionAt(actual.left, actual.top, overlapping), t);
    if (t <= overlapping.l - overlapping.h) {
      const restored = restoredPosition(t, overlapping);
      assert.equal(positionAt(restored.left, restored.top, overlapping), t);
    }
  }
  assert.equal(columnStep(700, 0), 700);
  assert.ok(columnStep(40, 100) >= 30);
});

test("端数の段幅やズームでもネイティブスクロールの丸めで前の段に戻らない", () => {
  for (const scrollStep of [1, 0.8, 2 / 3, 0.5, 1 / 3]) {
    for (const requested of [358, 500.796875, 608.25]) {
      const gap = 17.25;
      const w = columnWidth(requested, gap, scrollStep);
      const p = w + gap;
      assert.ok(Math.abs(w - requested) <= scrollStep / 2 + 0.001);
      for (let k = 0; k < 100; k++) {
        const actualX = Math.round(k * p / scrollStep) * scrollStep;
        assert.equal(positionAt(actualX, 123, { ...geometry, w, p }), k * geometry.h + 123);
      }
    }
  }
});
