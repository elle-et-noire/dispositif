"use client";

import { useEffect } from "react";

/* Zenn 風のコードコピーボタン。Zenn 同様クライアント側で各コードブロックの
   右上に注入し、クリックでコードをクリップボードへコピーする。コピー後はチェック
   アイコン＋「Copied!」ツールチップに切り替わり、約 2 秒で元に戻る（見た目は
   app/globals.css の .code-copy-button 系で定義）。
   このコンポーネント自体は何も描画しない（return null）。 */

// クリップボード／チェックの 2 アイコンを内包。CSS の data-copied で表示を切り替える。
const COPY_ICON =
  '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const CHECK_ICON =
  '<svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';

// rehype-pretty-code は各行を <span data-line> で包む。code 要素の textContent は
// grid レイアウトのため改行が落ちるので、行ごとに取り出して \n で連結する。
const extractCode = (figure: Element): string => {
  const lines = figure.querySelectorAll("pre code [data-line]");
  if (lines.length > 0) {
    return Array.from(lines, (l) => l.textContent ?? "").join("\n");
  }
  const pre = figure.querySelector("pre");
  return (pre as HTMLElement | null)?.innerText ?? "";
};

export default function CodeCopy() {
  useEffect(() => {
    const figures = document.querySelectorAll(
      ".post figure[data-rehype-pretty-code-figure]",
    );
    figures.forEach((figure) => {
      if (figure.querySelector(".code-copy-button")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy-button";
      button.setAttribute("aria-label", "コードをコピー");
      button.innerHTML =
        COPY_ICON +
        CHECK_ICON +
        '<span class="code-copy-tooltip" role="status">Copied!</span>';
      figure.appendChild(button);
    });

    const timers = new WeakMap<Element, number>();
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLButtonElement>(".code-copy-button");
      if (!button) return;
      const figure = button.closest("figure");
      if (!figure) return;

      const finish = () => {
        button.setAttribute("data-copied", "true");
        const prev = timers.get(button);
        if (prev) window.clearTimeout(prev);
        timers.set(
          button,
          window.setTimeout(() => button.removeAttribute("data-copied"), 2000),
        );
      };

      const text = extractCode(figure);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(finish, () => {});
      } else {
        // セキュアコンテキスト外向けのフォールバック。
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          finish();
        } catch {
          /* noop */
        }
        document.body.removeChild(ta);
      }
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
