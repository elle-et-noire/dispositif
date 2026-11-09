import type { ColumnMetrics, ReadingPoint } from "./column-coordinates";

// Pure helpers for the per-history-entry reading positions kept in
// sessionStorage. The reader owns storage access; these only decide what to
// keep, so the merge rules can be tested without a browser.

export type HistoryPosition = {
  mode: "single" | "multi"; position: number; point?: ReadingPoint; layout?: ColumnMetrics;
  anchor?: { path: number[]; ratio: number; width: number };
  details?: boolean[];
};

export const HISTORY_STORAGE_KEY = "dispositif:reading-history";
export const HISTORY_LIMIT = 100;

const isHistoryPosition = (value: unknown): value is HistoryPosition => {
  if (!value || typeof value !== "object") return false;
  const entry = value as { mode?: unknown; position?: unknown };
  return (entry.mode === "single" || entry.mode === "multi") && Number.isFinite(entry.position);
};

/** Parses stored JSON, dropping malformed entries. Throws on invalid JSON. */
export function parseSavedHistory(json: string | null): Map<string, HistoryPosition> {
  const entries = new Map<string, HistoryPosition>();
  const saved: unknown = JSON.parse(json ?? "[]");
  if (Array.isArray(saved)) for (const item of saved) {
    if (Array.isArray(item) && typeof item[0] === "string" && isHistoryPosition(item[1])) entries.set(item[0], item[1]);
  }
  return entries;
}

/**
 * Other same-origin documents can save while this one is alive. Start from
 * what is stored and apply only the entries this document changed, moving
 * them to the newest end; keep the newest `limit` entries.
 */
export function mergeHistory(stored: Map<string, HistoryPosition>, local: Map<string, HistoryPosition>,
  changed: Iterable<string>, limit = HISTORY_LIMIT): [string, HistoryPosition][] {
  const merged = new Map(stored);
  for (const key of changed) {
    const value = local.get(key);
    if (value) { merged.delete(key); merged.set(key, value); }
  }
  return [...merged].slice(-limit);
}

/**
 * Chooses the position to restore for an existing history entry. A local
 * change not yet persisted is the newest; otherwise storage may hold a newer
 * position written by another document since this one loaded.
 */
export function resolveHistoryEntry(local: HistoryPosition | undefined, stored: HistoryPosition | undefined,
  changedLocally: boolean): HistoryPosition | undefined {
  return changedLocally ? local : stored ?? local;
}
