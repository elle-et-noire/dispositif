// ビルド時（サーバーサイド）に数式を MathJax v4 の CHTML へ組版するモジュール。
//
// plan.md の方針: 数式はビルド時に完全に HTML/CSS へ変換し、ブラウザ側では
// MathJax の JavaScript を一切実行しない（クライアント JS 0KB）。CHTML が必要と
// する CSS は実際に使われたグリフのぶんだけ（adaptiveCSS）抽出してページに
// インライン化し、Web フォント (woff2) は @font-face 経由で CDN から読み込む。
//
// 記事内の数式は 1 つの MathJax ドキュメントとしてまとめて組版する。これにより
// \label / \eqref による式番号の連番と相互参照（前方参照を含む）が記事全体で
// 正しく解決される（数式を 1 つずつ変換すると番号がリセットされ参照が壊れる）。

import { createRequire } from "node:module";

// mathjax の node 版 API は CommonJS（node-main.cjs）で型定義も無いため、
// Next/Turbopack のバンドル対象から外して（next.config の serverExternalPackages）
// 実行時に node_modules から require する。
const require = createRequire(import.meta.url);

// CDN 上の mathjax-newcm フォントパッケージ。@font-face の src がこのパスを指す。
// 末尾に /chtml/woff2 を補って各 woff2 を参照する（例: mjx-ncm-n.woff2）。
const FONT_URL = "https://cdn.jsdelivr.net/npm/@mathjax/mathjax-newcm-font@4/chtml/woff2";

// クライアント側だった component/mathenv.tsx と同一の TeX 設定を再現する。
// 出力のみ SVG → CHTML（ビルド時）に置き換える。
const config = {
  loader: {
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
      eqref: ["{\\large \\ref{#1}}", 1],
    },
    tags: "ams",
    tagSide: "right",
    tagIndent: "0.8em",
  },
  chtml: {
    // plan.md #3: 周囲フォントとの高さ自動合わせを無効化（CPU 負荷削減）。
    matchFontHeight: false,
    // plan.md #2: 実際に出現したグリフのぶんだけ CSS を生成する。
    adaptiveCSS: true,
    displayOverflow: "overflow",
    mtextInheritFont: true,
    scale: 0.88,
    // @font-face の src を CDN のフォントパッケージへ向ける（ブラウザは JS 無しで
    // CSS 経由のみ woff2 を読み込む）。グリフのメトリクスはビルド時にローカルの
    // フォントパッケージから読まれるため、ここはブラウザ向けの URL のみを指す。
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
// clearCache → 一括組版 → スタイルシート抽出を行うため、Next が複数ページを
// 並行生成しても状態が混ざらないよう、この一連の処理を直列化する。
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

    // 動的フォント（必要字形の遅延ロード）に対応するため handleRetriesFor で待つ。
    await mathjax.handleRetriesFor(() => doc.render());

    const html = new Array<string>(texList.length).fill("");
    for (const slot of adaptor.childNodes(adaptor.body(doc.document)) ?? []) {
      if (adaptor.kind(slot) !== "div") continue;
      const attr = adaptor.getAttribute(slot, "data-mjx-slot");
      if (attr == null) continue;
      const containers: MathJaxNode[] = [];
      const walk = (node: MathJaxNode) => {
        if (adaptor.kind(node) === "mjx-container") {
          containers.push(node);
          return;
        }
        for (const child of adaptor.childNodes(node) ?? []) walk(child);
      };
      walk(slot);
      html[Number(attr)] = containers.map((c) => adaptor.outerHTML(c)).join("");
    }

    const css = adaptor.textContent(MathJax.chtmlStylesheet());
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
  chtmlStylesheet: () => MathJaxNode;
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
