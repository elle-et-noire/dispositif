"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Next.js App Router を `output: "export"`（静的エクスポート）で使うと、
 * ページをリロードした後などに「戻る/進む」(popstate) を押したとき、
 * 対象ルートのルーター状態が失われていてクライアント側の再描画が走らず、
 * URL だけ変わって表示は元のページのまま、という不具合が起きる
 * （GitHub Pages 上で記事が「閉じない」原因）。
 *
 * popstate のあとで「React が実際に描画しているパス」と「ブラウザの URL」が
 * 食い違っていたら、そのときだけ本物のナビゲーション（リロード）を強制して
 * 表示を URL に一致させる。SPA 遷移が正常に効いた場合は食い違わないので
 * 余計なリロードは発生しない。
 */
export default function NavigationFix() {
  const pathname = usePathname();
  // React が最後に描画し終えた時点のブラウザパス（basePath 込み）
  const renderedPath = useRef<string | null>(null);

  useEffect(() => {
    renderedPath.current = window.location.pathname;
  }, [pathname]);

  useEffect(() => {
    const onPopState = () => {
      // ルーターに再描画の猶予を与えてから整合性を確認する。
      window.setTimeout(() => {
        if (renderedPath.current !== window.location.pathname) {
          window.location.reload();
        }
      }, 100);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return null;
}
