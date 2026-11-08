// 支援技術に読ませる数式のラベル。lib/mathjax.ts が各数式の aria-label にする。
// 経緯は mathjax.ts の labelForScreenReaders の説明を参照。
export function speechLabel(latex: string, tags: string[]): string {
  const source = latex
    // 式番号は見えている形（tags）で末尾に足すので、\label と \tag は読まない。
    .replace(/\\(?:label|tag\*?)\{[^{}]*\}/g, "")
    // preprocess.ts がインライン数式の前後に足す間隔。
    .replace(/^(?:\s*\\hspace\{[^{}]*\})+|(?:\\hspace\{[^{}]*\}\s*)+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return [source, ...tags].filter(Boolean).join(" ");
}
