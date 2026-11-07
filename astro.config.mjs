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

// https://astro.build/config
export default defineConfig({
  site: 'https://elle-et-noire.github.io',
  base: '/dispositif',
  prefetch: true,
  vite: {
    plugins: [tailwindcss(), notProseClassSelector()],
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
