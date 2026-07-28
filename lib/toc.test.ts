import assert from "node:assert/strict";
import test from "node:test";

import { getHeadings } from "./toc.ts";

test("長いコードフェンス内の短いフェンスと見出しを無視する", () => {
  const source = [
    "## Before",
    "````md",
    "## Hidden",
    "```sh",
    "## Also hidden",
    "```",
    "````",
    "## After",
  ].join("\n");

  assert.deepEqual(
    getHeadings(source).map(({ text }) => text),
    ["Before", "After"],
  );
});

test("開始フェンス以上の長さを持つ同じ記号だけを閉じフェンスとして扱う", () => {
  const source = [
    "~~~~text",
    "```",
    "## Hidden by different marker",
    "```",
    "~~~",
    "## Hidden by short closer",
    "~~~~~",
    "## Visible",
  ].join("\n");

  assert.deepEqual(
    getHeadings(source).map(({ text }) => text),
    ["Visible"],
  );
});
