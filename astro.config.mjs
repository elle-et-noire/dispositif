// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  prefetch: true,
  vite: {
    plugins: [tailwindcss()],
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
