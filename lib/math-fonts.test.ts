import assert from "node:assert/strict";
import test from "node:test";
import { mathFontFaces, separateMathFontFaces, type MathFont } from "./math-fonts.ts";

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
const names = (fonts: MathFont[]) => fonts.map(({ url }) => url.split("/").pop());

test("本文で使う class と要素のフォントだけを、@font-face の順で返す", () => {
  const html = `<mjx-container jax="CHTML"><mjx-c class="mjx-c28 TEX-N"></mjx-c>
    <mjx-c class="mjx-c2211 TEX-LO"></mjx-c><mjx-break size="1"></mjx-break></mjx-container>`;
  assert.deepEqual(names(mathFontFaces(html, css)),
    ["mjx-tex-zero.woff2", "mjx-tex-brk.woff2", "mjx-tex-n.woff2", "mjx-tex-lo.woff2"]);
  // The family is the @font-face name, which need not follow the file name.
  assert.deepEqual(mathFontFaces(html, css).map(({ family }) => family), ["MJX-TEX-ZERO", "MJX-BRK", "MJX-TEX-N", "MJX-TEX-LO"]);
});

test("使われない class や要素のフォントは含めない", () => {
  const html = `<mjx-container jax="CHTML"><mjx-c class="mjx-c28 TEX-N"></mjx-c></mjx-container>`;
  assert.deepEqual(names(mathFontFaces(html, css)), ["mjx-tex-zero.woff2", "mjx-tex-n.woff2"]);
  // A class name that only appears in text, not in a class attribute, does not count.
  assert.deepEqual(mathFontFaces("<p>TEX-I mjx-break</p>", css), []);
});

test("数式のない記事や @font-face のないスタイルでは空", () => {
  assert.deepEqual(mathFontFaces("<p>no math</p>", ""), []);
  assert.deepEqual(mathFontFaces(`<mjx-c class="TEX-N"></mjx-c>`, ".TEX-N { font-family: serif; }"), []);
});

test("使うフォントの @font-face だけを 1 規則ずつ取り出し、残りはそのまま返す", () => {
  const html = `<mjx-container jax="CHTML"><mjx-c class="mjx-c28 TEX-N"></mjx-c></mjx-container>`;
  const fonts = mathFontFaces(html, css);
  const { css: rest, faces } = separateMathFontFaces(css, fonts);
  assert.deepEqual(faces.map(({ family, url }) => ({ family, url })), fonts);
  assert.deepEqual(faces.map(({ rule }) => rule), [
    `@font-face /* MJX-TEX-ZERO */ {\n  font-family: MJX-TEX-ZERO;\n  src: url("/base/fonts/mjx/mjx-tex-zero.woff2") format("woff2");\n}`,
    `@font-face /* MJX-TEX-N */ {\n  font-family: MJX-TEX-N;\n  src: url("/base/fonts/mjx/mjx-tex-n.woff2") format("woff2");\n}`,
  ]);
  // The other faces and every other rule stay where they were.
  assert.equal(rest, css.replace(faces[0].rule + "\n", "").replace(faces[1].rule + "\n", ""));
  assert.deepEqual(mathFontFaces(html, rest + faces.map(({ rule }) => rule).join("\n")), fonts);
  assert.match(rest, /MJX-BRK;\n  src/);
  assert.match(rest, /\.TEX-N \{ font-family: MJX-TEX-ZERO, MJX-TEX-N; \}/);
});

test("名前か URL が一覧と合わない @font-face は取り出さない", () => {
  const { css: rest, faces } = separateMathFontFaces(css, [
    { family: "MJX-TEX-N", url: "/elsewhere/mjx-tex-n.woff2" },
    { family: "MJX-TEX-X", url: "/base/fonts/mjx/mjx-tex-i.woff2" },
  ]);
  assert.deepEqual(faces, []);
  assert.equal(rest, css);
  assert.deepEqual(separateMathFontFaces("", []), { css: "", faces: [] });
});
