"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * 記事を閉じて記事一覧へ戻るボタン。
 *
 * フルリロードせず SPA 遷移で一覧へ戻す（背景模様を維持するため）。実現には
 * 2 つの Next.js (output:export) の癖を回避する必要がある：
 *
 *  1. index ルート(`/`)への `router.push("/")` は SPA にならずフルリロードに
 *     フォールバックする。一方、動的ルート `[slug]` へのパラメータ遷移は SPA で
 *     行える。そこで一覧を `[slug]` の予約スラッグ `/posts` として用意し
 *     （app/[slug]/page.tsx 参照）、そこへ `push("/posts")` する。
 *  2. `<Link>` の prefetch は一部ルートで RSC 取得に失敗し、その失敗がルーターの
 *     キャッシュを汚染して以後の遷移を無反応にする。よって `prefetch={false}`。
 *
 * また素の `<Link>` クリックは（プリフェッチされていない遷移先だと）フルリロード
 * になるため、`onClick` で明示的に `router.push` する。
 *
 * ── 実測（直接アクセスした記事ページから router.push、GitHub Pages 相当の静的
 *    サーバ＋basePath で計測。docReqs = 遷移時に飛んだ HTML ドキュメント要求数）──
 *      push("/")        : docReqs=2  → フルリロード（index ルートは SPA 不可）
 *      push("/posts")   : docReqs=0  → SPA（予約スラッグの動的ルート）
 *      push("/<記事>")  : docReqs=0  → SPA（通常の記事＝動的ルート）
 *    すなわち閉じる遷移先は index 以外（動的ルート）でなければならず、`/posts`
 *    を用意している理由がこれ。
 */
export default function CloseButton() {
  const router = useRouter();
  return (
    <Link
      href="/posts"
      prefetch={false}
      aria-label="記事を閉じて一覧へ戻る"
      className="visible flex size-11 items-center justify-center -m-1.5"
      onClick={(e) => {
        e.preventDefault();
        router.push("/posts");
      }}
    >
      <div className="batsu" aria-hidden></div>
    </Link>
  );
}
