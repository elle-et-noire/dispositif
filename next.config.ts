import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // 数式はビルド時に mathjax の node 版で CHTML へ組版する（lib/mathjax.ts）。
  // これらのパッケージは動的にフォントコンポーネントを require するため、
  // バンドルせず実行時に node_modules から解決させる。
  serverExternalPackages: ["mathjax", "@mathjax/src", "@mathjax/mathjax-newcm-font"],
};

export default nextConfig;
