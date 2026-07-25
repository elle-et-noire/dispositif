---
title: Tips for Typst
publish: 2025-01-23
---

## インストール

[Readme](https://github.com/typst/typst?tab=readme-ov-file#installation)に書かれている通りにする。
```sh
cargo install --locked typst-cli
```

## LaTeXとの対応

- [Equivalent Typst Function Names of LaTeX Commands (PDF)](https://tug.ctan.org/info/typstfun/typstfun.pdf)（`texdoc typstfun`でも呼び出せる）
- [Typst： いい感じのLaTeXの代替](https://www-het.phys.sci.osaka-u.ac.jp/~yamaguch/j/typst.html)

などを参照する。

## 可換図式

[fletcher](https://typst.app/universe/package/fletcher/)が便利。

## 和文と欧文を別フォントにする

```typst
#set text(font: "Segoe UI") // 欧文
#show regex("[\p{scx:Han}\p{scx:Hira}\p{scx:Kana}]"): set text(font: "Noto Sans JP") // 和文
```
[参考](https://zenn.dev/mkpoli/articles/6234c1d2a595bd)


## `raw`を設定してコードをきれいに表示する

```typst
#show raw: set text(font: "Consolas")
#show raw.where(block: true): set block(fill: luma(220), inset: 8pt, radius: 5pt, width: 100%)
#show raw.where(block: false): it => box(fill: rgb(249, 250, 249), inset: (x: 3pt, y: 0pt), box(
  fill: luma(220),
  inset: (x: 4pt, y: 3pt),
  outset: (x: 0pt, y: 3pt),
  radius: 4pt,
  text(fill: rgb(34, 55, 58), ligatures: true, it),
))
```
インラインの`raw`のmarginの取り方が分からなかったので、背景色の`box`でもう一回り囲んでいる。

## TeXのフォントを読み込む

```sh
export TYPST_FONT_PATHS=/usr/local/texlive/2024/texmf-dist/fonts/opentype
```
[参考](https://okumuralab.org/~okumura/misc/241111.html)。なおコマンドからフォントを読み込んでもTinymistには認識されないらしい。

## スライド

[Touying](https://github.com/touying-typ/touying)が便利。

### Touyingテーマの呼び出し

例えば以下のように設定できる。
```typst
#show: metropolis-theme.with(
  align: top,
  config-info(title: [Title], author: [Author #h(2mm) #text(size: .8em)[Institute]], date: datetime.today()),
  config-common(datetime-format: "[month repr:long] [day], [year]", show-strong-with-alert: false),
  config-colors(primary: rgb(221, 25, 106), secondary: rgb(145, 17, 70)),
)
```

### Touyingテーマの自作

1. [theme](https://github.com/touying-typ/touying/tree/main/themes)内のtypファイルをコピーする
2. `#import "../src/exports.typ": *`を`"@preview/touying:0.5.5": *`に書き換える。
3. `#import "university.typ": *`のように読み込む。

[参考](https://touying-typ.github.io/docs/build-your-own-theme)