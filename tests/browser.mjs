// Shared setup for the browser tests: which site and browsers to use, and when
// an article is ready to be operated on.
import { chromium, firefox } from "playwright-core";

/** The site under test. CI serves the production build here with astro preview. */
export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:4321/dispositif/";

/** The URL of an article. `suffix` follows the slug's slash, such as `?columns=multi` or `#id`. */
export const articleUrl = (slug = "symmetric-polynomial", suffix = "") => new URL(`${slug}/${suffix}`, BASE_URL).href;

/** The article most tests use: it has math, code, details and many headings. */
export const ARTICLE_URL = articleUrl();

const selected = process.env.TEST_ENGINES?.split(",");
/** [name, engine] pairs for the tests that run in both engines. TEST_ENGINES=chromium,firefox narrows them. */
export const engines = Object.entries({ chromium, firefox }).filter(([name]) => !selected || selected.includes(name));

/** Launches a browser. TEST_BROWSER_PATH replaces Playwright's Chromium with a local one. */
export function launch(engine, options = {}) {
  const executablePath = engine === chromium ? process.env.TEST_BROWSER_PATH || undefined : undefined;
  return engine.launch({ executablePath, ...options });
}

/** Stores the 1段 ("single") or n段 ("multi") choice before the scripts of a page, or of every page in a context, run. */
export function storeColumns(target, mode) {
  return target.addInitScript((mode) => localStorage.setItem("dispositif:columns", mode), mode);
}

/**
 * Waits until the column layout has started on an article. cl-ready is set
 * before the layout applies the mode and the first position in its first
 * frame, which removes cl-pending; a scroll made before that frame is lost.
 */
export function waitForColumnLayout(page) {
  return page.waitForSelector('html[data-page-kind="article"].cl-ready:not(.cl-pending)');
}
