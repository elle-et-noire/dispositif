# [Dispositif](https://elle-et-noire.github.io/dispositif/)

Astroベースの記事サイトです。記事はビルド時にMarkdownからHTMLへ変換し、数式はMathJax v4のCHTMLとして出力します。ブラウザ側ではMathJaxを実行せず、数式フォントも同一オリジンから配信します。支援技術には、各数式をTeXのソースで読ませます（`role="img"` と `aria-label`。理由は `docs/math-accessibility.md`）。

## 構成

```text
/
├── docs/
│   ├── column-layout.md                 # 段組みの実装
│   ├── column-preload-investigation.md  # 記事を開くまでの時間の調査記録
│   └── math-accessibility.md            # 数式の読み上げ方式の決定記録
├── lib/                    # 記事取得、Markdown前処理、MathJax変換、単体テスト（*.test.ts）
├── post/                   # Markdown記事
├── public/
│   └── fonts/mjx/          # predev / prebuildで生成
├── scripts/
│   ├── copy-math-fonts.mjs
│   └── measure-article-open.mjs  # 記事を開くまでの時間の計測
├── src/
│   ├── components/
│   ├── icons/              # 段組み切り替えアイコン
│   ├── layouts/
│   ├── pages/
│   │   ├── index.astro
│   │   └── [slug].astro
│   ├── scripts/            # 段組み、読書位置の履歴、数式フォントの先読み、背景の一覧
│   └── styles/             # globals.css、column-layout.css
└── tests/                  # ブラウザテスト（*.browser.test.mjs）と共通の準備処理（browser.mjs）・段組みの操作（column-controls.mjs）
```

今後の予定と残っている課題は `ROADMAP.md` にまとめています。

## コマンド

```sh
npm install
npm run dev -- --background
npm run build
npm run astro -- check
```

バックグラウンドの開発サーバーは次のコマンドで管理できます。

```sh
npx astro dev status
npx astro dev logs
npx astro dev stop
```

数式フォントは `predev` / `prebuild` の `scripts/copy-math-fonts.mjs` で用意します。起動中の開発サーバーの配信を維持するため、フォントディレクトリは削除せず、変更のないファイルも書き直しません。

## テスト

次の検査はプルリクエストごとにCIで実行し、すべて成功したときだけmainからGitHub Pagesへデプロイします（`.github/workflows/deploy.yml`）。文書（`README.md`、`ROADMAP.md`、`AGENTS.md`、`docs/`）だけの変更では実行しません。ローカルでも同じコマンドで実行できます。

```sh
npm run astro -- check
npm test               # lib/*.test.ts の単体テスト
npm run build
npm run test:browser   # astro preview などを起動した状態で
```

テストを追加する基準は `AGENTS.md` の「テストの追加」にあります。

`npm test` は、段組みの座標（Home／Endの対称性・縦操作専用の余白・片軸操作・到達経路によらない位置・本文の被覆・有限平面・位置復元・ネイティブ座標の読み戻し、小数のネイティブ座標で往復しても投影原点が揺れないこと）、段組みの選択、読書位置の履歴、目次、数式フォント、数式の読み上げ名を確かめます。

`npm run test:browser` は、開発サーバまたはビルド済みサイトのプレビューを起動した状態で実行します。初回と、`playwright-core` を更新した後は、`npx playwright-core install chromium firefox` で検証用ブラウザを用意します。既存の Chromium は `TEST_BROWSER_PATH`、別のサーバは `TEST_BASE_URL` で指定できます。ChromiumとFirefoxの両方で実行するテストは、`TEST_ENGINES=chromium` のように実行するブラウザを絞れます。対象サイトのURL、ブラウザの起動、段組みの開始待ちなど、テストに共通の準備処理は `tests/browser.mjs` にまとめています。段組みが始まる前にスクロールすると失われるので、記事を操作するテストは `waitForColumnLayout` で待ってから操作します。

各ブラウザテストが確かめることは次のとおりです。「両方」はChromiumとFirefox、それ以外はChromiumだけで実行します。

| `tests/<名前>.browser.test.mjs` | ブラウザ | 確かめること |
| --- | --- | --- |
| `column-assembly` | 両方 | n段の本文が、一覧から開くときは差し替えの時点で、直接開く・再読み込みするときは最初のレイアウトから段の幅にあること。表示した時点で見えている段が埋まること |
| `column-background` | Chromium | 一覧へ戻るときのフォーカス表示、背景の閉じるリンクがポインター専用であること、一覧のスクロール、紙面の角の形、誤って閉じないこと、印刷、上部目次の矢印 |
| `column-bounds` | Chromium | 100%・110%・112.5%・125%・150%相当のズームと異なる縦位置で、重なり0のまま横操作だけで全文を読めること。縦操作で横位置が動かず、ホイールで端の部分段が高さ0まで縮み、上下端に余白が足されないこと。横操作では外側余白を作れず、縦操作で作った余白から横へ連続して戻れること。Home／Endの整数座標が毎回一致すること |
| `column-edges` | Chromium | 切り替えボタンが直接表示されること。ネイティブの横バーのドラッグとHome / Endで、先頭・末尾の基準配置へ到達できること |
| `column-fragments` | Chromium | 数式・コード・表・番号付きリスト・画像・SVGの断片が、元本文と同じ位置・組版を保つこと。表示外のブロックを削除し、表示中の断片を再利用すること。表示外に折りたたみがあっても開閉・コードコピー・ハッシュ移動が動くこと。n段だけコードを段幅で折り返すこと |
| `column-initial-paint` | 両方 | 記事の最初の描画が、選んだ段組みになるまで待つこと |
| `column-layout` | Chromium | デスクトップ幅とモバイル幅で本文を縦横にスクロールし、段の下端まで正しい本文が描画されること（スクリーンショットの画素で判定）。高速入力の移動量が端で切り捨てられないこと。描画更新を止めてもネイティブには移動でき、再開後に見えている段が埋まること。数式記事を12000px/秒・CPU速度1/4で往復し、本文全体のスタイル再計算が再発しないこと |
| `column-margins` | Chromium | 本文の余白が横移動と一緒に画面外へ流れ、横バーの左右余白が固定されること |
| `column-motion` | Chromium | 左右キーのアニメーション・連打・中断・動きを減らす設定。標準の横バーの矢印のクリック・長押しで本文だけが動き、端で止まること |
| `column-ordinary-navigation` | 両方 | 通常の遷移と履歴で、読書位置・一覧の位置・フォーカスを保つこと。背景の一覧が開く直前の位置に見え、`inert` と `aria-hidden` で外れ、段間のクリックで閉じると一覧の位置とフォーカスが戻ること。段組みの選択の保存と既定値。記事が別の段組みで先に描画されないこと。段組みの開始が失敗・遅延したときに1段へ戻ること。印刷後にn段の位置へ戻ること |
| `column-pixel-grid` | Chromium | n段の本文の translate × devicePixelRatio が整数になり、表示倍率が変わると動いていない段も丸め直すこと（ヘッドレスのChromiumではぼやけ自体は再現しない） |
| `column-review-fixes` | Chromium（1件は両方） | 本文内リンク・ハッシュ・再読み込み・段組みの切り替えで、読書位置と折りたたみの開閉状態を保つこと。目次・折りたたみのキーボードフォーカス。保存済みの履歴が壊れていても新しい位置を保存すること。本文の再計測を待つ間のスクロールも読書位置に反映すること（両方） |
| `column-scrollbars` | Chromium | 本文自身の縦バーを右端に表示し、上下矢印・長押し・ドラッグ・キーで操作できること |
| `column-scroll-performance` | Chromium | 縦横のネイティブスクロールの途中でJSが位置を書き戻さないこと。100%〜150%相当の拡大表示で、段内の横移動が実際に進みながら本文・背景・レールのスタイルと本文DOMを更新しないこと |
| `column-url` | 両方 | `?columns=` で記事を開く段組みを指定できること |
| `math-font-prefetch` | 両方 | 記事リンクのホバーでその記事の数式フォントだけを読み込み、開いた後に読み直さないこと。読み込み中のフォントがあっても記事を表示すること |
| `math-fonts` | Chromium | フォントの準備処理を再実行しても全フォントを配信でき、1段・n段・記事遷移後も数式フォントを使えること。数式の記事が使うフォントだけをpreloadすること |
| `math-speech` | Chromium | 数式がTeXのソースを名前にした画像として読み上げの対象になり、字形の文字が外れること |
| `single-column` | Chromium | 1段の目次を右へ寄せ、操作ボタンと一緒に追従させること。標準バー越しに背景が透け、キー・矢印・段組みの切り替え・紙面外のホイールで記事自身がスクロールすること |
| `toc` | Chromium | 1段のサイドバー目次とn段の上部目次を切り替えて使えること。目次から見出しへ移動した後のキーボードフォーカス |

次の不具合は、どのテストも検知できません（PR #31でテストをまとめたときに外れました）。

- 本文全体のスタイル再計算がFirefoxだけで再発すること。この検査は `column-layout` にあり、Chromiumでしか実行しません。
- 1段で一覧から記事を開き、ブラウザーの戻るで一覧へ戻ったときに、一覧の位置が復元されないこと。n段の同じ経路は `column-ordinary-navigation` が確かめます。

テストのほかに、開発サーバでは長い記事、モバイル幅、斜めホイール、折りたたみ・コピー、ハッシュ、印刷、ClientRouter 遷移も確認してください。

## 記事の段組み

1段・n段とも段組み切り替えアイコンで直接切り替えます。アイコンの編集元は `src/icons/single-column.svg` と `src/icons/multi-column.svg` です。ファイルの変更はAstro経由で画面へ直接反映されます。アイコンは切り替え先の1段／複数段を枠の分割で示し、閉じるボタンと同じ30px・線幅2px・色でそろえます。読み上げ用の名前と押下状態、切り替え先を示すツールチップも付けます。1段では記事右上、n段では上部目次の右側に置きます。段組み用の設定パネルや先頭・末尾へのボタンは設けず、Home / Endで移動します。1段の記事カードの配置を保ち、本文と右側の目次の間に32pxの間隔を設けます。閉じる・段切り替えボタンを目次の上に置き、まとめて追従させて重なりを防ぎます。狭い画面ではモバイル目次を使います。切り替え時は本文の要素とその中の位置を基準に、幅の変化をまたいで同じ箇所の近くを表示します。記事内リンクや直接のハッシュ変更も含め、ブラウザー履歴の読書位置と折りたたみの開閉状態は項目ごとに保持し、ページを離れるときに `sessionStorage` に最大100件保存します。復帰時は開閉状態を本文の計測と位置復元より先に適用します。1段・n段の選択は `localStorage` に保存します。未選択時と保存値が不正なときは、画面幅にかかわらず1段です（`src/scripts/column-preference.ts`）。記事のURLに `?columns=multi` または `?columns=single` を付けると、保存された選択より優先してその段組みで開きます（例: `/dispositif/symmetric-polynomial/?columns=multi#見出しid`）。この指定は保存せず、URLも書き換えません。Astroのルーターはクエリが変わると戻る・進むを別ページへの遷移として扱うためです。その代わり、指定付きで開いた後に切り替えた場合は、再読み込みや戻る・進むでその履歴項目に記録した切り替え後の段組みを使います。`?columns=` 付きのURLも `rel="canonical"` はクエリなしのURLです。JavaScript無効時と印刷時は通常のレイアウトです。

1段表示では見出しを縦に並べた目次を本文右側に常時表示し、本文のスクロールに追従します。画面幅768px未満では記事右上の矢印で同じ縦並びリストを開閉します。n段表示では見出しを横書きで上部に横一列へ並べ、折りたたまず常時表示します。収まらない分は横スクロールバー・タッチ操作・マウスホイールで移動でき、長い見出しも省略せず一行で表示します。見出しの選択・外側のクリック・Escでもn段の目次は開いたままです。どちらの目次も読書中の見出しを強調して表示範囲に収めます。上部の目次は3pxの細いスクロールバーをヘッダー下端に余白なしで配置し、ホバー・フォーカス時に少し濃くします。標準の太さ指定しか使えないブラウザーではthinを使います。目次と切替ボタンは高さ3.5remのヘッダに収まり、目次内の移動で本文の配置や読書位置は変わりません。1段表示の折りたたみ目次は見出しの選択・外側のクリック・Escで閉じます。JavaScript無効時も1段表示の目次とリンクを利用できます。記事一覧へは右上の閉じるボタン（1段の広い画面ではヘッダの「記事一覧」も）で戻ります。紙面の外の背景をクリックしても戻れますが、背景のリンク（`.cl-dismiss`）はポインター専用で、Tab移動と読み上げの対象から外しています。

段幅・間隔・色・スクロールバーの太さは、`src/styles/column-layout.css` の `:root` にあるCSS変数（`--cl-column-width`、`--cl-gap`、`--cl-edge-space` など）で調整できます。

段の組み立て方、座標と移動範囲、スクロールの扱い、制約は `docs/column-layout.md` にあります。

## 記事を開くまでの処理

一覧から記事を開くとき（ClientRouter による遷移）と、記事を直接読み込むときの表示を速くするため、次の処理を入れています。経緯と計測値は `docs/column-preload-investigation.md` にあります。

- 数式フォントの先読み（`src/scripts/math-font-prefetch.ts`、`lib/math-fonts.ts`）: ビルド時に記事ごとの数式フォントを `data-math-fonts` に書き出し、一覧のカードに80msホバーまたはフォーカスすると `FontFace.load()` で読み込みます。タッチ、オフライン、データ節約、2G回線では行いません。`astro:before-swap` で読み込み済みのフォントを `document.fonts` に記事の `@font-face` と同じ名前で加え、遷移先の文書から同じフォントの `@font-face` と preload を取り除きます。
- 数式フォントの preload（`src/pages/[slug].astro`）: 記事が使う数式フォントをすべて `<link rel="preload">` で読み込みます。最初のレイアウトの途中で見つかったフォントはそのレイアウトの後に届き、届くたびに記事全体をレイアウトし直すためです。Nunito は preload しません。FCP が遅れるだけで、レイアウトの回数は減らなかったためです。
- n段で本文を段へ入れている間（`cl-premount`）は、目次が見出しの位置を読みません（`src/components/Toc.astro`）。n段では `column-layout.ts` が `cl:heading` で現在の見出しを伝えるので、ここで位置を読むと、記事全体のレイアウトを強制するだけになります。1段で始めるときは、段組みが `cl:single` を送り、目次がそこで位置を合わせます。
- n段の本文を先に段へ入れる（`src/layouts/Layout.astro` の head のスクリプト）: 遷移先URLの `?columns=`、指定がなければ保存された選択でn段になるときだけ、遷移では `astro:before-swap`、直接の読み込みでは MutationObserver で `.cl-source` を段の幅の枠へ移し、本文を1段の幅でレイアウトしないようにします。本文の途中にインラインスクリプトは置きません。
- 準備中の本文は `clip-path: inset(50%)` と、スクロールポートの `aria-hidden="true"` で隠します。`visibility: hidden` は外すときに本文全体のスタイル計算を起こすので使いません。JavaScript が無いときは何も付けません。準備中は Tab キーを無視し、隠れた本文にフォーカスが入らないようにします。`inert` は `visibility` と同じく付け外しで本文全体のスタイル計算を起こすので使いません。
- `astro.config.mjs` の Vite プラグインが、Tailwind Typography の `[class~=not-prose]` を `.not-prose` に書き換えます。`<html>` のクラスが変わるたびに Chromium が文書全体のスタイルを計算し直すのを避けるためです。

計測は本番ビルドを `astro preview` で配信して行います。

```sh
npm run build && npx astro preview --background
TRACE=0 node scripts/measure-article-open.mjs http://localhost:4321/dispositif/ 3 > out.jsonl
npx astro preview stop
```

`ENGINES`・`ARTICLES`・`MODES`・`CACHES` で条件を絞り、`NAV=direct` で直接の読み込みを測ります。トレースは時間を延ばすので、壁時計の比較は `TRACE=0` で行います。計測中に他の重い処理があると回ごとに±30ms程度揺れるので、小さな差は12回以上交互に測って確かめます。
