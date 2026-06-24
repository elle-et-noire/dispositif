"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getDocumentInitialPath } from "./navfix";

/**
 * 記事を閉じてトップ（記事一覧）へ戻るボタン。
 *
 * このサイトは Next.js App Router を `output: "export"` ＋ `basePath`
 * （GitHub Pages のサブパス配信）で動かしている。この構成では「index ルート
 * (`/`) への前進クライアント遷移」だけが壊れており、`<Link href="/">` の
 * クリックや `router.push("/")` がネットワークも出さずに無反応になる
 * （ルーターが basePath を剥がすとパスが空文字になり `/` ルートにマッチ
 * しないため）。記事→別記事など index 以外への前進遷移や、戻る(popstate)は
 * 正常に動く。MathJax の有無とは無関係であることは検証済み。
 *
 * そこでトップへ戻るには `router.back()`（履歴 popstate 経由）を使う。SPA 遷移の
 * ままなのでフルリロードによる背景の白飛びも起きない。ただし back() で戻れるのは
 * サイト内から遷移して来た場合だけなので、記事を直接開いた（＝この文書の初期
 * パスが記事自身）場合は戻り先が無く、その時だけ本物のナビゲーションでトップへ
 * 移動する（この経路のみフルリロードになる）。
 */
export default function CloseButton() {
  const router = useRouter();
  return (
    <Link
      href="/"
      className="visible h-8"
      prefetch={true}
      onClick={(e) => {
        e.preventDefault();
        const home = e.currentTarget.href;
        const initial = getDocumentInitialPath();
        if (initial !== null && initial !== window.location.pathname) {
          // サイト内から来た → SPA で戻る（白飛びなし）
          router.back();
        } else {
          // 直接アクセス等で戻り先が無い → 実ナビゲーションでトップへ
          window.location.assign(home);
        }
      }}
    >
      <div className="batsu"></div>
    </Link>
  );
}
