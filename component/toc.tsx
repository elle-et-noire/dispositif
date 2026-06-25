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
  };

  return (
    <nav aria-label="目次" className="styled-scrollbar sticky top-4 max-h-[calc(100svh-2rem)] overflow-y-auto font-zen-maru-gothic-medium">
      <ul className="toc-list">
        {headings.map((h) => (
          <li
            key={h.id}
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
