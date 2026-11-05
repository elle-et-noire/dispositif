export const READING_MODE_STORAGE_KEY = "dispositif:reading-mode";

/** Multi-column reading is opt-in, for every reader regardless of viewport width. */
export function prefersMulti(preference: string | null): boolean {
  return preference === "multi";
}
