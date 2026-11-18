# Webサイト改善ロードマップ

## 目的

- 320px幅や画面拡大時にも横スクロールせず閲覧できる
- WCAG 2.2 AAを意識した読みやすさとキーボード操作を提供する
- 長い記事でも現在位置や目的の節を見つけやすくする
- 現在の軽量な静的サイトとしての利点を維持する

製品コードのレビューで見つかった不具合の修正と検証は[製品コードのレビューと対応記録](docs/product-code-review.md)にある。

## 残っている作業

表示速度の残りの課題は `docs/article-open.md` の「残っている課題」に、読み込んだ後の操作の遅さは `docs/column-layout.md` の「操作への応答」にある。

- 数式の読み上げをスクリーンリーダーで確認する（実機での手作業。下の「数式の読み上げ」）
- [WebKitの検証](#webkitの検証)を進める

## 維持すること

- 320px幅でページ全体が横にはみ出さない
- 外部リンクに `noopener noreferrer` が付いている
- `lang="ja"`、`main`、`article`、`nav`、見出しなどの基本構造がある
- `prefers-reduced-motion` と `:focus-visible` に対応している
- 数式はビルド時に生成し、ブラウザー側でMathJaxを実行しない
- キーボードで目次のリンクを選ぶと見出しへフォーカスが移り、次のTabで見出しの後の本文へ進む（1段のサイドバー・モバイル目次、n段の上部目次。`tests/toc.browser.test.mjs` で検査）

CIで実行する検査と、各テストが確かめることは `README.md` の「テスト」にある。

---

## 数式の読み上げ

各数式を `role="img"` とTeXのソースの `aria-label` で読ませる（PR #14）。決めた理由と採らなかった案は `docs/math-accessibility.md` にある。

- [ ] NVDAまたはVoiceOverで、インライン数式とディスプレイ数式を読み上げ確認する
- [ ] 式番号と `\eqref` の式参照が、読み上げとキーボード操作でも理解できることを確認する

完了条件:

- 数式が空要素や意味のない文字列として読み上げられない
- 視覚表示、コピー、式参照の既存機能が維持されている

---

## WebKitの検証

現在のCIはChromiumとFirefoxで実行する。`main` のエンジン指定は [`tests/browser.mjs`](tests/browser.mjs) で検証し、WebKitの明示指定は [`test/webkit-browser-tests` ブランチ](https://github.com/elle-et-noire/dispositif/tree/test/webkit-browser-tests) にある。

1. **WebKitを指定して起動する。** 検証ブランチに最新の `main` をマージする。PR #80の未知名の検査を保ち、`TEST_ENGINES=webkit` でWebKit、未指定でChromiumとFirefoxが選ばれるようにする。有効名と未知名が混在する指定でも失敗することを確認する。
2. **本番ビルドで読書操作を確かめる。** `npx playwright-core install webkit` でブラウザーを用意する。[READMEの「テスト」](README.md#テスト)に従い、プレビューのベースパス付きURLを `TEST_BASE_URL` に設定する。一覧と記事の遷移、段組みの切り替え、ハッシュ付きの直接読み込み、履歴の位置復元、閉じた節への目次移動を確かめる。出力にWebKitの実行結果があることを確認する。

   ```sh
   TEST_ENGINES=webkit node --test --test-name-pattern='^webkit:' \
     tests/column-ordinary-navigation.browser.test.mjs \
     tests/column-url.browser.test.mjs tests/toc.browser.test.mjs
   ```

3. **失敗した操作を再現する。** CDPに依存する検査はChromiumで実行する。段の高さの反映やネイティブスクロールを待つ必要がある場合は、位置や表示が落ち着いたことを確認してから判定する。スクロールバーの矢印では、移動量の固定値の代わりに、意図した方向へ進み本文を読めることを確かめる。閲覧者に見える不具合には、記事・操作・期待した動作・実際の動作を添える。
4. **Safariで既知のスクロール差を確かめる。** n段で左の余白から右へ、または上の余白から下へ戻るとき、LinuxのPlaywright WebKitではホイール操作の移動が短くなる。再現手順と原因は[段組みの実装](docs/column-layout.md#スクロールと段の描画)にある。macOSのSafariでも同じ操作を試し、ブラウザーと入力機器を記録する。PlaywrightとSafariの結果は実行環境を明記する。[PlaywrightのWebKitについて](https://playwright.dev/docs/browsers#webkit)

主要な読書操作をWebKitで繰り返し検証でき、残る失敗の再現条件と対応方針をPRまたは課題に示せれば完了とする。CIへの追加は、その結果を見て判断する。

---

## 手作業での確認

CIの検査に加えて、まとまった変更のリリース前に確認する。

- [ ] 320px、390px、768px、1440pxで表示を確認する
- [ ] キーボードのみで主要導線を操作でき、フォーカス表示が見える
- [ ] `prefers-reduced-motion` を有効にして確認する
- [ ] 一覧・通常記事・数式記事・コード記事を確認する
- [ ] 長い記事で、斜めのホイール、折りたたみ、コードのコピー、ハッシュ移動、印刷、一覧と記事の間の遷移を確認する
- [ ] GitHub Pagesの `/dispositif/` ベースパスでアセットとリンクが動作する
