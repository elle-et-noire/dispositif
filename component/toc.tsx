"use client";

import { useEffect, useRef, useState } from "react";
import type { Heading } from "@/lib/toc";

type Props = {
  headings: Heading[];
};

export default function Toc({ headings }: Props) {
  const [activeId, setActiveId] = useState<string>(headings[0]?.id ?? "");
  // 各見出しが（上部の判定バンド内に）見えているかどうかを保持
  const visible = useRef<Record<string, boolean>>({});
  // TOC のスクロールコンテナ（nav）と各項目（li）への参照
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  useEffect(() => {
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.current[entry.target.id] = entry.isIntersecting;
        }
        // ビューポート上部のバンド内にある最初（＝最上部）の見出しを採用。
        // バンド内に何も無いときは更新せず、現在のセクションの強調を維持する。
        const current = headings.find((h) => visible.current[h.id]);
        if (current) setActiveId(current.id);
      },
      // ビューポート上部 約34% を判定バンドにする（下側 66% を除外）
      { rootMargin: "0px 0px -66% 0px", threshold: 0 }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  // TOC が長くて全項目を表示しきれないとき、本体スクロールでアクティブ項目が変わったら
  // その項目が nav の表示範囲に入るよう nav 内だけをスクロールする（ページ全体は動かさない）。
  useEffect(() => {
    const nav = navRef.current;
    const li = itemRefs.current.get(activeId);
    if (!nav || !li) return;

    const navRect = nav.getBoundingClientRect();
    const liRect = li.getBoundingClientRect();
    const margin = 16; // 端に張り付かないよう少し余白を確保

    let delta = 0;
    if (liRect.top < navRect.top + margin) {
      delta = liRect.top - navRect.top - margin;
    } else if (liRect.bottom > navRect.bottom - margin) {
      delta = liRect.bottom - navRect.bottom + margin;
    }
    if (delta === 0) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollBy({ top: delta, behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeId]);

  if (headings.length === 0) return null;

  const handleClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    id: string
  ) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    // 「動きを減らす」設定時は smooth を使わず即座にジャンプする。
    // scrollIntoView の behavior は CSS の scroll-behavior を上書きするため JS 側で判定する。
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    setActiveId(id);
    // マウス等のポインタ操作（detail>0）で押したリンクはフォーカスを外す。残しておくと、
    // クリック直後は :focus-visible が出ない（ポインタ起点）のに、その後 ESC などのキーを
    // 押した瞬間にブラウザの focus-visible 判定がキーボード扱いに切り替わり、押した箇所へ
    // 不自然な枠線が出てしまう。キーボード操作（Enter, detail===0）では枠線は妥当なので残す。
    if (e.detail > 0) e.currentTarget.blur();
  };

  return (
    <nav ref={navRef} aria-label="目次" className="styled-scrollbar sticky top-4 max-h-[calc(100svh-2rem)] overflow-y-auto font-zen-maru-gothic-medium">
      <ul className="toc-list">
        {headings.map((h) => (
          <li
            key={h.id}
            ref={(el) => {
              if (el) itemRefs.current.set(h.id, el);
              else itemRefs.current.delete(h.id);
            }}
            className={`toc-list-item toc-level-${h.level}${activeId === h.id ? " is-active-li" : ""}`}
          >
            <a
              href={`#${h.id}`}
              className="toc-link"
              onClick={(e) => handleClick(e, h.id)}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
