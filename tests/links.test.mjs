// Checks the links and ids of every page in the production build (dist/), as
// GitHub Pages serves it under the base path. Run `npm run build` first.
// Links to other sites are not followed.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import rehypeRaw from "rehype-raw";
import { visit } from "unist-util-visit";
import config from "../astro.config.mjs";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const base = `${config.base.replace(/\/$/, "")}/`;
const siteRoot = new URL(base, config.site);

// Attributes holding a URL. srcSet holds several, each followed by its size.
const urlProperties = ["href", "src", "srcSet", "poster", "action", "data", "xLinkHref"];
// Attributes holding ids of elements on the same page.
const idrefProperties = [
  "htmlFor", "ariaControls", "ariaLabelledBy", "ariaDescribedBy", "ariaOwns", "ariaActiveDescendant",
  "ariaDetails", "ariaErrorMessage", "ariaFlowTo", "headers", "list", "form", "popoverTarget",
];
const cssUrl = /url\(\s*(["']?)(.*?)\1\s*\)/g;

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
const htmlFiles = (dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory()
  ? readdirSync(dir, { recursive: true }).filter((name) => name.endsWith(".html")).map((name) => join(dir, name))
  : [];

// Parses with parse5 through rehype-raw, the HTML parser the site already depends on.
// The leading doctype makes it parse a whole document rather than a fragment.
const parse = (html) => rehypeRaw()({ type: "root", children: [{ type: "doctype" }, { type: "raw", value: html }] });

function readPage(file) {
  const path = relative(dist, file).split(sep).join("/");
  const url = new URL(path.replace(/(^|\/)index\.html$/, "$1"), siteRoot);
  const ids = new Map();
  const names = new Set();
  const urls = [];
  const idrefs = [];
  visit(parse(readFileSync(file, "utf8")), "element", (node) => {
    const { properties } = node;
    if (typeof properties.id === "string") ids.set(properties.id, (ids.get(properties.id) ?? 0) + 1);
    if (node.tagName === "a" && typeof properties.name === "string") names.add(properties.name);
    for (const property of urlProperties) {
      const value = properties[property];
      if (value === undefined) continue;
      const values = property === "srcSet" ? [value].flat().map((candidate) => String(candidate).trim().split(/\s+/)[0]) : [String(value)];
      for (const url of values) urls.push({ url, where: `<${node.tagName} ${property}>` });
    }
    for (const property of idrefProperties) {
      for (const id of [properties[property] ?? []].flat()) idrefs.push({ id: String(id), where: `<${node.tagName} ${property}>` });
    }
    const css = [
      node.tagName === "style" ? node.children.map((child) => child.value ?? "").join("") : "",
      typeof properties.style === "string" ? properties.style : "",
    ].join("\n");
    for (const [, , url] of css.matchAll(cssUrl)) urls.push({ url, where: `<${node.tagName}> url()` });
  });
  return { path, url, ids, names, urls, idrefs };
}

const pages = new Map(htmlFiles(dist).map((file) => readPage(file)).map((page) => [page.url.pathname, page]));

// The page or file a URL on this site loads, as GitHub Pages serves dist/.
function target(url) {
  if (!url.pathname.startsWith(base)) return { problem: `ベースパス ${base} の外を指す` };
  let path;
  try {
    path = decodeURIComponent(url.pathname.slice(base.length));
  } catch {
    return { problem: "パスのURLエンコードが壊れている" };
  }
  const file = join(dist, path.endsWith("/") || path === "" ? `${path}index.html` : path);
  if (isFile(file)) return { page: pages.get(url.pathname) };
  // GitHub Pages redirects a directory without the trailing slash to the directory.
  if (isFile(join(file, "index.html"))) return { page: pages.get(`${url.pathname}/`) };
  return { problem: "dist にない" };
}

// Whether a fragment scrolls to something, as browsers find it: the id as written in
// the URL, then the percent-decoded id (headings use Japanese ids), then <a name>.
function hasFragment(page, hash) {
  const fragment = hash.slice(1);
  if (fragment === "") return true;
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {}
  if (decoded.toLowerCase() === "top") return true;
  return [fragment, decoded].some((id) => page.ids.has(id) || page.names.has(id));
}

function problems(page) {
  const found = [];
  for (const { url: value, where } of page.urls) {
    let url;
    try {
      url = new URL(value, page.url);
    } catch {
      found.push(`${where} ${value}: URLとして読めない`);
      continue;
    }
    if (url.origin !== siteRoot.origin) continue;
    const { page: linked, problem } = target(url);
    if (problem) found.push(`${where} ${value}: ${problem}`);
    else if (url.hash && linked && !hasFragment(linked, url.hash)) found.push(`${where} ${value}: ${linked.path} に id がない`);
  }
  for (const { id, where } of page.idrefs) {
    if (!page.ids.has(id)) found.push(`${where} ${id}: このページに id がない`);
  }
  for (const [id, count] of page.ids) {
    if (count > 1) found.push(`id="${id}" が ${count} 個ある`);
  }
  return found;
}

test("ビルド結果に HTML がある", () => {
  assert.ok(pages.size > 0, `${dist} に HTML がない。先に npm run build を実行する`);
});

for (const page of pages.values()) {
  test(`${page.path}: リンクの行き先と、#id の参照先があり、id が重複しない`, () => {
    assert.deepEqual(problems(page), []);
  });
}
