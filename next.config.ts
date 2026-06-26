import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // 数式はビルド時に mathjax の node 版で CHTML へ組版する（lib/mathjax.ts）。
  // これらのパッケージは動的にフォントコンポーネントを require するため、
  // バンドルせず実行時に node_modules から解決させる。
  serverExternalPackages: [
    "mathjax",
    "@mathjax/src",
    // 既定の newcm に加え、実際に使う TeX フォント（chtml.font: "mathjax-tex"）も
    // MathJax が動的に require するため、両方を外部化する。
    "@mathjax/mathjax-newcm-font",
    "@mathjax/mathjax-tex-font",
  ],
};

export default nextConfig;
