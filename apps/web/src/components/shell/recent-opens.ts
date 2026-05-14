// localStorage-backed "recently opened" helper for the command palette.
// Kept intentionally framework-agnostic so it can be unit-tested in isolation.

export type RecentEntryType = "TASK" | "BUG" | "REQUIREMENT" | "INTAKE";

export type RecentEntry = {
  id: string;
  type: RecentEntryType;
  code: string;
  title: string;
  href: string;
};

export const RECENT_STORAGE_KEY = "pdm:command-palette:recent";

// Cap at 6 entries: 5-7 is the visual sweet spot before the group starts
// crowding navigation / create / preferences out of the default view.
export const RECENT_MAX = 6;

function isRecentEntry(value: unknown): value is RecentEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Partial<RecentEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.type === "string" &&
    (entry.type === "TASK" ||
      entry.type === "BUG" ||
      entry.type === "REQUIREMENT" ||
      entry.type === "INTAKE") &&
    typeof entry.code === "string" &&
    typeof entry.title === "string" &&
    typeof entry.href === "string"
  );
}

function entryKey(entry: Pick<RecentEntry, "id" | "type">): string {
  return `${entry.type}:${entry.id}`;
}

/**
 * Read the persisted recent list from localStorage.
 * - Filters out malformed entries silently.
 * - Deduplicates by composite `${type}:${id}` keeping the first occurrence
 *   (which represents the most recent access).
 * - Caps at RECENT_MAX.
 */
export function readRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const out: RecentEntry[] = [];
    for (const item of parsed) {
      if (!isRecentEntry(item)) continue;
      const key = entryKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Persist a new "just opened" entry, deduplicating by `${type}:${id}` and
 * capping the list at RECENT_MAX. Returns the new list.
 */
export function writeRecent(entry: RecentEntry): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const current = readRecent();
    const key = entryKey(entry);
    const next = [entry, ...current.filter((item) => entryKey(item) !== key)].slice(
      0,
      RECENT_MAX,
    );
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

/**
 * Prune entries whose corresponding service no longer surfaces them
 * (e.g. the underlying task/bug/requirement/intake was deleted).
 *
 * `liveKeys` is the set of `${type}:${id}` strings currently present in
 * the fetched entity caches. When the fetch hasn't completed yet
 * (`liveKeys === null`) we keep the list untouched to avoid wiping
 * entries before we know what's live.
 */
export function pruneStaleRecent(
  current: RecentEntry[],
  liveKeys: ReadonlySet<string> | null,
): { next: RecentEntry[]; changed: boolean } {
  if (liveKeys === null) return { next: current, changed: false };
  const next = current.filter((item) => liveKeys.has(entryKey(item)));
  const changed = next.length !== current.length;
  if (changed && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / disabled storage errors
    }
  }
  return { next, changed };
}

export function buildLiveKey(type: RecentEntryType, id: string): string {
  return `${type}:${id}`;
}
