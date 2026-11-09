# 記事を開くまでの処理

一覧から記事を開くとき（ClientRouterによる遷移）と、記事を直接読み込むときの表示を速くするために入れている処理、その計測方法、入れた経緯を説明します。

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

## 経緯

表示を速くした変更をPRごとにまとめます。各処理を入れた理由は上の「処理」にあります。計測の条件、内訳、計測値の表、試して採らなかった案の全文は、次のコマンドで読めます。その冒頭に、古い名前（`rm-`、`reading-mode.ts` など）と現在の名前の対応表もあります。

```sh
git show 7812f3e:docs/article-open-history.md
```

短くなった時間は、本番ビルドで変更前後を交互に測った中央値の差です。数式記事は `symmetric-polynomial` です。

- 画面外のiframeでn段を先読みする方式（2026-11-05、採らなかった）: 準備済みの画面を使えたときは速かった。しかし、数式記事ではCPUとメモリの負荷が大きく、ホバーして開かなければその負荷が無駄になり、Firefoxではクリックまでに準備が終わらなかった。計測スクリプトと生データはタグ `reading-preload-investigation-20261105` にある。このとき、段組みを選んでいない閲覧者には画面幅によらず1段で表示するようにした。
- PR #2 数式フォントの先読み: 一覧から数式記事を初めて開くまでが、両エンジンで90〜125ms短くなった。Firefoxでフォントを使い回せるようにした変更で、Firefoxはさらに70〜170ms短くなった。`<link rel="prefetch">` ではほとんど短くならなかった。
- PR #3 n段の組み立て: 段組みが設定するCSS変数を `@property` で継承しないものにし、本文のレイアウトを段の幅での1回にし、画面外の段は1フレーム後に埋めるようにした。数式記事のn段で100〜140ms短くなった。
- PR #4 一覧から開くときに本文を先に段へ入れる: 数式記事のn段で約60〜110ms短くなった。記事の外枠のn段用の規則も差し替えの時点で当てないと、Firefoxでは本文をレイアウトし直した。準備中の本文を `display: none` にする案は、数式フォントを見つけるのが遅れた。フォントを待つようにすると、Firefoxの初回で200ms以上遅くなった。
- PR #5 数式フォントの二重定義の除去: ホバーで読み込んだフォントと記事の `@font-face` が同じ名前で並び、未読み込みのほうが後から届いて記事全体をレイアウトし直していた。Chromiumで約80〜100ms、Firefoxの初回で約25ms短くなった。
- PR #6 直接の読み込みでも本文を先に段へ入れる: 数式記事のn段で80〜120ms短くなった。計測スクリプトに `NAV=direct` を加えた。
- PR #7 文書全体のスタイル計算の除去: 数式記事をクリックして最初に描画するまでが、Chromiumで約60〜95ms、Firefoxで約35〜45ms短くなった。計測スクリプトに `painted` を加えた。
- PR #24 数式フォントをすべてpreloadする: CPUを4倍遅くして直接開いたとき、n段のTBTが474msから132msになった。本番のLighthouseの点数は73から95になった。

## 残っている課題

急がないので、2026-11-09にROADMAPから外しました。

- n段では、本文全体を段の幅でレイアウトする1回と、画面内の段の複製のスタイル計算・レイアウト・描画が残る。減らすには、ブロック単位で組み立てるなど組み立て方そのものを変える必要がある（「経緯」のPR #3）。
- Chromiumのn段で、`page-load→visible` に11〜15msのスタイル計算が残る。原因は未調査。
- Chromiumの `after-swap→page-load` の約31msは、これまでの変更で変わっていない。内訳は未調査。
