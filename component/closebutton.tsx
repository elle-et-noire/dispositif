"use client";

import Link from "next/link";
import { useCloseToList } from "./closenav";

/**
 * 記事を閉じて記事一覧へ戻るボタン。
 *
 * 遷移の実装と、なぜ `/posts` へ `router.push` するのかの詳細は
 * useCloseToList（closenav.tsx）を参照。素の `<Link>` クリックは（プリフェッチ
 * されていない遷移先だと）フルリロードになるため、`onClick` で明示的に遷移する。
 */
export default function CloseButton() {
  const close = useCloseToList();
  return (
    <Link
      href="/posts"
      prefetch={false}
      aria-label="記事を閉じて一覧へ戻る"
      className="visible flex size-11 items-center justify-center -m-1.5"
      onClick={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="batsu" aria-hidden></div>
    </Link>
  );
}
