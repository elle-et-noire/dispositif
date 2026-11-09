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
