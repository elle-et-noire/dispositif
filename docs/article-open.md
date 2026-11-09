# 記事を開くまでの処理

一覧から記事を開くとき（ClientRouterによる遷移）と、記事を直接読み込むときの表示を速くするために入れている処理と、その計測方法を説明します。各処理を入れた経緯と計測値は `docs/column-preload-investigation.md` にあります。

## 処理

- 数式フォントの先読み（`src/scripts/math-font-prefetch.ts`、`lib/math-fonts.ts`）: ビルド時に記事ごとの数式フォントを `data-math-fonts` に書き出し、一覧のカードにホバーまたはフォーカスすると `FontFace.load()` で読み込みます。条件はAstroのHTML先読みに合わせ、タッチ、オフライン、データ節約、低速回線では行いません。`astro:before-swap` で読み込み済みのフォントを `document.fonts` に記事の `@font-face` と同じ名前で加え、遷移先の文書から同じフォントの `@font-face` とpreloadを取り除きます。
- 数式フォントのpreload（`src/pages/[slug].astro`）: 記事が使う数式フォントをすべて `<link rel="preload">` で読み込みます。最初のレイアウトの途中で見つかったフォントはそのレイアウトの後に届き、届くたびに記事全体をレイアウトし直すためです。Nunitoはpreloadしません。FCPが遅れるだけで、レイアウトの回数は減らなかったためです。
- n段で本文を段へ入れている間（`cl-premount`）は、目次が見出しの位置を読みません（`src/components/Toc.astro`）。n段では `column-layout.ts` が `cl:heading` で現在の見出しを伝えるので、ここで位置を読むと、記事全体のレイアウトを強制するだけになります。1段で始めるときは、段組みが `cl:single` を送り、目次がそこで位置を合わせます。
- n段の本文を先に段へ入れる（`src/layouts/Layout.astro` のheadのスクリプト）: 遷移先URLの `?columns=`、指定がなければ保存された選択でn段になるときだけ、遷移では `astro:before-swap`、直接の読み込みではMutationObserverで `.cl-source` を段の幅の枠へ移し、本文を1段の幅でレイアウトしないようにします。本文の途中にインラインスクリプトは置きません。Firefoxでパース中にスタイル計算が入ったためです。
- 準備中の本文は `clip-path: inset(50%)` と、スクロールポートの `aria-hidden="true"` で隠します。`visibility: hidden` は外すときに本文全体のスタイル計算を起こすので使いません。JavaScriptが無いときは何も付けません。準備中はTabキーを無視し、隠れた本文にフォーカスが入らないようにします。`inert` は `visibility` と同じく付け外しで本文全体のスタイル計算を起こすので使いません。
- `astro.config.mjs` のViteプラグインが、Tailwind Typographyの `[class~=not-prose]` を `.not-prose` に書き換えます。`<html>` のクラスが変わるたびにChromiumが文書全体のスタイルを計算し直すのを避けるためです。

## 計測

計測は本番ビルドを `astro preview` で配信して行います。

```sh
npm run build && npx astro preview --background
TRACE=0 node scripts/measure-article-open.mjs http://localhost:4321/dispositif/ 3 > out.jsonl
npx astro preview stop
```

`ENGINES`・`ARTICLES`・`MODES`・`CACHES` で条件を絞り、`NAV=direct` で直接の読み込みを測ります。各変数の意味は `scripts/measure-article-open.mjs` の冒頭にあります。トレースは時間を延ばすので、壁時計の比較は `TRACE=0` で行います。計測中に他の重い処理があると回ごとに±30ms程度揺れるので、小さな差は12回以上交互に測って確かめます。

Lighthouseや回線を遅くした計測では、GitHub Pagesと同じくgzipで配信します。`python -m http.server` は圧縮せずにHTMLを送るので、FCPと帯域の条件が変わり、比較に使えません。

## 残っている課題

急がないので、2026-11-09にROADMAPから外しました。

- n段では、本文全体を段の幅でレイアウトする1回と、画面内の段の複製のスタイル計算・レイアウト・描画が残る。減らすには、ブロック単位で組み立てるなど組み立て方そのものを変える必要がある（`docs/column-preload-investigation.md` の「n段の組み立ての内訳と短縮」）。
- Chromiumのn段で、`page-load→visible` に11〜15msのスタイル計算が残る。原因は未調査。
- Chromiumの `after-swap→page-load` の約31msは、これまでの変更で変わっていない。内訳は未調査。
