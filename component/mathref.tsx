"use client";

import { useEffect } from "react";

/* \eqref（式番号の相互参照）リンクを TOC と同じ滑らかなスクロールで遷移させる。
   MathJax の CHTML 出力は eqref を生の <a href="#mjx-eqn:..."> として吐き、
   dangerouslySetInnerHTML で本文に挿入されるため、クリックするとブラウザ標準の
   即時ジャンプになる（component/toc.tsx の handleClick は TOC 自身のリンクにしか
   効かない）。ここで同じ scrollIntoView(smooth) を肩代わりして挙動を揃える。
   このコンポーネント自体は何も描画しない（return null）。 */

export default function MathRef() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // 修飾キー付きクリック（新規タブ等）や左クリック以外はブラウザに任せる。
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target as Element | null;
      // MathJax の eqref リンクは .post 内の <a href="#mjx-eqn..."> として出力される。
      const link = target?.closest<HTMLAnchorElement>('.post a[href^="#mjx-eqn"]');
      if (!link) return;

      // href のフラグメントは encodeURIComponent 済み（例: #mjx-eqn%3Aeq%3Afoo）。
      // 一方、式側の id はコロン未エンコード（mjx-eqn:eq:foo）なのでデコードして引く。
      const hash = link.hash; // "#mjx-eqn%3Aeq%3Afoo"
      if (!hash) return;
      const id = decodeURIComponent(hash.slice(1));
      const el = document.getElementById(id);
      if (!el) return;

      event.preventDefault();
      // 「動きを減らす」設定時は smooth を使わず即座にジャンプする（toc.tsx と同方針）。
      // scrollIntoView の behavior は CSS の scroll-behavior を上書きするため JS 側で判定する。
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", hash);

      // ポインタ操作（detail>0）で押したリンクはフォーカスを外す。残しておくと、その後
      // Esc などのキーを押した瞬間にブラウザが focus-visible 扱いへ昇格させ、押した箇所へ
      // 不自然な枠線が出る（toc.tsx / codecopy.tsx と同じ理由）。
      if (event.detail > 0) link.blur();
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
