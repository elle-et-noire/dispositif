export const READING_MODE_STORAGE_KEY = "dispositif:reading-mode";

/** Keep the first-visit heuristic identical in the reader and its preloader. */
export function prefersMulti(preference: string | null, viewportWidth: number, columnPitch: number): boolean {
  return preference === "multi" || (preference !== "single" && viewportWidth >= 2 * columnPitch);
}
