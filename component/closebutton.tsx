"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getDocumentInitialPath } from "./navfix";

/**
 * 記事を閉じてトップ（記事一覧）へ戻るボタン。
 *
 * 記事ページでは MathJax が React 管理下の DOM を `<mjx-container>` に置き換える
 * ため、`<Link>` クリックや `router.push()` といった「前進」ナビゲーションが
 * 静かに失敗する（React の差分計算が外部 DOM 改変と衝突する）。一方
 * `router.back()`（履歴 popstate 経由）は描画後も機能するので、これでトップへ
 * 戻る。フルリロードしないため背景の白飛びが起きない。
 *
 * ただし back() で戻れるのはサイト内から遷移して来た場合だけ。記事を直接開いた
 * （= この文書の初期パスが記事自身）場合は戻り先が無いので、その時だけ本物の
 * ナビゲーションでトップへ移動する。
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
