# 記事を開くまでの処理

一覧から記事を開くとき（ClientRouterによる遷移）と、記事を直接読み込むときの表示を速くするために入れている処理、その計測方法、採らなかった方式を説明します。

## 処理

- 数式フォントの先読み（PR #2・#5、`src/scripts/math-font-prefetch.ts`、`lib/math-fonts.ts`）: ビルド時に記事ごとの数式フォントを `data-math-fonts` に書き出し、一覧のカードにホバーまたはフォーカスすると `FontFace.load()` で読み込みます。条件はAstroのHTML先読みに合わせ、タッチ、オフライン、データ節約、低速回線では行いません。`astro:before-swap` で読み込み済みのフォントを `document.fonts` に記事の `@font-face` と同じ名前で加え、遷移先の文書から同じフォントの `@font-face` とpreloadを取り除きます。
- 数式フォントのpreload（PR #24、`src/pages/[slug].astro`）: 記事が使う数式フォントをすべて `<link rel="preload">` で読み込みます。最初のレイアウトの途中で見つかったフォントはそのレイアウトの後に届き、届くたびに記事全体をレイアウトし直すためです。Nunitoはpreloadしません。FCPが遅れるだけで、レイアウトの回数は減らなかったためです。
- 目次の位置合わせ（PR #24、`src/components/Toc.astro`）: n段で本文を段へ入れている間（`cl-premount`）は、目次が見出しの位置を読みません。n段では `column-layout.ts` が `cl:heading` で現在の見出しを伝えるので、ここで位置を読むと、記事全体のレイアウトを強制するだけになります。1段で始めるときは、段組みが `cl:single` を送り、目次がそこで位置を合わせます。
- n段の本文を先に段へ入れる（PR #4・#6、`src/layouts/Layout.astro` のheadのスクリプト）: 遷移先URLの `?columns=`、指定がなければ保存された選択でn段になるときだけ、遷移では `astro:before-swap`、直接の読み込みではMutationObserverで `.cl-source` を段の幅の枠へ移し、本文を1段の幅でレイアウトしないようにします。本文の途中にインラインスクリプトは置きません。Firefoxでパース中にスタイル計算が入ったためです。
- 準備中の本文の隠し方（PR #7）: `clip-path: inset(50%)` と、スクロールポートの `aria-hidden="true"` で隠します。`visibility: hidden` は外すときに本文全体のスタイル計算を起こすので使いません。JavaScriptが無いときは何も付けません。準備中はTabキーを無視し、隠れた本文にフォーカスが入らないようにします。`inert` は `visibility` と同じく付け外しで本文全体のスタイル計算を起こすので使いません。
- `not-prose` の書き換え（PR #7、`astro.config.mjs`）: Viteプラグインが、Tailwind Typographyの `[class~=not-prose]` を `.not-prose` に書き換えます。`<html>` のクラスが変わるたびにChromiumが文書全体のスタイルを計算し直すのを避けるためです。
- 段組みのCSS変数（PR #3、`src/styles/column-layout.css` の `@property`）: 段組みが設定する変数は継承しないものとして登録し、使う要素だけが受け取ります。継承されると、値が変わるたびに本文の全要素のスタイルを計算し直すためです。画面の外にある段は、表示した1フレーム後に埋めます（`src/scripts/column-layout.ts` の `offscreenFrame`）。

## 計測

計測は本番ビルドを `astro preview` で配信して行います。

```sh
npm run build && npx astro preview --background
TRACE=0 node scripts/measure-article-open.mjs http://localhost:4321/dispositif/ 3 > out.jsonl
npx astro preview stop
```

`ENGINES`・`ARTICLES`・`MODES`・`CACHES` で条件を絞り、`NAV=direct` で直接の読み込みを測ります。各変数の意味は `scripts/measure-article-open.mjs` の冒頭にあります。トレースは時間を延ばすので、壁時計の比較は `TRACE=0` で行います。計測中に他の重い処理があると回ごとに±30ms程度揺れるので、小さな差は12回以上交互に測って確かめます。

Lighthouseや回線を遅くした計測では、GitHub Pagesと同じくgzipで配信します。`python -m http.server` は圧縮せずにHTMLを送るので、FCPと帯域の条件が変わり、比較に使えません。

## 採らなかった方式

各処理を入れたときの計測の条件と値、試して採らなかった案は、上に示したPRと、次のコマンドで読める記録の全文にあります。

```sh
git show 7812f3e:docs/article-open-history.md
```

一覧でホバーした記事を、画面外のiframeでn段まで組み立てておく方式（2026-11-05）は採りませんでした。数式記事ではCPUとメモリの負荷が大きく、ホバーして開かなければその負荷が無駄になり、Firefoxではクリックまでに準備が終わらなかったためです。計測スクリプトと生データはタグ `reading-preload-investigation-20261105` にあります。

## 残っている課題

- n段では、本文全体を段の幅でレイアウトする1回と、画面内の段の複製のスタイル計算・レイアウト・描画が残る。減らすには、ブロック単位で組み立てるなど組み立て方そのものを変える必要がある（内訳はPR #3）。
- Chromiumのn段で、`page-load→visible` に11〜15msのスタイル計算が残る。原因は未調査。
- Chromiumの `after-swap→page-load` の約31msの内訳は未調査。
