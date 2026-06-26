"use client";

import { useEffect, useState, type MouseEvent } from "react";

// テーマ切り替えボタン。背景（background.tsx）は両テーマ分を SSR 済みで、
// <html> の dark/light クラスに応じて CSS（globals.css の data-theme ルール）が
// 出し分ける。このボタンはそのクラスをトグルし、選択を localStorage に永続化する。
export function ThemeToggle() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    // 初期テーマは layout.tsx の inline script が <html> に付けたクラスを正とする
    // （保存値 → OS 設定の順で決定済み）。ここで state をそれに同期させ、アイコンの
    // 表示を実際のテーマに合わせる。
    setIsDarkMode(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    setIsDarkMode((prev) => {
      const next = !prev;
      const root = document.documentElement;
      // <html> の dark/light クラスをトグルする。Tailwind の dark: variant、
      // globals.css の html.dark ルール、そして背景の data-theme 出し分けがこれに反応する。
      root.classList.toggle("dark", next);
      root.classList.toggle("light", !next);
      // 選択を永続化（次回ロードで inline script が読む）。
      try {
        localStorage.setItem("theme", next ? "dark" : "light");
      } catch { }
      return next;
    });
    // マウス／タッチでの起動（detail!==0）なら、クリック後にフォーカスを外す。
    // 残したままだと、その状態で Esc 等のキーを押した瞬間にブラウザが focus-visible へ
    // 昇格させ、不要なフォーカス枠が出てしまう。キーボード起動（detail===0）では残す。
    if (event.detail !== 0) button.blur();
  }

  return (
    <button
      onClick={toggle}
      aria-label={isDarkMode ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
      className="group fixed top-5 left-5 z-50 flex items-center justify-center size-12 bg-[#faf6ec]/90 text-gray-500 rounded-full shadow-md backdrop-blur-md transition-colors hover:text-[#90332f] dark:bg-slate-900/90 dark:text-cyan-400/60 dark:hover:text-cyan-400"
    >
      {isDarkMode ? (
        // 太陽：円と光線（線のみ）
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          shapeRendering="geometricPrecision"
          className="size-6"
        >
          <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ) : (
        // 月：三日月（線のみ）
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          shapeRendering="geometricPrecision"
          className="size-6"
        >
          <path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )}
    </button>
  );
}
