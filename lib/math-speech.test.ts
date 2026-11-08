import assert from "node:assert/strict";
import test from "node:test";

import { speechLabel } from "./math-speech.ts";

test("インライン数式の前後の間隔を除いた TeX を読ませる", () => {
  assert.equal(speechLabel("\\hspace{0.2em}x^2 + 1\\hspace{0.2em}", []), "x^2 + 1");
  assert.equal(speechLabel("N\\hspace{0.2em}", []), "N");
  // 式の途中の間隔は書き手の指定なので残す。
  assert.equal(speechLabel("a\\hspace{1em}b", []), "a\\hspace{1em}b");
});

test("\\label と \\tag は除き、見えている式番号を末尾に足す", () => {
  assert.equal(speechLabel("\\begin{equation}a+b=c\\label{eq1}\\end{equation}", ["(1)"]),
    "\\begin{equation}a+b=c\\end{equation} (1)");
  assert.equal(speechLabel("x^2 \\tag{A}", ["(A)"]), "x^2 (A)");
  assert.equal(speechLabel("x \\tag*{†}", ["†"]), "x †");
});

test("改行や連続した空白は 1 つの空白にする", () => {
  assert.equal(speechLabel("\\begin{pmatrix}\n  a & b \\\\\n  c & d\n\\end{pmatrix}", []),
    "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}");
});
