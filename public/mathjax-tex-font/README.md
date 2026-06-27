# MathJax TeX font (self-hosted)

`@mathjax/mathjax-tex-font` の woff2 を同一オリジン配信するために複製したもの。
CHTML の @font-face / preload がこの `woff2/` を参照する（`lib/mathjax.ts`）。

- 出典: https://www.npmjs.com/package/@mathjax/mathjax-tex-font （v4.1.2）
- ライセンス: Apache-2.0
- 更新方法: `cp node_modules/@mathjax/mathjax-tex-font/chtml/woff2/*.woff2 public/mathjax-tex-font/woff2/`
