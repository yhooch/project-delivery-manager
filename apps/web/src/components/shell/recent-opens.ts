// localStorage-backed "recently opened" helper for the command palette.
// Kept intentionally framework-agnostic so it can be unit-tested in isolation.

export type RecentEntryType = "TASK" | "BUG" | "REQUIREMENT" | "INTAKE";

export type RecentEntry = {
  id: string;
  type: RecentEntryType;
  displayCode: string;
  title: string;
  href: string;
  organizationId?: string;
  spaceId?: string;
};

export const RECENT_STORAGE_KEY = "pdm:command-palette:recent";
export const RECENT_CHANGED_EVENT = "pdm:command-palette:recent-changed";

export type RecentScope = {
  organizationId?: string;
  spaceId?: string;
};

// Cap at 6 entries: 5-7 is the visual sweet spot before the group starts
// crowding navigation / create / preferences out of the default view.
export const RECENT_MAX = 6;

function normalizeRecentEntry(value: unknown): RecentEntry | null {
  if (value === null || typeof value !== "object") return null;
  const entry = value as Partial<RecentEntry> & { code?: unknown };
  const displayCode =
    typeof entry.displayCode === "string"
      ? entry.displayCode
      : typeof entry.code === "string"
        ? entry.code
        : undefined;

  if (
    typeof entry.id === "string" &&
    typeof entry.type === "string" &&
    (entry.type === "TASK" ||
      entry.type === "BUG" ||
      entry.type === "REQUIREMENT" ||
      entry.type === "INTAKE") &&
    typeof displayCode === "string" &&
    typeof entry.title === "string" &&
    typeof entry.href === "string"
  ) {
    return {
      id: entry.id,
      type: entry.type,
      displayCode,
      title: entry.title,
      href: entry.href,
      organizationId:
        typeof entry.organizationId === "string"
          ? entry.organizationId
          : undefined,
      spaceId: typeof entry.spaceId === "string" ? entry.spaceId : undefined,
    };
  }

  return null;
}

function entryKey(entry: Pick<RecentEntry, "id" | "type">): string {
  return `${entry.type}:${entry.id}`;
}

export function createRecentStorageKey(scope?: RecentScope): string {
  if (!scope?.organizationId && !scope?.spaceId) {
    return RECENT_STORAGE_KEY;
  }

  return [
    RECENT_STORAGE_KEY,
    scope.organizationId ?? "no-organization",
    scope.spaceId ?? "no-space",
  ].join(":");
}

/**
 * Read the persisted recent list from localStorage.
 * - Filters out malformed entries silently.
 * - Deduplicates by composite `${type}:${id}` keeping the first occurrence
 *   (which represents the most recent access).
 * - Caps at RECENT_MAX.
 */
export function readRecent(scope?: RecentScope): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(createRecentStorageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const out: RecentEntry[] = [];
    for (const item of parsed) {
      const entry = normalizeRecentEntry(item);
      if (!entry) continue;
      const key = entryKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
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
export function writeRecent(
  entry: RecentEntry,
  scope?: RecentScope,
): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const current = readRecent(scope);
    const key = entryKey(entry);
    const normalizedEntry: RecentEntry = {
      id: entry.id,
      type: entry.type,
      displayCode: entry.displayCode,
      title: entry.title,
      href: entry.href,
      organizationId: entry.organizationId,
      spaceId: entry.spaceId,
    };
    const next = [
      normalizedEntry,
      ...current.filter((item) => entryKey(item) !== key),
    ].slice(0, RECENT_MAX);
    window.localStorage.setItem(
      createRecentStorageKey(scope),
      JSON.stringify(next),
    );
    return next;
  } catch {
    return [];
  }
}

export function recordRecentOpen(
  entry: RecentEntry,
  scope?: RecentScope,
): RecentEntry[] {
  const next = writeRecent(entry, scope);

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(RECENT_CHANGED_EVENT, {
        detail: { storageKey: createRecentStorageKey(scope) },
      }),
    );
  }

  return next;
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
  scope?: RecentScope,
): { next: RecentEntry[]; changed: boolean } {
  if (liveKeys === null) return { next: current, changed: false };
  const next = current.filter((item) => liveKeys.has(entryKey(item)));
  const changed = next.length !== current.length;
  if (changed && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        createRecentStorageKey(scope),
        JSON.stringify(next),
      );
    } catch {
      // ignore quota / disabled storage errors
    }
  }
  return { next, changed };
}

export function buildLiveKey(type: RecentEntryType, id: string): string {
  return `${type}:${id}`;
}
