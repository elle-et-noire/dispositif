# 記事を開くまでの処理

一覧から記事を開くとき（ClientRouterによる遷移）と、記事を直接読み込むときの表示を速くするために入れている処理、その計測方法、採らなかった方式を説明します。

## 処理

- 数式フォントの先読み（PR #2・#5、`src/scripts/math-font-prefetch.ts`、`lib/math-fonts.ts`）: ビルド時に記事ごとの数式フォントを `data-math-fonts` に書き出し、一覧のカードにホバーまたはフォーカスすると `FontFace.load()` で読み込みます。条件はAstroのHTML先読みに合わせ、タッチ、オフライン、データ節約、低速回線では行いません。`astro:before-swap` で読み込み済みのフォントを `document.fonts` に記事の `@font-face` と同じ名前で加え、遷移先の文書から同じフォントの `@font-face` とpreloadを取り除きます。記事を離れるときも、その記事が自分の `@font-face` で読み込んだ数式フォントを同じように `FontFace.load()` で読み込んで残し、履歴などでその記事へ戻ったときに使います。WebKitは戻った記事の `@font-face` を読み込み直し、最初のレイアウトに間に合わないことがあるためです。間に合わないと、そのレイアウトで復元したn段の読書位置から、フォントが届いた後に本文がずれます（PR #61）。
- 数式フォントのpreload（PR #24、`src/pages/[slug].astro`）: 記事が使う数式フォントをすべて `<link rel="preload">` で読み込みます。最初のレイアウトの途中で見つかったフォントはそのレイアウトの後に届き、届くたびに記事全体をレイアウトし直すためです。Nunitoはpreloadしません。FCPが遅れるだけで、レイアウトの回数は減らなかったためです。
- 目次の位置合わせ（PR #24、`src/components/Toc.astro`）: n段で本文を段へ入れている間（`cl-premount`）は、目次が見出しの位置を読みません。n段では `column-layout.ts` が `cl:heading` で現在の見出しを伝えるので、ここで位置を読むと、記事全体のレイアウトを強制するだけになります。1段で始めるときは、段組みが `cl:single` を送り、目次がそこで位置を合わせます。
- n段の本文を先に段へ入れる（PR #4・#6、`src/layouts/Layout.astro` のheadのスクリプト）: 遷移先URLの `?columns=`、指定がなければ保存された選択でn段になるときだけ、遷移では `astro:before-swap`、直接の読み込みではMutationObserverで、`.cl-source` を囲む原本の段（`ColumnLayout.astro`）を段の幅の枠にし、本文を1段の幅でレイアウトしないようにします。本文の途中にインラインスクリプトは置きません。Firefoxでパース中にスタイル計算が入ったためです。
- 本文の後半を後で表示する（PR #49・#50、`src/layouts/Layout.astro` のheadのスクリプト、`src/styles/column-layout.css`、`src/scripts/column-layout.ts` の `showText`・`showTextInSteps`・`showAllText`）: 新しく開いた記事では、`.post` の12番目のブロックに `data-cl-defer` を付け、その後のブロックを `display: none` にします。記事全体のスタイル計算とレイアウトを、最初のフレームより前に行わないためです。段組みは最初のフレームで、1段では画面の高さの2倍まで、n段では見える段とその両隣の段の分まで本文を表示します。そのフレームが描画された後は、残りを数ブロックずつ、短いタスクに分けて表示します（1タスクの長さは `TEXT_STEP_MS`）。1つのタスクで残りを全部表示すると、そのタスクが表示の直後に入力を待たせる長いタスクになり、LighthouseのTBTが増えたためです（PR #50）。キー・ポインターの入力、印刷、履歴の移動では、その処理の前に残りを全部表示します。ホイールとタッチでは全部を表示しません。表示済みの本文が画面と次の段を覆っており、分けた表示がスクロールに追いつくので、操作の直後に長いタスクを起こさないためです。ハッシュ付きのURLと履歴の項目を開くときは、表示する位置が本文のどこにもなり得るので、最初から全文を表示します。まだ表示していない見出しとブロックは、目次とn段の計測が読み飛ばします。印を `.cl-source` ではなくブロックに付けるのは、`.cl-source` の属性を変えると、Chromiumがこの規則のために本文全体のスタイルを計算し直したためです（PR #50）。ブロックの印を外すときは、後ろの兄弟だけを計算し直します。
  `showText()` は少数のブロックを先に表示し、必要な高さに達するまで回ごとに追加する数を増やします。大きな数式や図を含む記事でも、最初の測定で必要以上に後半の本文をレイアウトしないためです。数式記事をn段で直接読み込むと、ChromiumとFirefoxの両方で、段組み開始から本文の初回フレームまでが短くなります（計測はこの記述を加えたPR）。
- 数式の字形の箱をまとめる（PR #51、`lib/mathjax.ts` の `mergeGlyphBoxes`・`glyphBoxStyles`）: MathJaxは、文字の要素（`mjx-mi`・`mjx-mo`・`mjx-mn`）の中に字形の箱（`mjx-c`）を入れます。字形が1つだけのときは、ビルド時に外側の要素を省き、その属性を `mjx-c` に移します。外側の要素は `mjx-c` を包むだけで、寸法も位置も `mjx-c` と同じです。記事全体と、n段の複製の段で、スタイル計算とレイアウトをする要素を減らすために省きます。外側の要素を前提にしたMathJaxの規則は、ビルド時に書き換えます（どの規則をなぜ書き換えるかは `glyphBoxStyles` のコメント）。
- 文中の数式の要素を減らす（PR #52、`lib/convert.ts`、`lib/mathjax.ts` の `mergeGapBreaks`）: 文中の数式は、`<span>` で包まずに本文へ入れます。この `<span>` はスタイルを持たず、表示に関わっていなかったためです。文中の数式の前後の間隔は、改行できる位置と間隔の2つの要素を、1つの `mjx-break` にまとめます。要素を減らすためと、行頭に間隔を出さないためです（理由は `mergeGapBreaks` のコメント）。
- 段組みのリスナーの種類を先に付ける（PR #67、`src/layouts/Layout.astro` のheadのスクリプトの `listenOnViewport`）: 直接の読み込みではパーサーが `.cl-viewport` を付けた直後に、遷移では `astro:before-swap` で、`.cl-viewport` に何もしないpassiveな `wheel`・`pointerdown`・`touchstart` のリスナーを付けます。段組みのJSが `astro:page-load` で同じ種類のリスナーを付けても、WebKitが記事全体のスタイルを計算し直さないためです。WebKitは要素と祖先のリスナーの種類を各要素のスタイルに持ち、種類が増えるとスタイルを計算し直します（「残っている課題」）。記事のスタイルを計算する前に付ければ、計算し直すものがありません。`pointerdown`・`touchstart` は、計測したWebKitでは `document` に付いているので増えませんが、段組みのJSが付ける種類と揃えています。
- 準備中の本文の隠し方（PR #7）: `clip-path: inset(50%)` と、スクロールポートの `aria-hidden="true"` で隠します。`visibility: hidden` は外すときに本文全体のスタイル計算を起こすので使いません。JavaScriptが無いときは何も付けません。準備中はTabキーを無視し、隠れた本文にフォーカスが入らないようにします。`inert` は `visibility` と同じく付け外しで本文全体のスタイル計算を起こすので使いません。
- `not-prose` の書き換え（PR #7、`astro.config.mjs`）: Viteプラグインが、Tailwind Typographyの `[class~=not-prose]` を `.not-prose` に書き換えます。`<html>` のクラスが変わるたびにChromiumが文書全体のスタイルを計算し直すのを避けるためです。
- 段組みのCSS変数（PR #3、`src/styles/column-layout.css` の `@property`）: 段組みが設定する変数は継承しないものとして登録し、使う要素だけが受け取ります。継承されると、値が変わるたびに本文の全要素のスタイルを計算し直すためです。画面の外にある段は、表示したフレームが描画された後に埋めます（`src/scripts/column-layout.ts` の `offscreenFrame`、理由は `docs/column-layout.md` の「操作への応答」）。
- 複製の段の置き場所（PR #48、`src/components/ColumnLayout.astro`）: 原本の段は `.cl-plane` の最初の子にし、複製の段は箱を作らない `.cl-copies` の末尾に足します。原本の段の兄弟が増減すると、Firefoxでは原本の段が最後の子でなくなったときに、Chromiumでは後ろの兄弟の手前に段を入れたときに、原本全体のスタイルを計算し直したためです。

## 計測

計測は本番ビルドを `astro preview` で配信して行います。

```sh
npm run build && npx astro preview --background
TRACE=0 node scripts/measure-article-open.mjs http://localhost:4321/dispositif/ 3 > out.jsonl
npx astro preview stop
```

`ENGINES`・`ARTICLES`・`MODES`・`CACHES` で条件を絞り、`NAV=direct` で直接の読み込みを測ります。各変数の意味は `scripts/measure-article-open.mjs` の冒頭にあります。トレースは時間を延ばすので、壁時計の比較は `TRACE=0` で行います。計測中に他の重い処理があると回ごとの値が揺れるので、小さな差は12回以上交互に測って確かめます。

WebKitの時間は、Playwrightの `waitForFunction`・locator・`click` を使わずに測ります。これらはPlaywrightのスクリプトを読み込み、そのスクリプトが `window` に非passiveな `pointerdown`・`touchstart` などのリスナーを付けるので、WebKitが文書全体のスタイルを計算し直します（「残っている課題」）。待つときは `page.evaluate` で状態を読み、操作は `page.mouse` で行います。

Lighthouseや回線を遅くした計測では、GitHub Pagesと同じくgzipで配信します。`python -m http.server` は圧縮せずにHTMLを送るので、FCPと帯域の条件が変わり、比較に使えません。

## 採らなかった方式

各処理を入れたときの計測の条件と値、試して採らなかった案は、上に示したPRと、次のコマンドで読める記録の全文にあります。

```sh
git show 7812f3e:docs/article-open-history.md
```

一覧でホバーした記事を、画面外のiframeでn段まで組み立てておく方式は採りませんでした。数式記事ではCPUとメモリの負荷が大きく、ホバーして開かなければその負荷が無駄になり、Firefoxではクリックまでに準備が終わらなかったためです。計測スクリプトと生データはタグ `reading-preload-investigation-20261105` にあります。

本文の各ブロックに `content-visibility: auto` を付けて画面外のレイアウトを省く方式は採りませんでした。各ブロックにレイアウトの封じ込めがかかり、リストや引用の中の要素の余白がブロックの外の余白と相殺されなくなって、ブロックの高さが変わるためです（PR #49）。

文中の数式の前後の間隔を、数式の外側の余白（`margin`）にする方式は採りませんでした。余白は行末でも幅を取り、行頭でも消えないので、数式が行頭に来ると字下げされたように見え、行末に収まる数式が次の行へ送られるためです。間隔を `mjx-break` の `::after` や右の余白で作る方式も、ChromiumとFirefoxで改行できる位置が変わったので採りませんでした（PR #52）。

数式の出力をMathJaxのCHTMLからSVGに変える方式も採りません。記事全体のレイアウトの大半は数式の `mjx-*` 要素ですが、SVGでは数式の表示が粗くなります。また、数式が多い記事ではSVGをHTMLに埋め込む量が増え、その分のコストが高くなります。

## 残っている課題

- 記事全体のスタイル計算とレイアウトは、最初のフレームの後に回して短いタスクに分けた（PR #49・#50）。量は、数式の要素を減らした分しか減っていない（PR #51・#52）。数式の残りの要素（`mjx-script`・`mjx-TeXAtom` など）は、内側の要素と文字の大きさが違い、余白をそのまま内側へ移せないので、同じ方法では省けない。最初のフレームまでの処理は、記事を直接開いたときにLighthouseのTBTに入る長いタスクとして残る。
- 最初のフレームより前には、表示するブロックのスタイル計算とレイアウトが残る。Chromiumで一覧から開くと、最初に表示する数ブロックの分が `after-swap→page-load` に現れる。カーソルの下にある要素をChromiumが判定し直すタイマーが、スクリプトより先にスタイル計算とレイアウトを行うためである。最初に表示するブロックの数は記事と画面の幅によらず同じなので、1段では画面に要る分より多く、n段では足りないことがある。足りない分は段組みが最初のフレームで足す。
- n段では、画面内の段の複製のスタイル計算・レイアウト・描画が残る（内訳はPR #3）。Chromiumで一覧から開くと、そのスタイル計算とレイアウトは `page-load→visible` に現れる（計測はPR #7）。段組みの最初のフレームより前に、目次が `cl:heading` を受けて位置を読んだ時点で行われる。そのフレームではスタイル計算とレイアウトをやり直さないので、二重の作業にはなっていない。
- Firefoxでは、数式記事をn段で開くときの `page-load→visible` が、Chromiumより1段との差が大きい。PR #48で原本全体のスタイルの計算し直しをなくした後に残るのは、主に画面内の段の複製のスタイル計算とレイアウトである（計測はPR #48とコミット `e581cb3`）。
- WebKitは、要素とその祖先に付いているリスナーの種類（`wheel`・`touchstart`・`pointerdown`・`pointerup`・`pointerover` など、passiveかどうかも区別する）を、各要素のスタイルに持つ。リスナーを付けてこの種類が増えると、付けた要素と子孫のスタイルを計算し直す。`document` か `window` に付けて種類が増えると、文書全体のスタイルを計算し直す。どちらもレイアウトはやり直さない。種類が増えなければ、付けても時間はかからない。`click`・`keydown`・`scroll`・`mousedown` では起きない。要素を並べただけのページでも起き、ChromiumとFirefoxでは起きない。計測はLinuxのPlaywrightのWebKitで行った。WebKitのソースでは、`wheel` の種類はmacOS・iOS・GLib（WebKitGTK・WPE）で、`touchstart`・`pointer*` の種類はタッチの領域を作る構成（iOS・GLibで、サイト分離か設定が有効なとき、`Document::shouldUseTouchEventRegions`）でだけスタイルに持つ。macOSのSafariでは、`touchstart`・`pointer*` のリスナーでは計算し直さないと推定している。段組みのJSが `.cl-viewport` に付けるリスナーで記事全体のスタイルを計算し直す分は、先に同じ種類を付けてなくした（「処理」）。
  - 記事を直接開くと、モジュールのスクリプトが `document` に付けるリスナー（Astroの先読みの `touchstart`、`article-background.ts` の `pointerdown`、`math-font-prefetch.ts` の `pointerover`・`pointerout`、`ArticleInteractions.astro` の非passiveな `pointerup`）でも、文書全体のスタイルを計算し直す。headのスクリプトで同じ種類のリスナーを先に `document` に付けると、この計算はなくなり、本文の表示は早くなる。ただし、本文の後半を後で表示するときは、残りの本文を表示する最初のタスクのどれかが、文書全体の計算と同じくらい長くなる。symmetric-polynomialでは、後半で最初の `h3` を表示したときのスタイル計算で、レイアウトではない。WebKitでは、初めて使う太さと大きさのフォント指定（ここでは `.post h3` の太字と文字の大きさ）を持つ要素のスタイル計算に時間がかかる。要素を並べただけのページでも、新しい指定を初めて使う要素だけに時間がかかった。先に付けないときは、この計算が `load` イベントより前に済んでいる。何がそれを済ませるのかは確かめていない。`DOMContentLoaded` で文書全体を計算し直させると済み、`load` で計算し直させても済まなかった。Webフォントの読み込みを止めると、先に付けないときも同じ時間がかかった。`load` で画面外に `.post h3` を1つ置いてスタイルを計算させると、この時間はかからなくなった。一覧から開いたときに全文の表示が遅れたのは、一覧のページでも先に付けたので、開いた記事でもこの時間がかかったためである。一覧のページで先に付けなければ、一覧から開く時間は変わらなかった。ハッシュ付きのURLと履歴の項目を直接開くときだけ先に付ける方式（PR #68）は採らなかった。早くなるのはWebKitでそれらを直接開くときだけで、macOSのSafariでは `touchstart`・`pointer*` の種類をスタイルに持たないので効かないと推定しているためである（計測はPR #68）。
  - 計測はコミット `aa10ccc` と `6e102cf` のメッセージにある。
