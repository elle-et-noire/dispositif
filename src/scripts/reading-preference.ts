export const READING_MODE_STORAGE_KEY = "dispositif:reading-mode";

/** Multi-column reading is opt-in, consistently in the reader and preloader. */
export function prefersMulti(preference: string | null): boolean {
  return preference === "multi";
}
