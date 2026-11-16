// Temporary: the site's config with source maps, built to .measure-inp/dist-map
// only to map trace positions in the minified bundles back to src/.
import config from "../astro.config.mjs";
export default {
  ...config,
  outDir: "./.measure-inp/dist-map",
  vite: { ...config.vite, build: { ...config.vite?.build, sourcemap: true } },
};
