## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## テストの追加

- テストは、壊れたら閲覧者が気づく不具合か、過去に実際に起きた不具合の再発を検知するものだけを追加する。
- 次のテストは追加しない。
  - 型検査（`astro check`）やビルドで既に分かること
  - 定数、設定値、文言、CSSの値を写して比べるもの
  - 実装の内部の手順や呼び出し回数を確かめるもの（リファクタリングで壊れるだけのテスト）
  - 同じ不具合で既存のテストが既に失敗するもの
- 不具合を直すときは、まず既存のテストを直すか広げて検知できないか検討する。新しいテストファイルは最後の手段にする。
- テストを追加するときは、そのテストがないと見逃す不具合をPRの概要欄に1文で書く。書けないテストは追加しない。

## 文書の書き方

- READMEには閲覧者から見た動作と使い方を書く。実装の詳細は`docs/`に書く。
- 同じことを複数の文書や節に書かない。一方に書き、もう一方からはその場所を示す。
- 定数、設定値、CSSの値をコードから文書へ写さない。ファイルの場所を示す。
- 文書には今のコードと動作の説明と、その理由だけを書く。過去の経緯は書かず、PR・コミット・タグを示す。例外として、採らなかった方式は、同じことを試し直さないよう理由を数行にまとめる。
- 計測値を文書に写さない。値はコミットメッセージかPRの概要欄に書き、文書からはそのコミットかPRを示す。どうしても文書に書くときは、元の値をそのまま写し、丸めない。
- 確かめていない理由を書かない。推定は推定と書く。
- 調べて分かったことは、報告する前に関係する文書へ書く。
- 1段・n段の表示は「段組み」と呼び、「モード」と書かない。読んでいる場所に関する名前には reading を、段の組み方に関する名前には column を使う。コードの識別子 `mode`（sessionStorageに保存する履歴の項目など）は、保存した値と合わせるために残している。

## GitとPR

- rebaseとforce pushはしない。`reset --hard` してから押し直すこともしない。PRのブランチを新しいmainに合わせるときは `git merge main` を使い、pushした後の誤りは新しいコミットで直す。
- コードとテストの変更は、ブランチを作ってPRにし、CIを通す。マージは、ユーザーがそのPRについて指示したときだけ行う。
- 文書だけの変更（`README.md`・`ROADMAP.md`・`AGENTS.md`・`docs/`）は、mainへ直接pushしてよい。CIはこれらの変更では動かない。
- 既存のPRのブランチにコミットを足す前に、`gh pr view <番号> --json state` でマージされていないか確かめる。ユーザーは知らせずにマージすることがある。マージ済みなら、mainから新しいブランチを作って別のPRにする。

## 計測とサーバー

- 表示速度と操作の応答の計測の手順は、`docs/article-open.md` の「計測」にある。
- このマシンは他のジョブで負荷が高いことが多い。計測の結果には、そのときのload averageを添える。
- 計測している間は、他の作業でプレビューサーバーやブラウザーを動かさない。
- サーバーを止めるときは、`astro preview stop`・`astro dev stop` か、PIDを指定した `kill` を使う。`pkill -f` は、コマンドを実行しているシェル自身の引数にも一致し、そのシェルを止めることがある。
