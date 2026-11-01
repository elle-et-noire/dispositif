# [Dispositif](https://elle-et-noire.github.io/dispositif/)

Astroベースの記事サイトです。記事はビルド時にMarkdownからHTMLへ変換し、数式はMathJax v4のCHTMLとして出力します。ブラウザ側ではMathJaxを実行せず、数式フォントも同一オリジンから配信します。

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

## 記事の読書モード

記事右上の「1段 / n段」で切り替えます。選択は `localStorage` に保存し、未選択時は画面幅が段の周期の2倍以上なら n段にします。JavaScript 無効時と印刷時は通常のレイアウトです。

段幅と間隔は `src/styles/reading-mode.css` の CSS 変数で調整できます。

```css
:root {
  --rm-column-width: min(38em, calc(100vw - 2rem));
  --rm-gap: 2rem;
  --rm-context-overlap: 0.75lh;
  --rm-surface: #f8f8f8;
  --rm-ink: #324e73;
}
```

`ReadingMode.astro` と `src/scripts/reading-mode.ts` が全記事を拡張します。各段の表示枠はヘッダ・操作バーを除いた表示領域と同じ高さで固定します。縦にスクロールすると枠はその場に残り、全段の本文が一斉に上へ流れます。左段の下端と右段の上端には既定で3/4行分の同じ本文を重ね、重複部分だけを穏やかに薄く表示します。上下端に同じ字形が残ることで本文のつながりを追えるようにしています。重なりは `--rm-context-overlap` で調整でき、`0px` にすると重複のない連続配置に戻ります。

表示枠の高さと位置は CSS の sticky で維持し、縦の切り抜きは共通のスクロール領域、段幅の切り抜きはスクロール面と一緒に動くレールの clip-path で行います。本文は共通のスクロール面を基準に配置するため、縦の動きに JS の同期処理は使いません。スクロール距離を確保する透明なレールだけに本文全体の高さを持たせます。固定枠自体にはクリップを設定しません（スクロール時に後続の本文まで描画から落ちるため）。複製数の上限は「表示幅 / 段の周期を切り上げた数 + 2」で、記事の長さに依存しません。横方向は画面幅にかかわらず吸着せず自由にスクロールできます。通常の縦スクロールでは複製を更新しません。

- PageDown / Space: 見えている段数分を縦に進む。縦の端では横移動。
- PageUp / Shift+Space: 逆方向へ移動。
- 左右キー: 1段分の横移動。Home / End: 先頭 / 末尾。
- 目次・数式参照・URL ハッシュ: 元本文の ID から位置を測り、到達できる候補のうち最短距離へ移動。

本文の操作要素は折りたたみとコードコピーです。折りたたみは元本文と全スロットで開閉状態を共有し、コードコピーは既存のイベント委譲で動作します。実行型コードやクライアント側の数式レンダラはありません。画像の実寸を計測するため、n段を有効にした記事では元本文の画像を先読みします。

制約: ブラウザのページ内検索では複製もヒットする場合があります。別の段をまたぐ文字選択・コピーでは、各段が独立した本文複製であることが影響します。複製は支援技術と Tab 移動から除外し、元本文の ID とアクセシビリティツリーを残しています。現在のサイトはライトテーマで、読書モードも既存の本文色を使います。

座標・最短移動・スロット数・位置復元の回帰テストは `npm test`、型チェックは `npm run astro -- check` で実行します。開発サーバでは長い記事、モバイル幅、斜めホイール、折りたたみ・コピー、ハッシュ、印刷、ClientRouter 遷移も確認してください。

描画の回帰テストは、開発サーバを起動した状態で `npm run test:browser` を実行します。初回は `npx playwright-core install chromium` で検証用ブラウザを用意します。既存の Chromium は `RM_BROWSER_PATH`、別のサーバは `RM_BASE_URL` で指定できます。テストはデスクトップ幅とモバイル幅で本文を縦横にスクロールし、段の下端まで正しい本文が描画されたことをスクリーンショットの画素で検証します。
