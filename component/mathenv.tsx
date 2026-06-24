"use client";

import { MathJaxContext } from "better-react-mathjax";

export type Props = {
  children: React.ReactNode;
};

export default function MathEnvironment(props: Props) {
  const config = {
    loader: {
      load: ['[tex]/html', '[tex]/physics', '[tex]/mathtools', '[tex]/color', '[tex]/upgreek', '[tex]/centernot', '[tex]/tagformat']
    },
    tex: {
      packages: { '[+]': ['html', 'physics', 'mathtools', 'color', 'upgreek', 'centernot', 'tagformat'] },
      inlineMath: [['$', '$'], ['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']],
      macros: {
        parn: ["\\biggl(#1\\biggr)", 1],
        sqbr: ["\\biggl[#1\\biggr]", 1],
        pfrac: ["\\biggl(\\dfrac{#1}{#2}\\biggr)", 2],
        ds: "\\displaystyle",
        C: '{\\mathbb C}',
        R: '{\\mathbb R}',
        Q: '{\\mathbb Q}',
        Z: '{\\mathbb Z}',
        bm: ['\\pmb{#1}', 1],
        defiff: '{\\stackrel{\\mathrm{def}}{\\iff}}',
        i: '{\\mathrm{i}}',
        e: '{\\mathrm{e}}',
        Im: '\\operatorname{Im}',
        det: '\\operatorname*{det}',
        eqref: ['{\\large \\ref{#1}}', 1]
      },
      tags: 'ams',
      tagSide: 'right',
      tagIndent: '0.8em',
      // tagformat: {
      //   tag: (n) => '{\\large (' + n + ')}'
      // }
    },
    svg: {
      fontCache: 'global',
      displayOverflow: 'overflow',
      mtextInheritFont: true,
      scale: 0.88,
    },
    // 既定の mathjax-newcm フォントを使う。これは tex-svg.js バンドルに
    // 同梱されているため追加ダウンロードが発生しない（≈ MathJax v3 の単一バンドル）。
    // 'mathjax-tex' を指定すると別パッケージ (~466KB) を tex-svg.js のパース後に
    // CDN からウォーターフォールで取得し、その完了まで hideUntilTypeset により
    // 記事全体が非表示のままになるため、初回表示が大幅に遅くなる。
    // （旧 TeX フォントの見た目を厳密に保ちたい場合は MathJax の自己ホストを検討）
    // output: {
    //   font: 'mathjax-modern'
    // },
    // better-react-mathjax が各 <MathJax> 単位で typeset するため、
    // MathJax 既定の「読み込み時に文書全体を自動 typeset」を無効化する。
    // これを有効のままにすると、React のハイドレーション前に DOM が
    // 書き換わり hydration mismatch を起こす。
    startup: {
      typeset: false
    },
    // MathJax v4 はデフォルトで semantic enrichment（SRE: Speech Rule
    // Engine による音声・点字ラベル生成）を有効化する。これは v3 には無かった
    // 挙動で、数式1つごとに SRE が構文木を解析して読み上げ用ノードを生成するため
    // typeset の CPU 時間を数倍に押し上げる（対称多項式の記事＝約196式で実測:
    // typeset ~7600ms / 音声ノード4808個 → enrich:false で ~1600ms / 0個。
    // v3 同等まで短縮。あわせて SRE worker と mathmaps JSON の追加ダウンロード
    // (~167KB) も無くなる）。スクリーンリーダ向けの読み上げ情報は失われるが、
    // v3 でもそもそも生成していなかったため挙動は v3 と一致する。
    // 無効化は document オプションではなくメニュー設定経由でないと効かない点に注意
    // （メニューの settings が startup 時に document.options を上書きするため）。
    options: {
      menuOptions: {
        settings: {
          enrich: false
        }
      }
    }
  };

  return (
    <MathJaxContext version={4} config={config} src='https://cdn.jsdelivr.net/npm/mathjax@4/tex-svg.js'>
      {props.children}
    </MathJaxContext>
  );
}
