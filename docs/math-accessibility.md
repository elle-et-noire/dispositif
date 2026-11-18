# 数式の読み上げ

数式を支援技術にどう読ませているかと、その理由を説明する。残っている確認作業は `ROADMAP.md` の「数式の読み上げ」にある。

## 方式（PR #14）

CHTMLの字形の箱（`mjx-c`）には𝑎や+などの文字が入っている。そのままでは、Chromiumのアクセシビリティツリーでこれらの文字が構造なしに並ぶ（`x^2` が「x2」になる）。そこで数式ごとに1つの画像として読ませる。

- 各数式の `mjx-container` に `role="img"` と、TeXのソースを `aria-label` として付ける（`lib/mathjax.ts`、`lib/math-speech.ts`）。前処理で足す前後の `\hspace` と、`\label`・`\tag` は除き、見えている式番号を末尾に「(1)」のように足す。字形の箱 `mjx-math` には `aria-hidden` を付け、二重に読まれないようにする（`tests/math-speech.browser.test.mjs`）。
- `\eqref` を含む数式は中にリンクがある。`img` にするとリンクが支援技術から消えるのにTabでは止まるので、手を加えない。
- 幅からはみ出したディスプレイ数式は、包み（`span.scrollable`）に `tabindex="0"`、`role="group"`、`aria-label` を付け、名前を持つTabの停止位置にする（`src/components/ArticleInteractions.astro`）。ChromiumとFirefoxは、はみ出したスクロール要素にtabindexがなくてもTabで止まるが、名前もロールもないので、Chromiumでは何も読まれない停止位置になる。Safariはスクロール要素にTabで止まらないので、キーボードで横へ送れない。はみ出さない数式では止まらないよう、包みと数式の幅が変わるたびに付け外しする。

## 実機での確認

次の内容を確認用の記事 `post/math-speech-check.md` に入れ、本番ビルドのプレビューで `/dispositif/math-speech-check/` を開く。

```markdown
---
title: 数式の読み上げ確認
publish: 2026-11-18
---

## 数式

文中の数式は $x^2$ で、次が番号付きのディスプレイ数式です。

\begin{equation}
x^2 + y^2 = z^2\label{eq:speech}
\end{equation}

式 $\eqref{eq:speech}$ を参照します。
```

1段とn段で、NVDAまたはVoiceOverで本文を順に読み、文中の数式、ディスプレイ数式、式番号と参照リンクの読み上げを記録する。Tabで参照リンクに移動してEnterで式を表示し、数式の表示とコピーも確認する。終わったらローカルの確認用記事を取り除く。

この例では、LinuxのPlaywright ChromiumとWebKitで、両方の段組みに数式と参照リンクのアクセシブルな名前があり、Tabで参照リンクに移動してEnterで式を表示できることを確認した。実際の読み上げは[ロードマップ](../ROADMAP.md#数式の読み上げ)の確認項目にある。

## 採らなかった案

計測値と手順は、コミット `ea88223` の版のこの文書にある。

- MathJaxの見えないMathML（`a11y/assistive-mml`）: 数式記事の要素数が増え、記事を開くまでがChromium・Firefoxとも遅くなった。費用の大半はMathMLのレイアウトだった。`content-visibility: auto` で戻すと、画面外の数式がアクセシビリティツリーから消えた。MathMLを数式として読み上げるMathCATなどは日本語に対応していない。
- MathMLを `<template>` に入れ、表示後に少しずつ差し込む方式: 表示後に長い処理が続き、差し込むまで数式を読めない。本文の要素が増えるので、幅の変更や1段・n段の切り替えで本文を組み直すたびにFirefoxで遅くなる。日本語の読み上げでMathMLの利点が生きるか分からないので採らなかった。
- 読み上げ文字列を作るSREは日本語の規則がないので使わない。
- `role="math"` は、NVDAがMathMLのない要素を読まなかった報告があるので使わない。
