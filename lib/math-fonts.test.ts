import assert from "node:assert/strict";
import test from "node:test";
import { mathFontUrls } from "./math-fonts.ts";

// A trimmed CHTML stylesheet in MathJax's shape: every face is declared, and
// class or element rules decide which of them a page actually loads.
const css = `
mjx-container[jax="CHTML"] mjx-break {
  white-space: normal;
  font-family: MJX-BRK !important;
}
.TEX-N { font-family: MJX-TEX-ZERO, MJX-TEX-N; }
.TEX-LO { font-family: MJX-TEX-ZERO, MJX-TEX-LO; }
.TEX-I { font-family: MJX-TEX-ZERO, MJX-TEX-I; }
mjx-c.mjx-c28::before { padding: 0.75em 0.389em 0.25em 0; content: "("; }
@font-face /* MJX-TEX-ZERO */ {
  font-family: MJX-TEX-ZERO;
  src: url("/base/fonts/mjx/mjx-tex-zero.woff2") format("woff2");
}
@font-face /* MJX-BRK */ {
  font-family: MJX-BRK;
  src: url("/base/fonts/mjx/mjx-tex-brk.woff2") format("woff2");
}
@font-face /* MJX-TEX-N */ {
  font-family: MJX-TEX-N;
  src: url("/base/fonts/mjx/mjx-tex-n.woff2") format("woff2");
}
@font-face /* MJX-TEX-LO */ {
  font-family: MJX-TEX-LO;
  src: url('/base/fonts/mjx/mjx-tex-lo.woff2') format("woff2");
}
@font-face /* MJX-TEX-I */ {
  font-family: MJX-TEX-I;
  src: url(/base/fonts/mjx/mjx-tex-i.woff2) format("woff2");
}
`;
const names = (urls: string[]) => urls.map((url) => url.split("/").pop());

test("本文で使う class と要素のフォントだけを、@font-face の順で返す", () => {
  const html = `<mjx-container jax="CHTML"><mjx-c class="mjx-c28 TEX-N"></mjx-c>
    <mjx-c class="mjx-c2211 TEX-LO"></mjx-c><mjx-break size="1"></mjx-break></mjx-container>`;
  assert.deepEqual(names(mathFontUrls(html, css)),
    ["mjx-tex-zero.woff2", "mjx-tex-brk.woff2", "mjx-tex-n.woff2", "mjx-tex-lo.woff2"]);
});

test("使われない class や要素のフォントは含めない", () => {
  const html = `<mjx-container jax="CHTML"><mjx-c class="mjx-c28 TEX-N"></mjx-c></mjx-container>`;
  assert.deepEqual(names(mathFontUrls(html, css)), ["mjx-tex-zero.woff2", "mjx-tex-n.woff2"]);
  // A class name that only appears in text, not in a class attribute, does not count.
  assert.deepEqual(mathFontUrls("<p>TEX-I mjx-break</p>", css), []);
});

test("数式のない記事や @font-face のないスタイルでは空", () => {
  assert.deepEqual(mathFontUrls("<p>no math</p>", ""), []);
  assert.deepEqual(mathFontUrls(`<mjx-c class="TEX-N"></mjx-c>`, ".TEX-N { font-family: serif; }"), []);
});
