"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * トップ（`/`）に直接アクセスされたとき、URL を `/posts` に置き換える小さな
 * クライアント子コンポーネント。記事を閉じたときの遷移先（`/posts`）と URL を
 * 一本化するためのもの。
 *
 * output:export では index ルートを `redirect()` で静的にリダイレクトできない
 * ため、クライアント側で `router.replace("/posts")` する。`/posts` は
 * `app/[slug]/page.tsx` の予約スラッグで同じ一覧を描画するので、置換は SPA 遷移
 * で行われ（index への push と違いフルリロードにならない）、背景模様も維持される。
 * 親（app/page.tsx）が同じ一覧を描画しているのでチラつきも出ない。
 *
 * 描画自体は親のサーバーコンポーネント側で行う（一覧は fs アクセスを伴うため
 * クライアントコンポーネントからは描画できない）。ここは副作用専用で null を返す。
 */
export default function RedirectToPosts() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/posts");
  }, [router]);
  return null;
}
