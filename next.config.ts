import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // 数式はビルド時に mathjax の node 版で CHTML へ組版する（lib/mathjax.ts）。
  // これらのパッケージは動的にフォントコンポーネントを require するため、
  // バンドルせず実行時に node_modules から解決させる。
  serverExternalPackages: [
    "mathjax",
    "@mathjax/src",
    "@mathjax/mathjax-newcm-font",
    // ビルド時に \text（\tag/\eqref ラベル）の字幅を実測するため実行時に node_modules
    // から require する（lib/mathjax.ts の patchMeasureText）。バンドルすると require が
    // 壊れて計測が無効化され、タグに隙間が出る。@fontsource は require せず fs で woff を
    // 直接読むため外部化は不要（パスは process.cwd() から組む）。
    "opentype.js",
  ],
};

export default nextConfig;
