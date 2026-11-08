export const READING_MODE_STORAGE_KEY = "dispositif:reading-mode";
/** `?view=multi` or `?view=single` opens an article in that mode. */
export const READING_MODE_PARAM = "view";

export type ReadingModeName = "single" | "multi";

/** Multi-column reading is opt-in, for every reader regardless of viewport width. */
export function prefersMulti(preference: string | null): boolean {
  return preference === "multi";
}

/** The mode named by the URL's query, if it names a valid one. */
export function urlReadingMode(search: string): ReadingModeName | undefined {
  const value = new URLSearchParams(search).get(READING_MODE_PARAM);
  return value === "single" || value === "multi" ? value : undefined;
}

/**
 * Whether an article opens in n段. A mode in the URL wins over the stored
 * preference without replacing it. The URL is never rewritten (Astro's router
 * would treat a changed query as another page on back and forward), so once
 * the reader has left that history entry in a mode, reloading or returning to
 * it keeps that mode instead of the URL's.
 */
export function opensMulti(search: string, preference: string | null, entryMode?: ReadingModeName): boolean {
  const fromUrl = urlReadingMode(search);
  if (fromUrl) return (entryMode ?? fromUrl) === "multi";
  return prefersMulti(preference);
}
