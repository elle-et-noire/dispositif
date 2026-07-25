# Dispositif

Next.js版のブログをAstroへ移植した静的サイトです。記事はビルド時にMarkdownからHTMLへ変換し、数式はMathJax v4のCHTMLとして出力します。ブラウザ側ではMathJaxを実行せず、数式フォントも同一オリジンから配信します。

## 構成

```text
/
├── lib/                    # 記事取得、Markdown前処理、MathJax変換
├── post/                   # Markdown記事
├── public/
│   └── fonts/mjx/          # predev / prebuildで生成
├── scripts/
│   └── copy-math-fonts.mjs
└── src/
    ├── components/
    ├── layouts/
    ├── pages/
    │   ├── index.astro
    │   └── [slug].astro
    └── styles/globals.css
```

## コマンド

```sh
npm install
npx astro dev --background
npm run build
npm run astro -- check
```

バックグラウンドの開発サーバーは次のコマンドで管理できます。

```sh
npx astro dev status
npx astro dev logs
npx astro dev stop
```
