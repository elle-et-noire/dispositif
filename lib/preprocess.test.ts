import assert from "node:assert/strict";
import test from "node:test";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { preprocessMarkdown } from "./preprocess.ts";

test("掲載コードが独自記法に変換されず、後続の見出しを読める", () => {
  const source = [
    "$z$",
    "~~~txt",
    "$x$",
    "~~~",
    "",
    "## 後続",
    "",
    "`````txt",
    "```js",
    "$x$ ^[注]",
    "```",
    "`````",
    "",
    "```html:example.html",
    "<summary>{'abc'}</summary>",
    "```",
    "",
    "- リスト",
    "",
    "  > ~~~txt",
    "  > $x$",
    "  > ~~~",
    "",
    "本文の `$x$` と $z$",
    "",
    "    <details><summary>{'例'}</summary>",
    "    $x$",
    "",
    "段落",
    "",
    "    ```txt:literal",
    "    $x$",
  ].join("\n");
  const { processible, mathexprs } = preprocessMarkdown(source);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(processible);
  const code: string[] = [];
  visit(tree, "code", (node) => { code.push(node.value); });
  assert.deepEqual(code, ["$x$", "```js\n$x$ ^[注]\n```", "<summary>{'abc'}</summary>", "$x$",
    "<details><summary>{'例'}</summary>\n$x$", "```txt:literal\n$x$"]);
  assert.ok(tree.children.some((node) => node.type === "heading"
    && node.children.some((child) => child.type === "text" && child.value === "後続")));
  assert.match(processible, /\x60\x60\x60html\[data-file='example.html'\]/);
  assert.match(processible, /\x60\$x\$\x60/);
  assert.equal(mathexprs.length, 2);
  assert.ok(mathexprs.every((math) => math.includes("z")));
});

test("空行のない折りたたみ内でも掲載コードと旧記法の見出しを読める", () => {
  for (const title of ["{`開く`}", "\n{`開く`}\n"]) {
    const source = [
      `<details><summary>${title}</summary>`,
      "~~~txt",
      "<summary>{'abc'}</summary> $x$",
      "~~~",
      "</details>",
    ].join("\n");
    const { processible, mathexprs } = preprocessMarkdown(source);
    assert.match(processible, /<summary>\s*開く\s*<\/summary>\n\n~~~txt\n<summary>\{'abc'\}<\/summary> \$x\$\n~~~/);
    assert.deepEqual(mathexprs, []);
  }
});
