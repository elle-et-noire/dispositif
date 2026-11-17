// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// @tailwindcss/typography excludes `not-prose` subtrees with
// `:not(:where([class~=not-prose],[class~=not-prose] *))`. In Chromium an
// attribute selector on `class` followed by a universal descendant makes any
// class change (for example on <html> while an article opens) restyle the
// whole document. `.not-prose` matches the same elements inside the same
// :where() (specificity 0) and is invalidated by class name instead.
// Runs right after Tailwind generates the CSS (both are `pre`), so dev and
// build see the same rules.
const NOT_PROSE_ATTRIBUTE = /\[class~=(["']?)not-prose\1\]/g;
/** @returns {import('vite').Plugin} */
const notProseClassSelector = () => ({
  name: 'dispositif:not-prose-class-selector',
  enforce: 'pre',
  transform: {
    filter: { id: /\.css(?:\?.*)?$/ },
    handler(code) {
      if (!code.includes('not-prose')) return;
      const next = code.replace(NOT_PROSE_ATTRIBUTE, '.not-prose');
      return next === code ? undefined : { code: next, map: null };
    },
  },
});

// Typography's rules that look at an element's previous sibling (`h2 + *`)
// or its place among its siblings (`:first-child`, `:last-of-type`) skip the
// copies and their parents that the n段 layout places at a measured box
// (data-cl-placed, column-fragments.ts). None of these rules changes how they
// look: the margin rules lose to their fixed margin of 0, and the others need
// a parent or ancestor (.prose, li, blockquote, a table) that they do not
// have. The mark is checked before the sibling or the position, so the
// browser does not record that they depend on their siblings. Otherwise
// Firefox restyles other copies with all their contents when a copy is
// inserted or removed (docs/column-layout.md, "操作への応答"). globals.css
// does the same for its own sibling rules.
const TYPOGRAPHY_WHERE = /:where\(([^(){}]*)\)(?=:not\(:where\((?:\.not-prose|\[class~=))/g;
const UNPLACED = ':not([data-cl-placed])';
/** @returns {import('vite').Plugin} */
const unplacedTypographySiblings = () => ({
  name: 'dispositif:unplaced-typography-siblings',
  enforce: 'pre',
  transform: {
    filter: { id: /\.css(?:\?.*)?$/ },
    handler(code) {
      if (!code.includes('not-prose')) return;
      const next = code.replace(TYPOGRAPHY_WHERE, (_, selector) => `:where(${selector
        .replace(/\+\s*\*/g, `+ ${UNPLACED}`)
        .replace(/:(?:first|last)-(?:child|of-type)/g, `${UNPLACED}$&`)})`);
      return next === code ? undefined : { code: next, map: null };
    },
  },
});

// https://astro.build/config
export default defineConfig({
  site: 'https://elle-et-noire.github.io',
  base: '/dispositif',
  prefetch: true,
  vite: {
    plugins: [tailwindcss(), notProseClassSelector(), unplacedTypographySiblings()],
    ssr: {
      external: [
        'mathjax',
        '@mathjax/src',
        '@mathjax/mathjax-newcm-font',
        '@mathjax/mathjax-tex-font',
      ],
    },
  },
});
