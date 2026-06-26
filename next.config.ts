import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // 数式はビルド時に mathjax の node 版で SVG へ組版する（lib/mathjax.ts）。
  // これらのパッケージは動的にフォントコンポーネントを require するため、
  // バンドルせず実行時に node_modules から解決させる。
  serverExternalPackages: [
    "mathjax",
    "@mathjax/src",
    // 数式グリフのフォント。既定の newcm に加え、実際に使う TeX フォント（svg.font:
    // "mathjax-tex"）も MathJax が動的に require するため外部化が要る。
    "@mathjax/mathjax-newcm-font",
    "@mathjax/mathjax-tex-font",
    // ビルド時に \text（\tag/\eqref ラベル）の字幅を実測するため実行時に node_modules
    // から require する（lib/mathjax.ts の patchMeasureText）。バンドルすると require が
    // 壊れて計測が無効化され、タグに隙間が出る。@fontsource は require せず fs で woff を
    // 直接読むため外部化は不要（パスは process.cwd() から組む）。
    "opentype.js",
  ],
};

export default nextConfig;
