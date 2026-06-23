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
    }
  };

  return (
    <MathJaxContext version={4} config={config} src='https://cdn.jsdelivr.net/npm/mathjax@4/tex-svg.js'>
      {props.children}
    </MathJaxContext>
  );
}
