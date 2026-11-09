export const COLUMNS_STORAGE_KEY = "dispositif:columns";
/** `?columns=multi` or `?columns=single` opens an article in that column layout. */
export const COLUMNS_PARAM = "columns";

export type ColumnMode = "single" | "multi";

/** Multi-column reading is opt-in, for every reader regardless of viewport width. */
export function prefersMulti(preference: string | null): boolean {
  return preference === "multi";
}

/** The column layout named by the URL's query, if it names a valid one. */
export function urlColumnMode(search: string): ColumnMode | undefined {
  const value = new URLSearchParams(search).get(COLUMNS_PARAM);
  return value === "single" || value === "multi" ? value : undefined;
}

/**
 * Whether an article opens in n段. A column layout in the URL wins over the stored
 * preference without replacing it. The URL is never rewritten (Astro's router
 * would treat a changed query as another page on back and forward), so once
 * the reader has left that history entry in a column layout, reloading or returning to
 * it keeps that column layout instead of the URL's.
 */
export function opensMulti(search: string, preference: string | null, entryMode?: ColumnMode): boolean {
  const fromUrl = urlColumnMode(search);
  if (fromUrl) return (entryMode ?? fromUrl) === "multi";
  return prefersMulti(preference);
}
