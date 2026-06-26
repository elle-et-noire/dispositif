// ビルド時（サーバーサイド）に数式を MathJax v4 の SVG へ組版するモジュール。
//
// 方針: 数式はビルド時に完全に SVG（ベクターパス）へ変換し、ブラウザ側では
// MathJax の JavaScript を一切実行しない（クライアント JS 0KB）。SVG 出力は
// グリフを <path> として文書内に持つため Web フォント (woff2) も不要で、CHTML の
// ような大量の inline-styled ボックス（DOM ノード）も発生しない。数式の表示完了が
// フォント往復に依存せず、レンダリング完了が速い（多数の数式があるページで有利）。
//
// グリフのパス定義はページ単位のグローバルキャッシュ（fontCache: "global"）で
// 1 グリフ 1 回だけ <defs> に格納し、各数式は <use> で参照する（重複排除）。この
// <defs> はページに一度だけ出力する必要があるため、RenderedMath.defs として返す。
// キャッシュ ID は「MJX-(variant)-(文字コード)」とグリフ内容で決定的に決まるため、
// SPA 遷移で前後ページの <defs> が一瞬共存しても同一 ID は同一パスを指し衝突しない。
//
// 記事内の数式は 1 つの MathJax ドキュメントとしてまとめて組版する。これにより
// \label / \eqref による式番号の連番と相互参照（前方参照を含む）が記事全体で
// 正しく解決される（数式を 1 つずつ変換すると番号がリセットされ参照が壊れる）。

import { createRequire } from "node:module";
import { join } from "node:path";

// mathjax の node 版 API は CommonJS（node-main.cjs）で型定義も無いため、
// Next/Turbopack のバンドル対象から外して（next.config の serverExternalPackages）
// 実行時に node_modules から require する。
const require = createRequire(import.meta.url);

// mathjax のコンポーネント（input/tex.js など）の動的ロード元（ルート）。
// 既定では mathjax の node-main が記録した __dirname を使うが、Turbopack が
// （serverExternalPackages を外して）node-main をバンドルすると __dirname が
// "/ROOT/node_modules/mathjax" のような仮想パスに書き換わり、CI のビルド時に
// "Can't load /ROOT/node_modules/mathjax/input/tex.js" で失敗する。これを避けるため
// 実行時の作業ディレクトリ（next build の実行元 = プロジェクトルート）から
// 実体パスを組み立て、loader.paths.mathjax で明示する（__dirname に依存しない）。
const MATHJAX_ROOT = join(process.cwd(), "node_modules", "mathjax");

// クライアント側だった component/mathenv.tsx と同一の TeX 設定を、出力を SVG にして
// ビルド時に再現する。
const config = {
  loader: {
    // コンポーネントのロード元を実体パスで固定する（上記 MATHJAX_ROOT 参照）。
    paths: { mathjax: MATHJAX_ROOT },
    load: [
      "input/tex",
      "output/svg",
      "[tex]/html",
      "[tex]/physics",
      "[tex]/mathtools",
      "[tex]/color",
      "[tex]/upgreek",
      "[tex]/centernot",
      "[tex]/tagformat",
    ],
  },
  tex: {
    packages: { "[+]": ["html", "physics", "mathtools", "color", "upgreek", "centernot", "tagformat"] },
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
      bm: ["\\pmb{#1}", 1],
      defiff: "{\\stackrel{\\mathrm{def}}{\\iff}}",
      i: "{\\mathrm{i}}",
      e: "{\\mathrm{e}}",
      Im: "\\operatorname{Im}",
      det: "\\operatorname*{det}",
      eqref: ['{\\ref{#1}}', 1],
    },
    tags: "ams",
    tagSide: "right",
    tagIndent: "0.8em",
  },
  svg: {
    // 数式グリフのフォント。MathJax v4 の既定 New Computer Modern（mathjax-newcm）は
    // 線が細く、標準 DPI でヘアラインがアンチエイリアスでにじんで粗く見える。MathJax v3
    // 時代の TeX フォント（mathjax-tex）は線がしっかりしていて表示が安定するため、これを
    // 使う。動的グリフ（\mathbb など）も含め MathJax の loader が @mathjax/mathjax-tex-font
    // から実行時に require する（next.config の serverExternalPackages で外部化）。
    font: "mathjax-tex",
    // 長い数式は枠外へあふれさせる（横スクロールは .scrollable 側で扱う）。
    displayOverflow: "overflow",
    scale: 1.0,
    // ページ単位でグリフのパス定義を共有する（重複排除）。各数式は <use> で参照し、
    // パス本体は 1 枚の <defs>（RenderedMath.defs）にまとめてページへ一度だけ出力する。
    fontCache: "global",
    // \text（\tag や \eqref のラベルを含む）を MathJax フォントのグリフ（<path>）では
    // なく実テキスト（<text>）として出力させ、本文と同じ Zen Maru Gothic を適用する。
    // mtextFont を非空にすると mtext が -explicitFont 経路に乗り、文字列全体が 1 つの
    // <text>（font-family 属性なし＝CSS で指定可）になる。クライアント版の
    // mtextInheritFont:true は実行時に DOM から周囲フォントを実測する仕組みで、DOM の
    // 無いビルド時（liteAdaptor）では機能しないため、explicit-font ＋ 下記 measureText の
    // 自前実測（getMathJax 参照）で字幅を求めて代替する。値自体は CSS が上書きするので
    // レンダリング結果には出ない。
    mtextFont: "Zen Maru Gothic",
  },
  // ビルド時に手動で組版するので、読み込み時の自動 typeset は不要。
  startup: { typeset: false },
};

// --- 実テキスト（<text>）の字幅をビルド時に実測するための Zen Maru Gothic 読み込み ---
//
// mtextFont により mtext は -explicitFont 経路で 1 つの <text> になるが、その字幅は
// SVG 出力の measureTextNode → liteAdaptor.nodeSize に依存し、DOM の無いビルド時は
// 常に 0 を返す（= 字幅 0 で閉じ括弧などが重なる）。そこで本文と同じ Zen Maru Gothic の
// フォントメトリクスを opentype.js で直接読み、measureTextNode を自前実装で差し替える。
//
// ラテン等は実フォントのアドバンス幅で測る。CJK・かな・全角記号は Zen Maru でも
// 全角（1em）固定なので latin サブセットに無い字は 1em として扱う（日本語本文では
// これで正確）。ゼロ幅文字（ZWSP 等）は 0 幅にする（誤って 1em にすると隙間になる）。
const ZERO_WIDTH_CODEPOINTS = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

type OpenTypeFont = {
  unitsPerEm: number;
  charToGlyph: (ch: string) => { index: number; advanceWidth?: number };
};

let latinFontsCache: OpenTypeFont[] | null = null;

function getLatinFonts(): OpenTypeFont[] {
  if (latinFontsCache) return latinFontsCache;
  const opentype = require("opentype.js") as { parse: (buf: ArrayBuffer) => OpenTypeFont };
  const fs = require("node:fs") as typeof import("node:fs");
  // require.resolve はバンドラに横取りされ数値のモジュール ID を返すため使えない
  // （MATHJAX_ROOT と同様の理由）。実行元（プロジェクトルート）から実体パスを組む。
  const zmgDir = join(process.cwd(), "node_modules", "@fontsource", "zen-maru-gothic");
  // latin（ASCII）と latin-ext（アクセント付きラテン）。本文と同じ 500（medium）。
  const files = [
    "zen-maru-gothic-latin-500-normal.woff",
    "zen-maru-gothic-latin-ext-500-normal.woff",
  ];
  const fonts: OpenTypeFont[] = [];
  for (const f of files) {
    const buf = fs.readFileSync(join(zmgDir, "files", f));
    fonts.push(opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  latinFontsCache = fonts;
  return fonts;
}

// MathJax の SVG measureTextNode を、Zen Maru Gothic の実測幅を返す実装へ差し替える。
// 返り値は元実装と同じ {w, h, d}（h/d は元実装どおり固定、w のみ実測）。w は em 単位で、
// 元実装の getBBox().width/1000 と整合させるため「文字列の自然 em 幅 × (font-size/1000)」。
// font-size は unknownText が x-height 基準で付ける値（数式スケールに追従）を node から読む。
function patchMeasureText(MathJax: MathJaxInstance): void {
  const adaptor = MathJax.startup.adaptor;
  const output = MathJax.startup.output;
  let fonts: OpenTypeFont[];
  try {
    fonts = getLatinFonts();
  } catch {
    return; // フォント読み込みに失敗したら元実装のまま（ビルドは止めない）。
  }
  output.measureTextNode = (textNode: unknown) => {
    const text = adaptor.textContent(textNode);
    const fs = adaptor.getAttribute(textNode, "font-size");
    const scale = fs ? parseFloat(fs) : 884;
    let em = 0; // 文字列の自然幅（em 単位）
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      if (ZERO_WIDTH_CODEPOINTS.has(cp)) continue;
      let adv: number | null = null;
      for (const font of fonts) {
        const g = font.charToGlyph(ch);
        if (g.index !== 0 && g.advanceWidth != null) {
          adv = g.advanceWidth / font.unitsPerEm;
          break;
        }
      }
      em += adv ?? 1; // latin サブセットに無い字は全角（1em）扱い
    }
    return { w: (em * scale) / 1000, h: 0.75, d: 0.2 };
  };
}

// MathJax は global を共有する単一インスタンスのため一度だけ初期化する。
let mathJaxPromise: Promise<MathJaxInstance> | null = null;

function getMathJax(): Promise<MathJaxInstance> {
  if (!mathJaxPromise) {
    const MathJax = require("mathjax") as { init: (c: unknown) => Promise<MathJaxInstance> };
    mathJaxPromise = MathJax.init(config).then((mj) => {
      patchMeasureText(mj);
      return mj;
    });
  }
  return mathJaxPromise;
}

// グローバルフォントキャッシュは出力 Jax（global 共有）に溜まる。ページごとに
// clearFontCache → 一括組版 → <defs>・スタイルシート抽出を行うため、Next が複数
// ページを並行生成しても状態が混ざらないよう、この一連の処理を直列化する。
let renderChain: Promise<unknown> = Promise.resolve();

export type RenderedMath = {
  // texList と同じ並びの、各数式の SVG HTML 文字列（グリフは <defs> を <use> 参照）。
  html: string[];
  // SVG 出力用の小さなスタイルシート（mjx-container の表示規則など）。
  css: string;
  // このページで使われたグリフのパス定義をまとめた <svg style="display:none"><defs>…。
  // <use> の参照解決のためページに一度だけ出力する。数式が無いページでは空文字列。
  defs: string;
};

// 区切り記号（\(...\) / \[...\] / $$...$$ / \begin{}...\end{}）付きの TeX 文字列の
// 配列を受け取り、まとめて 1 ドキュメントとして組版して各数式の HTML と CSS を返す。
export function renderArticleMath(texList: string[]): Promise<RenderedMath> {
  const run = async (): Promise<RenderedMath> => {
    if (texList.length === 0) return { html: [], css: "", defs: "" };

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

    // 直前のページのグリフキャッシュを破棄し、このページ固有の <defs> だけを得る。
    OutputJax.clearFontCache?.();

    // TeX の式番号と \label を記事ごとに初期化する。InputJax は全ページで共有される
    // ため、リセットしないと前のページ（や Next が同一ワーカーで同じページを複数回
    // 生成した際）の \label が登録されたまま残り、同じラベルに再遭遇すると
    // "Label multiply defined" となって、その数式が組版結果の代わりにエラー文字列へ
    // 置き換わってしまう（例: sympoly の eq:jacobi-trudi）。
    MathJax.texReset?.();

    // 動的フォント（必要字形の遅延ロード）に対応するため handleRetriesFor で待つ。
    await mathjax.handleRetriesFor(() => doc.render());

    // render() は本文に、各数式（data-mjx-slot の div）と並べて、グローバルキャッシュの
    // グリフ定義 <svg id="MJX-SVG-global-cache" style="display:none"> を 1 つ挿入する。
    // スロットの div からは数式 <mjx-container> を、キャッシュ svg はそのまま取り出す。
    const html = new Array<string>(texList.length).fill("");
    let defs = "";
    for (const node of adaptor.childNodes(adaptor.body(doc.document)) ?? []) {
      const kind = adaptor.kind(node);
      if (kind === "svg" && adaptor.getAttribute(node, "id") === "MJX-SVG-global-cache") {
        defs = adaptor.outerHTML(node);
        continue;
      }
      if (kind !== "div") continue;
      const attr = adaptor.getAttribute(node, "data-mjx-slot");
      if (attr == null) continue;
      const containers: MathJaxNode[] = [];
      const walk = (n: MathJaxNode) => {
        if (adaptor.kind(n) === "mjx-container") {
          containers.push(n);
          return;
        }
        for (const child of adaptor.childNodes(n) ?? []) walk(child);
      };
      walk(node);
      html[Number(attr)] = containers.map((c) => adaptor.outerHTML(c)).join("");
    }

    const css = adaptor.textContent(MathJax.svgStylesheet());

    return { html, css, defs };
  };

  const result = renderChain.then(run, run);
  // 例外が出ても直列チェーンは継続させる（ロックを解放する）。
  renderChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// --- 最小限の型（mathjax node 版に型定義が無いため必要なぶんだけ宣言）---

type MathJaxNode = unknown;

type LiteAdaptor = {
  body: (doc: unknown) => MathJaxNode;
  childNodes: (node: MathJaxNode) => MathJaxNode[] | undefined;
  kind: (node: MathJaxNode) => string;
  getAttribute: (node: MathJaxNode, name: string) => string | null;
  outerHTML: (node: MathJaxNode) => string;
  textContent: (node: MathJaxNode) => string;
};

type MathJaxInstance = {
  svgStylesheet: () => MathJaxNode;
  // tex 入力ロード時に startup が生やす。式番号と \label/\eqref の登録を初期化する。
  texReset?: (start?: number | number[]) => void;
  startup: {
    adaptor: LiteAdaptor;
    input: unknown;
    output: {
      // SVG 出力 Jax: ページごとにグローバルフォントキャッシュを破棄する。
      clearFontCache?: () => void;
      // 実テキストの字幅をビルド時に実測するため自前実装で差し替える（patchMeasureText）。
      measureTextNode: (text: unknown) => { w: number; h: number; d: number };
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
