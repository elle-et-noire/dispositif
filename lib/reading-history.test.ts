import assert from "node:assert/strict";
import test from "node:test";
import { type HistoryPosition, parseSavedHistory, mergeHistory, resolveHistoryEntry } from "../src/scripts/reading-history.ts";

const at = (position: number, mode: HistoryPosition["mode"] = "single"): HistoryPosition => ({ mode, position });

test("保存済みの履歴は不正な項目だけを捨てて読み込む", () => {
  const json = JSON.stringify([
    ["a", at(10)], ["b", { mode: "multi", position: 20, details: [true] }],
    ["bad-mode", { mode: "MULTI", position: 1 }], ["bad-position", { mode: "single", position: "1" }],
    ["infinite", { mode: "single", position: null }], [1, at(5)], "not-an-entry", ["no-value"],
  ]);
  const entries = parseSavedHistory(json);
  assert.deepEqual([...entries.keys()], ["a", "b"]);
  assert.deepEqual(entries.get("b"), { mode: "multi", position: 20, details: [true] });
  assert.equal(parseSavedHistory(null).size, 0);
  assert.equal(parseSavedHistory("{}").size, 0);
  assert.throws(() => parseSavedHistory("{"));
});

test("保存時は他の文書の新しい位置を残し、この文書で変えた項目だけを上書きする", () => {
  // Another document saved a newer position for "shared" after this one loaded.
  const stored = new Map([["shared", at(900)], ["other", at(5)], ["mine", at(1)]]);
  const local = new Map([["shared", at(100)], ["mine", at(42)]]);
  const merged = new Map(mergeHistory(stored, local, ["mine"]));
  assert.equal(merged.get("shared")?.position, 900, "未変更の古いメモリ上の値で上書きしない");
  assert.equal(merged.get("other")?.position, 5);
  assert.equal(merged.get("mine")?.position, 42);
});

test("変更した項目は最新として末尾へ移り、上限を超えた古い項目から捨てる", () => {
  const stored = new Map(Array.from({ length: 5 }, (_, i) => [`k${i}`, at(i)] as const));
  const local = new Map([["k0", at(100)], ["new", at(7)]]);
  const merged = mergeHistory(stored, local, ["k0", "new", "missing"], 4);
  assert.deepEqual(merged.map(([key]) => key), ["k3", "k4", "k0", "new"]);
  assert.equal(merged[2][1].position, 100);
});

test("履歴項目の復元では、未保存の自分の変更を最優先し、それ以外は保存内容を優先する", () => {
  const local = at(100), stored = at(900);
  assert.equal(resolveHistoryEntry(local, stored, true), local);
  assert.equal(resolveHistoryEntry(local, stored, false), stored, "古いメモリ上の値より新しい保存内容を使う");
  assert.equal(resolveHistoryEntry(local, undefined, false), local, "保存内容から消えていればメモリ上の値を使う");
  assert.equal(resolveHistoryEntry(undefined, stored, false), stored);
  assert.equal(resolveHistoryEntry(undefined, undefined, false), undefined);
});
