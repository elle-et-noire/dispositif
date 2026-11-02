import assert from "node:assert/strict";
import test from "node:test";
import {
  columnStep, columnWidth, nearestPosition, positionAt, readingPlane,
  rebasedPosition, restoredPosition, slotRange,
} from "../src/scripts/reading-geometry.ts";

const geometry = readingPlane(608, 640, 700, 679, 70000, 1400, 1, 0);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.001, `${a} != ${b}`);

test("負の段も含め、縦1段分と横1段分が同じ本文位置を指す", () => {
  for (const overlap of [0, 21, 175]) {
    const g = { ...geometry, step: columnStep(700, overlap) };
    for (const k of [-1000, -1, 0, 1, 1000]) {
      for (const y of [-12345, 0, 123.5, 50000]) {
        const x = (k - g.originColumn) * g.p;
        close(positionAt(x, y + g.step, g), positionAt(x + g.p, y, g));
      }
    }
  }
});

test("先頭で1段分下へ進んで左隣へ移ると先頭が現れる", () => {
  const start = restoredPosition(0, geometry);
  assert.deepEqual(start, { left: 0, top: 0 });
  close(positionAt(start.left, start.top + geometry.step, geometry), geometry.step);
  close(positionAt(start.left - geometry.p, start.top + geometry.step, geometry), 0);
});

test("左端は縦に1段分進むごとに1段ずつ広がる", () => {
  for (const overlap of [0, 21, 175]) {
    const g = readingPlane(608, 640, 700, columnStep(700, overlap), 70000, 1400, 1, 0);
    for (const pages of [0, 0.5, 0.999, 1, 1.5, 2, 3]) {
      const y = pages * g.step;
      const opened = rebasedPosition(0, y, g);
      const next = { ...g, ...opened };
      assert.equal(next.originColumn, -Math.floor(pages));
      close(opened.left, Math.floor(pages) * g.p);
      close(positionAt(opened.left, opened.top, next), y);
      const limited = rebasedPosition(-10 * g.p, opened.top, next);
      close(positionAt(limited.left, limited.top, { ...next, ...limited }), y % g.step);
    }
  }
});

test("上下端の重なりが負の段でも連続する", () => {
  for (const k of [-20, -1, 0, 1, 20]) {
    for (const y of [0, 37.5, 10000]) {
      for (const offset of [0, 7, 14, 21]) {
        const x = (k - geometry.originColumn) * geometry.p;
        close(positionAt(x, y + geometry.step + offset, geometry),
          positionAt(x + geometry.p, y + offset, geometry));
      }
    }
  }
});

test("四方の端を越す原点変更でも全画面点と横の端数を維持する", () => {
  for (const unit of [1, 0.8, 2 / 3]) {
    const p = columnWidth(608, 32, unit) + 32;
    const g = readingPlane(p - 32, p, 700, 679, 70000, 1400, unit, 42000);
    for (const x of [0, p * 0.375, g.maxX, -100 * p + 13, g.maxX + 200 * p]) {
      for (const y of [0, g.maxY, -100000, g.maxY + 300000]) {
        if (positionAt(x, y, g) < 0) continue;
        const logicalY = y + g.originY;
        const first = -Math.floor(logicalY / g.step);
        const last = Math.max(first, Math.ceil((g.l - g.h - logicalY - 1e-7) / g.step));
        if (x + g.originColumn * p > Math.max(first * p, last * p + g.w - g.viewportWidth)) continue;
        const result = rebasedPosition(x, y, g);
        const next = { ...g, ...result };
        assert.ok(result.left >= 0 && result.left <= g.maxX);
        assert.ok(result.top >= 0 && result.top <= g.maxY);
        for (const px of [0, 53, 643, 1399]) {
          for (const py of [0, 123, 699]) {
            close(positionAt(x + px, y + py, g), positionAt(result.left + px, result.top + py, next));
          }
        }
        assert.deepEqual(rebasedPosition(result.left, result.top, next), result);
      }
    }
  }
});

test("通常のスクロール位置では原点もスクロール座標も変えない", () => {
  const g = readingPlane(608, 640, 700, 679, 2000000, 1400, 1, 42000);
  const initial = restoredPosition(42000, g);
  for (const delta of [0, 13, 300]) {
    const { left, top, originColumn, originY } = rebasedPosition(initial.left + delta, initial.top + delta, g);
    assert.deepEqual({ left, top, originColumn, originY }, {
      left: initial.left + delta, top: initial.top + delta,
      originColumn: g.originColumn, originY: g.originY,
    });
  }
});

test("先頭側の範囲変更もズーム時のスクロール単位に揃え、位置をずらさない", () => {
  for (const unit of [0.8, 2 / 3]) {
    const p = columnWidth(500.8, 17.25, unit) + 17.25;
    const g = readingPlane(p - 17.25, p, 700, 679, 70000, 1400, unit, 3512);
    const y = Math.round(9000 / unit) * unit;
    for (const j of [0, 1, 2]) {
      const result = rebasedPosition(j * p, y, g);
      close((result.top - y) / unit, Math.round((result.top - y) / unit));
      close(positionAt(result.left, result.top, { ...g, ...result }), positionAt(j * p, y, g));
    }
  }
});

test("遠い見出しも負の段も全候補のうち最短で到達できる", () => {
  const geometry = readingPlane(608, 640, 700, 679, 2000000, 1400, 1, 0);
  for (const t of [0, 701, 20000, 69999, 1000000]) {
    for (const x of [0, 12123, geometry.maxX]) {
      const y = 1200;
      const actual = nearestPosition(t, x, y, geometry);
      const distance = (left: number, top: number) => (left - x) ** 2 + (top - y) ** 2;
      let minimum = Infinity;
      for (let j = -1500; j <= 1500; j++) {
        const top = t - (j + geometry.originColumn) * geometry.step - geometry.originY;
        minimum = Math.min(minimum, distance(j * geometry.p, top));
      }
      close(distance(actual.left, actual.top), minimum);
      close(positionAt(actual.left, actual.top, geometry), t);
      const rebased = rebasedPosition(actual.left, actual.top, geometry);
      close(positionAt(rebased.left, rebased.top, { ...geometry, ...rebased }), t);
    }
  }
});

test("リサイズや重なり変更で読書位置を復元し、末尾では対象を表示範囲に残す", () => {
  for (const t of [-1e8, -713.5, 0, 1800, 42000, 1e8]) {
    for (const h of [450, 700, 900]) {
      const resized = readingPlane(608, 640, h, columnStep(h, 21), 70000, 1400, 1, t);
      const raw = restoredPosition(t, resized);
      const result = rebasedPosition(raw.left, raw.top, resized);
      assert.ok(result.left >= 0 && result.left <= result.maxX);
      assert.ok(result.top >= 0 && result.top <= result.maxY);
      const target = Math.min(resized.l - 1, Math.max(0, t));
      const visible = Array.from({ length: result.n }, (_, i) => i + result.originColumn).some((k) => {
        const px = (k - result.originColumn) * resized.p - result.left;
        const py = target - k * resized.step - result.top - result.originY;
        return px >= -0.01 && px + resized.w <= resized.viewportWidth + 0.01 && py >= 0 && py < resized.h;
      });
      assert.ok(visible, "末尾付近の読書位置が表示範囲から消えた");
    }
  }
});

test("記事の長さにかかわらず複製数に上限があり、短い記事は空の段を作らない", () => {
  for (const width of [320, 608, 640, 1400, 4000]) {
    const short = readingPlane(608, 640, 700, 679, 200, width, 1, 0);
    const long = readingPlane(608, 640, 700, 679, 1e8, width, 1, 0);
    assert.equal(short.n, 1);
    assert.ok(long.n <= long.capacity);
    for (let x = 0; x <= long.maxX; x += 137.25) {
      const { start, count } = slotRange(x, width, long);
      assert.ok(count <= Math.ceil(width / long.p) + 9);
      const first = Math.floor(x / long.p);
      const last = Math.min(long.n - 1, Math.floor((x + width - 0.01) / long.p));
      assert.ok(start <= first && start + count > last);
    }
  }
});

test("速度と向きに応じて固定数のスロットを先読みし、反転にも2段分を残す", () => {
  for (const width of [320, 608, 640, 1400, 4000]) {
    const g = readingPlane(608, 640, 700, 679, 1e8, width, 1, 0);
    assert.ok(g.n >= 128);
    for (const fraction of [0, 0.1, 0.5, 0.9, 0.999]) {
      const x = fraction * g.maxX;
      const stationary = slotRange(x, width, g);
      for (const velocity of [-100, -5, 0, 5, 100]) {
        const { start, count } = slotRange(x, width, g, velocity);
        assert.equal(count, stationary.count);
        assert.ok(count <= Math.ceil(width / g.p) + 9);
        if (velocity > 0) assert.ok(start >= stationary.start);
        if (velocity < 0) assert.ok(start <= stationary.start);
        for (const delta of [-2 * g.p, 0, 2 * g.p]) {
          const nativeX = Math.min(g.maxX, Math.max(0, x + delta));
          const first = Math.floor(nativeX / g.p);
          const last = Math.min(g.n - 1, Math.floor((nativeX + width - 0.01) / g.p));
          assert.ok(first >= start && last < start + count,
            `先読み範囲が不足: width=${width}, x=${x}, delta=${delta}`);
        }
      }
    }
  }
});

test("右端は末尾に届く段で止まり、縦移動に合わせて変わる", () => {
  for (const overlap of [0, 21, 175]) {
    const g = readingPlane(608, 640, 700, columnStep(700, overlap), 70000, 1400, 1, 0);
    for (const y of [0, g.step / 2, g.step, 3 * g.step]) {
      const result = rebasedPosition(1e8, y, g);
      const next = { ...g, ...result };
      close(result.left, result.maxX);
      const last = result.originColumn + result.n - 1;
      assert.ok(last * g.step + y < g.l);
      assert.ok(last * g.step + y + g.h >= g.l);
      const stopped = rebasedPosition(result.left + g.p, result.top, next);
      close(stopped.left, result.left);
      close(stopped.top + stopped.originY, y);
      assert.equal(stopped.n, result.n);
    }
  }
});

test("端数の段幅やズームでネイティブスクロールの丸めによる段ずれを防ぐ", () => {
  for (const unit of [1, 0.8, 2 / 3, 0.5, 1 / 3]) {
    for (const requested of [358, 500.796875, 608.25]) {
      const w = columnWidth(requested, 17.25, unit);
      const p = w + 17.25;
      const g = readingPlane(w, p, 700, 679, 70000, 1400, unit, 0);
      assert.ok(Math.abs(w - requested) <= unit / 2 + 0.001);
      for (let k = -100; k < 100; k++) {
        const actualX = Math.round((k - g.originColumn) * p / unit) * unit;
        close(positionAt(actualX, 123 - g.originY, g), k * g.step + 123);
      }
    }
  }
});
