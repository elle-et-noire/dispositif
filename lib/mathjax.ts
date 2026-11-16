// ビルド時（サーバーサイド）に数式を MathJax v4 の CHTML へ組版するモジュール。
//
// 数式はビルド時に完全に HTML/CSS へ変換し、ブラウザ側では
// MathJax の JavaScript を一切実行しない（クライアント JS 0KB）。CHTML が必要と
// する CSS は実際に使われたグリフのぶんだけ（adaptiveCSS）抽出してページに
// インライン化し、Web フォント (woff2) は @font-face 経由で同一オリジン（自前ホスト）
// から読み込む（scripts/copy-math-fonts.mjs が public/fonts/mjx/ に用意する）。
//
// 記事内の数式は 1 つの MathJax ドキュメントとしてまとめて組版する。これにより
// \label / \eqref による式番号の連番と相互参照（前方参照を含む）が記事全体で
// 正しく解決される（数式を 1 つずつ変換すると番号がリセットされ参照が壊れる）。

import { createRequire } from "node:module";
import { join } from "node:path";

import { withBase } from "./base";
import { speechLabel } from "./math-speech";

// mathjax の node 版 API は CommonJS（node-main.cjs）で型定義も無いため、
// 実行時に node_modules から require する。
const require = createRequire(import.meta.url);

// mathjax のコンポーネント（input/tex.js など）の動的ロード元（ルート）。
// 既定では mathjax の node-main が記録した __dirname を使うが、バンドラーが
// node-main を取り込むと __dirname が仮想パスに書き換わり、コンポーネントを
// 読み込めなくなる。これを避けるため、実行時の作業ディレクトリ（ビルドの実行元 =
// プロジェクトルート）から実体パスを組み立て、loader.paths.mathjax で明示する。
const MATHJAX_ROOT = join(process.cwd(), "node_modules", "mathjax");

// 数式グリフのフォント。MathJax v4 既定の New Computer Modern（newcm）は線が細く、
// 標準 DPI だとヘアラインがにじんで見えるため、MathJax v3 時代の TeX フォント
// （mathjax-tex）を使う。これは chtml.font: "mathjax-tex" で選び、fontPath テンプレート
// （@mathjax/%%FONT%%-font）経由でビルド時に @mathjax/mathjax-tex-font が require される。
//
// 数式フォントは自前ホスト（同一オリジン）で配信する。scripts/copy-math-fonts.mjs が
// @mathjax/mathjax-tex-font の woff2 を public/fonts/mjx/ へコピーし（predev/prebuild）、
// @font-face の src がこのパスを指す。各 woff2 はこの直下に置かれる（例: mjx-tex-n.woff2）。
// base（astro.config.mjs の '/dispositif'）込みの絶対パスにするため BASE_URL を前置する。
// 以前は第三者 CDN（jsdelivr）を指していたが、本文・コードフォントと同じく同一オリジンに
// 寄せて DNS+TLS+コネクション確立のラウンドトリップを無くす。
const FONT_URL = withBase("fonts/mjx");

// TeX の入力と、ビルド時の CHTML 出力の設定。
const config = {
  loader: {
    // コンポーネントのロード元を実体パスで固定する（上記 MATHJAX_ROOT 参照）。
    paths: { mathjax: MATHJAX_ROOT },
    load: [
      "input/tex",
      "output/chtml",
      "[tex]/html",
      "[tex]/physics",
      "[tex]/mathtools",
      "[tex]/color",
      "[tex]/upgreek",
      "[tex]/centernot",
      "[tex]/tagformat",
      // 可換図式は tikz-cd ではなく MathJax 同梱の amscd（\begin{CD}…\end{CD}）で
      // 描く。MathJax v4 には tikz-cd 拡張が存在せず（npm/CDN の mathjax-tikzcd は
      // 実在せず 404）、かつビルド時の node ローダはローカルの component しか読めない
      // ため、CDN 上の拡張も読み込めない。amscd は同梱コンポーネントで追加依存なし。
      "[tex]/amscd",
    ],
  },
  tex: {
    packages: {
      "[+]": ["html", "physics", "mathtools", "color", "upgreek", "centernot", "tagformat", "amscd"],
      // noundefined は未定義のマクロを赤字のマクロ名として組版し、誤りにしない。
      // findTexErrors が未定義のマクロを検出できるよう、外して TeX の誤り（mjx-merror）にする。
      "[-]": ["noundefined"],
    },
    inlineMath: [["$", "$"], ["\\(", "\\)"]],
    displayMath: [["$$", "$$"], ["\\[", "\\]"]],
    macros: {
      parn: ["\\biggl(#1\\biggr)", 1],
      sqbr: ["\\biggl[#1\\biggr]", 1],
      pfrac: ["\\biggl(\\dfrac{#1}{#2}\\biggr)", 2],
      ds: "\\displaystyle",
      C: "{\\mathbb C}",
      R: "{\\mathbb R}",
      Q: "{\\mathbb Q}",
      Z: "{\\mathbb Z}",
      ssqrt: ["\\sqrt{\\smash[b]{\\mathstrut #1}}", 1],
      tcdegree: ["\\unicode{xb0}"],
      tccelsius: ["\\unicode{x2103}"],
      tcperthousand: ["\\unicode{x2030}"],
      tcmu: ["\\unicode{x3bc}"],
      tcohm: ["\\unicode{x3a9}"],
      bm: ["\\pmb{#1}", 1],
      ol: ["\\overline{#1}", 1],
      ul: ["\\underline{#1}", 1],
      ub: ["\\underbrace{#1}", 1],
      ubt: ["\\underbrace{#1}_{\\text{#2}}", 2],
      defiff: "{\\stackrel{\\mathrm{def}}{\\iff}}",
      i: "{\\mathrm{i}}",
      e: "{\\mathrm{e}}",
      ve: "{\\varepsilon}",
      slashed: ["{{#1\\!\\!\\!/}}", 1],
      Im: "\\operatorname{Im}",
      id: "\\operatorname{id}",
      sgn: "\\operatorname{sgn}",
      Ker: "\\operatorname{Ker}",
      det: "\\operatorname*{det}",
    },
    tags: "ams",
    tagSide: "right",
    tagIndent: "0.8em",
  },
  chtml: {
    // 既定の newcm ではなく v3 時代の TeX フォントを使う（上記 FONT_URL 参照）。
    // fontPath（@mathjax/%%FONT%%-font）が @mathjax/mathjax-tex-font に解決される。
    font: "mathjax-tex",
    // 周囲フォントとの高さ自動合わせを無効化（CPU 負荷削減）。
    matchFontHeight: false,
    // 実際に出現したグリフのぶんだけ CSS を生成する。
    adaptiveCSS: true,
    displayOverflow: "overflow",
    // \text / \tag / \eqref の文字を MathJax フォントの字形ボックス（mjx-c）ではなく
    // 実テキスト（mjx-utext）として出力させる。クライアント版の mtextInheritFont:true は
    // 「実行時に DOM から周囲フォントを実測する」仕組みで、DOM の無いビルド時
    // （liteAdaptor）では機能しないため、mtextFont を非空にして explicit-font 経路に乗せる。
    // 実際のフォント指定（本文と同じ --font-sans）と、メトリクス未実測による固定幅の解除は
    // globals.css の `.post mjx-utext` 側で行う（ビルド時は実フォント幅を測れないため）。
    mtextFont: "inherit",
    scale: 1.0,
    // @font-face の src を自前ホストのフォントディレクトリ（同一オリジン）へ向ける
    // （ブラウザは JS 無しで CSS 経由のみ woff2 を読み込む）。グリフのメトリクスは
    // ビルド時にローカルの node_modules から読まれるため、ここはブラウザ向けの URL のみを指す。
    fontURL: FONT_URL,
  },
  // ビルド時に手動で組版するので、読み込み時の自動 typeset は不要。
  startup: { typeset: false },
};

// MathJax は global を共有する単一インスタンスのため一度だけ初期化する。
let mathJaxPromise: Promise<MathJaxInstance> | null = null;

function getMathJax(): Promise<MathJaxInstance> {
  if (!mathJaxPromise) {
    const MathJax = require("mathjax") as { init: (c: unknown) => Promise<MathJaxInstance> };
    mathJaxPromise = MathJax.init(config);
  }
  return mathJaxPromise;
}

// adaptiveCSS の使用グリフ集計は出力 Jax（global 共有）に溜まる。ページごとに
// clearCache → 一括組版 → スタイルシート抽出を行うため、複数ページを並行して
// 生成しても状態が混ざらないよう、この一連の処理を直列化する。
let renderChain: Promise<unknown> = Promise.resolve();

export type RenderedMath = {
  // texList と同じ並びの、各数式の CHTML HTML 文字列。
  html: string[];
  // このページで実際に使われたグリプンのぶんだけの CHTML スタイルシート（CSS）。
  css: string;
};

// 区切り記号（\(...\) / \[...\] / $$...$$ / \begin{}...\end{}）付きの TeX 文字列の
// 配列を受け取り、まとめて 1 ドキュメントとして組版して各数式の HTML と CSS を返す。
export function renderArticleMath(texList: string[]): Promise<RenderedMath> {
  const run = async (): Promise<RenderedMath> => {
    if (texList.length === 0) return { html: [], css: "" };

    const MathJax = await getMathJax();
    const adaptor = MathJax.startup.adaptor;
    const mathjax = MathJax.startup.mathjax;
    const InputJax = MathJax.startup.input;
    const OutputJax = MathJax.startup.output;

    // 各数式をマーカ要素で包み、記事全体の順序を保った 1 つの本文を作る。
    const body = texList
      .map((tex, i) => `<div data-mjx-slot="${i}">${tex}</div>`)
      .join("\n");
    const doc = mathjax.document(body, { InputJax, OutputJax });

    // 直前のページのグリフ集計を破棄し、このページ固有の CSS だけを得る。
    OutputJax.clearCache?.();
    OutputJax.font?.clearCache?.();

    // TeX の式番号と \label を記事ごとに初期化する。InputJax は全ページで共有される
    // ため、リセットしないと前のページの \label が登録されたまま残り、同じラベルに再遭遇すると
    // "Label multiply defined" となって、その数式が組版結果の代わりにエラー文字列へ
    // 置き換わってしまう（例: sympoly の eq:jacobi-trudi）。
    MathJax.texReset?.();

    // 動的フォント（必要字形の遅延ロード）に対応するため handleRetriesFor で待つ。
    await mathjax.handleRetriesFor(() => doc.render());

    const html = new Array<string>(texList.length).fill("");
    const errors: string[] = [];
    for (const slot of adaptor.childNodes(adaptor.body(doc.document)) ?? []) {
      if (adaptor.kind(slot) !== "div") continue;
      const attr = adaptor.getAttribute(slot, "data-mjx-slot");
      if (attr == null) continue;
      const containers: MathJaxNode[] = [];
      // 組版されずに残った TeX。MathJax が区切り記号の対を見つけられなかった数式
      // （例: 波括弧が閉じていない）は、mjx-container にならず文字のまま残る。
      let leftover = "";
      const walk = (node: MathJaxNode) => {
        const kind = adaptor.kind(node);
        if (kind === "mjx-container") {
          containers.push(node);
          return;
        }
        if (kind === "#text") leftover += adaptor.value(node);
        if (kind.startsWith("#")) return;
        for (const child of adaptor.childNodes(node) ?? []) walk(child);
      };
      walk(slot);
      const problems = [
        ...(leftover.trim() ? ["数式として読み取れません。区切り記号や波括弧が閉じているか確かめてください。"] : []),
        ...containers.flatMap((container) => findTexErrors(adaptor, container)),
      ];
      if (problems.length) {
        errors.push(`${texSource(texList[Number(attr)])}\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
        continue;
      }
      for (const container of containers) {
        labelForScreenReaders(adaptor, container);
        dropLatexSource(adaptor, container);
        mergeGlyphBoxes(adaptor, container);
      }
      html[Number(attr)] = containers.map((c) => adaptor.outerHTML(c)).join("");
    }

    if (errors.length) {
      throw new Error(`数式の誤りが${errors.length}件あります。\n${errors.join("\n")}`);
    }

    const css = glyphBoxStyles(adaptor.textContent(MathJax.chtmlStylesheet()));
    return { html, css };
  };

  const result = renderChain.then(run, run);
  // 例外が出ても直列チェーンは継続させる（ロックを解放する）。
  renderChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// MathJax は TeX の誤りでも例外を投げず、誤りを組版結果に書き込む。TeX の文法の
// 誤りと未定義のマクロは mjx-merror になり、data-mjx-error に理由が入る。\ref と
// \eqref は、記事内にないラベルを指すと「(???)」と href="#" のリンクになる。
function findTexErrors(adaptor: LiteAdaptor, container: MathJaxNode): string[] {
  const errors: string[] = [];
  const walk = (node: MathJaxNode) => {
    const kind = adaptor.kind(node);
    if (kind.startsWith("#")) return;
    if (kind === "mjx-merror") {
      errors.push(adaptor.getAttribute(node, "data-mjx-error") ?? "TeX の誤りです。");
      return;
    }
    if (kind === "a" && adaptor.getAttribute(node, "href") === "#") {
      errors.push("\\ref・\\eqref が指すラベルが記事内にありません。");
    }
    for (const child of adaptor.childNodes(node) ?? []) walk(child);
  };
  walk(container);
  return errors;
}

// 誤りの報告に出す TeX。記事内で検索できるよう、preprocess.ts がインライン数式に
// 足した区切り記号と前後の間隔を外す。
function texSource(tex: string): string {
  const inline = tex.match(/^\\\((?:\\hspace\{[^{}]*\})?([\s\S]*?)(?:\\hspace\{[^{}]*\})?\\\)$/);
  return inline ? inline[1] : tex;
}

// 支援技術向けに、数式を TeX のソースで読ませる（docs/math-accessibility.md）。
//
// CHTML の字形の箱（mjx-c）には 𝑎 や + などの文字が入っているので、そのままだと
// 支援技術は構造のない文字の並び（x^2 が「x2」）として読む。MathJax の見えない
// MathML（a11y/assistive-mml）は構造を伝えられるが、要素数が約 1.5 倍になり、
// 数式記事を開くまでが Firefox で 0.2 秒ほど遅くなったうえ、MathML を数式として
// 読み上げるエンジン（MathCAT など）は日本語に対応していない。そこで TeX を
// role="img" の aria-label にし、字形の箱（mjx-math）には aria-hidden を付ける
//（role="math" は、NVDA が MathML の無い要素を読まなかった報告があるので使わない）。
//
// \eqref の数式は中にリンク（a[href^="#mjx-eqn"]）を含む。img にするとリンクが
// 支援技術から消えるのに Tab では止まるので、手を加えず、見えている「(1)」を読ませる。
function labelForScreenReaders(adaptor: LiteAdaptor, container: MathJaxNode) {
  // Text nodes ("#text") have no child list in the lite adaptor.
  const descendants = (node: MathJaxNode, kind: string): MathJaxNode[] =>
    adaptor.kind(node).startsWith("#") ? [] : (adaptor.childNodes(node) ?? []).flatMap((child) =>
      [...(adaptor.kind(child) === kind ? [child] : []), ...descendants(child, kind)]);
  if (descendants(container, "a").length) return;
  const math = (adaptor.childNodes(container) ?? []).find((child) => adaptor.kind(child) === "mjx-math");
  const latex = math ? adaptor.getAttribute(math, "data-latex") : null;
  if (!math || !latex) return;
  // 式番号（\tag や equation 環境の番号）は mjx-labels の中にあり、TeX には含まれない。
  const tags = descendants(container, "mjx-labels")
    .flatMap((labels) => descendants(labels, "mjx-mtd"))
    .map((cell) => adaptor.textContent(cell).trim())
    .filter(Boolean);
  adaptor.setAttribute(container, "role", "img");
  adaptor.setAttribute(container, "aria-label", speechLabel(latex, tags));
  // Children of an img are presentational, but Chromium still keeps the glyph
  // text in its accessibility tree; hide it explicitly.
  adaptor.setAttribute(math, "aria-hidden", "true");
}

// MathJax は数式の各部分に TeX のソースを data-latex として付ける。使うのは上の
// aria-label を作るときだけで、ブラウザー側では使わない。数式記事では数千個あり、
// HTML の転送・パースと、n段の断片の複製の量を増やすだけなので取り除く。
function dropLatexSource(adaptor: LiteAdaptor, node: MathJaxNode) {
  if (adaptor.kind(node).startsWith("#")) return;
  adaptor.removeAttribute(node, "data-latex");
  for (const child of adaptor.childNodes(node) ?? []) dropLatexSource(adaptor, child);
}

// MathJaxは文字の要素（mjx-mi・mjx-mo・mjx-mn）の中に、字形ごとの箱（mjx-c）を
// 入れる。文字の要素が字形を1つだけ持つときは、外側の要素を省き、その属性（大きさと
// 前後の間隔）をmjx-cに移す。外側の要素はインラインブロックとしてmjx-cをそのまま
// 包むだけで、寸法も位置もmjx-cと同じなので、省いても表示は変わらない。数式記事では
// 本文の要素の約3割がこの外側の要素なので、省くと、ブラウザーがスタイル計算と
// レイアウトをする要素と、n段で複製する要素が減る。外側の要素を前提にしたMathJaxの
// 規則は、glyphBoxStylesで書き換える。
const GLYPH_PARENTS = new Set(["mjx-mi", "mjx-mo", "mjx-mn"]);
const MOVABLE_ATTRIBUTES = new Set(["size", "space", "rspace"]);

function mergeGlyphBoxes(adaptor: LiteAdaptor, node: MathJaxNode) {
  if (adaptor.kind(node).startsWith("#")) return;
  for (const child of [...(adaptor.childNodes(node) ?? [])]) mergeGlyphBoxes(adaptor, child);
  if (!GLYPH_PARENTS.has(adaptor.kind(node))) return;
  const children = adaptor.childNodes(node) ?? [];
  const glyph = children[0];
  if (children.length !== 1 || adaptor.kind(glyph) !== "mjx-c") return;
  const attributes = adaptor.allAttributes(node);
  if (attributes.some(({ name }) => !MOVABLE_ATTRIBUTES.has(name) || adaptor.getAttribute(glyph, name) != null)) return;
  for (const { name, value } of attributes) adaptor.setAttribute(glyph, name, value);
  adaptor.replace(glyph, node);
}

// mergeGlyphBoxesで外側の要素を省いたmjx-cが、省く前と同じ切り抜きと字体で
// 表示されるよう、MathJaxのスタイルシートを書き換える。
// - 文字の要素の中のmjx-cを切り抜く規則（`mjx-mo > mjx-c` など）の対象に、外側の
//   要素のないmjx-cを加える。文字の要素の外にあるmjx-cは伸びる記号の部品だけなので、
//   それは対象から除く。
// - 改行できるインライン数式の子に字体を指定する規則（`mjx-math.TEX-N[breakable] > *`）
//   の対象から、mjx-cを外す。外側の要素があったときは、mjx-cは自分のクラスの字体
//   （.TEX-SOなど）で表示されていた。この規則のほうが詳細度が高いので、mjx-cが数式の
//   直接の子になると、この規則の字体で表示される（例: `\int \dd{x}` の積分記号）。
function glyphBoxStyles(css: string): string {
  const clip = /(mjx-mo > mjx-c, mjx-mi > mjx-c, mjx-mn > mjx-c[^{]*)\{/;
  // MathJaxの更新で規則の書き方が変わると、字形を切り抜けなくなるので、ビルドを止める。
  if (!clip.test(css)) throw new Error("MathJax のスタイルシートに mjx-c の切り抜きの規則が見つかりません。");
  return css
    .replace(clip, "$1, mjx-c:not(mjx-stretchy-h > * > mjx-c) {")
    .replace(/(mjx-math\.[\w-]+\[breakable\] > )\*/g, "$1:not(mjx-c)");
}

// --- 最小限の型（mathjax node 版に型定義が無いため必要なぶんだけ宣言）---

type MathJaxNode = unknown;

type LiteAdaptor = {
  body: (doc: unknown) => MathJaxNode;
  childNodes: (node: MathJaxNode) => MathJaxNode[] | undefined;
  kind: (node: MathJaxNode) => string;
  getAttribute: (node: MathJaxNode, name: string) => string | null;
  setAttribute: (node: MathJaxNode, name: string, value: string) => void;
  removeAttribute: (node: MathJaxNode, name: string) => void;
  allAttributes: (node: MathJaxNode) => { name: string; value: string }[];
  replace: (newNode: MathJaxNode, oldNode: MathJaxNode) => MathJaxNode;
  outerHTML: (node: MathJaxNode) => string;
  textContent: (node: MathJaxNode) => string;
  value: (node: MathJaxNode) => string;
};

type MathJaxInstance = {
  chtmlStylesheet: () => MathJaxNode;
  // tex 入力ロード時に startup が生やす。式番号と \label/\eqref の登録を初期化する。
  texReset?: (start?: number | number[]) => void;
  startup: {
    adaptor: LiteAdaptor;
    input: unknown;
    output: {
      clearCache?: () => void;
      font?: { clearCache?: () => void };
    };
    mathjax: {
      document: (body: string, options: { InputJax: unknown; OutputJax: unknown }) => {
        document: unknown;
        render: () => void;
      };
      handleRetriesFor: (fn: () => void) => Promise<void>;
    };
  };
};
