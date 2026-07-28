import GithubSlugger from "github-slugger";

export type Heading = {
  level: number;
  text: string;
  id: string;
};

export function getHeadings(source: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  // 閉じフェンスは、開始時と同じ記号を同数以上並べる必要がある。
  // 記号だけを保持すると、```` 内に例示された ``` を閉じフェンスと誤認する。
  let fence: { marker: string; length: number } | null = null;

  for (const line of source.split("\n")) {
    if (fence !== null) {
      const closingFence = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        closingFence
        && closingFence[1][0] === fence.marker
        && closingFence[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }

    const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (openingFence) {
      const sequence = openingFence[1];
      const marker = sequence[0];
      // CommonMark ではバッククォートの info string に ` を含められない。
      if (marker !== "`" || !openingFence[2].includes("`")) {
        fence = { marker, length: sequence.length };
        continue;
      }
    }

    // ## または ### で始まる行のみ対象 (h2, h3)。行頭が `>` 等のものは対象外。
    const m = line.match(/^(#{2,3})\s+(.*\S)\s*$/);
    if (!m) continue;

    const level = m[1].length;
    const text = m[2];
    // rehype-slug と同じルール（github-slugger）でIDを生成
    const id = slugger.slug(text);

    headings.push({ level, text, id });
  }

  return headings;
}
