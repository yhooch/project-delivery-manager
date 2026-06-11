"use client";

import {
  AlertTriangle,
  Bug as BugIcon,
  CheckCircle2,
  Cog,
  FileText,
  Files,
  FolderKanban,
  GitBranch,
  Inbox,
  LayoutDashboard,
  Loader2,
  Monitor,
  Moon,
  Plus,
  Settings2,
  ShieldAlert,
  Sun,
  Tag as TagIcon,
  Target,
  Workflow,
} from "lucide-react";
import type { ObjectCodeLookupResult, TagDto } from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { ApiClientError } from "../../lib/api-client";
import { listBugs } from "../../lib/bug-service";
import { listDocuments } from "../../lib/document-service";
import {
  isObjectDisplayCodeLike,
  normalizeObjectDisplayCodeQuery,
  resolveIntakeDisplayCode,
  resolveRequirementDisplayCode,
  resolveWorkItemDisplayCode,
} from "../../lib/display-code";
import { isEditableTarget } from "../../lib/hooks/use-list-keyboard-nav";
import { listIntakeItems } from "../../lib/intake-service";
import { lookupObjectCode } from "../../lib/object-code-service";
import {
  canCreateBugs,
  canCreateTasks,
  canWriteRequirements,
} from "../../lib/permission-gates";
import { toThemeMode, type NextThemeMode } from "../../lib/preferences";
import { listRequirements } from "../../lib/requirement-service";
import { canManageOrganization } from "../../lib/space-service";
import { buildTagFilterQueryString } from "../../lib/tag-query";
import { listTags } from "../../lib/tag-service";
import { listWorkItems } from "../../lib/work-item-service";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command";
import { useSession } from "../providers/session-provider";
import { useTheme } from "../providers/theme-provider";
import { usePathname, useRouter } from "../../i18n/routing";
import { TagBadge, formatTagDisplayName, normalizeTagInput } from "../tag";
import {
  buildLiveKey,
  createRecentStorageKey,
  pruneStaleRecent,
  readRecent,
  RECENT_CHANGED_EVENT,
  writeRecent,
  type RecentEntry,
} from "./recent-opens";

let openExternal: ((open?: boolean) => void) | null = null;
const GO_CHORD_TIMEOUT_MS = 800;
const THEME_COMMANDS = [
  { icon: Sun, labelKey: "themeLight", mode: "light" },
  { icon: Moon, labelKey: "themeDark", mode: "dark" },
  { icon: Monitor, labelKey: "themeSystem", mode: "system" },
] satisfies {
  icon: typeof Sun;
  labelKey: "themeLight" | "themeDark" | "themeSystem";
  mode: NextThemeMode;
}[];

export function openCommandPalette() {
  openExternal?.(true);
}

type CommandPaletteShortcutOptions = {
  enabled?: boolean;
};

export function useCommandPaletteShortcut({
  enabled = true,
}: CommandPaletteShortcutOptions = {}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let sequenceHandler: ((next: KeyboardEvent) => void) | null = null;
    let sequenceTimeout: number | null = null;

    const clearSequence = () => {
      if (sequenceHandler) {
        window.removeEventListener("keydown", sequenceHandler);
        sequenceHandler = null;
      }
      if (sequenceTimeout) {
        window.clearTimeout(sequenceTimeout);
        sequenceTimeout = null;
      }
      window.removeEventListener("blur", clearSequence);
    };

    const startGoSequence = () => {
      clearSequence();

      sequenceHandler = (next: KeyboardEvent) => {
        if (next.key === "Escape") {
          next.preventDefault();
          clearSequence();
          return;
        }

        if (isEditableTarget(next.target)) {
          clearSequence();
          return;
        }

        const routes: Record<string, string> = {
          i: "/",
          v: "/versions",
          r: "/requirements",
          b: "/bugs",
        };
        const route = routes[next.key.toLowerCase()];
        clearSequence();
        if (route) {
          next.preventDefault();
          router.push(route);
        }
      };

      window.addEventListener("keydown", sequenceHandler);
      window.addEventListener("blur", clearSequence, { once: true });
      sequenceTimeout = window.setTimeout(clearSequence, GO_CHORD_TIMEOUT_MS);
    };

    const handler = (event: KeyboardEvent) => {
      const isInput = isEditableTarget(event.target);

      if (isInput) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openExternal?.();
        return;
      }

      if (event.key.toLowerCase() === "g") {
        event.preventDefault();
        startGoSequence();
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      clearSequence();
      window.removeEventListener("keydown", handler);
    };
  }, [enabled, router]);
}

type SearchResult = RecentEntry & {
  organizationId?: string;
  spaceLabel?: string;
};
type TagSearchResult = TagDto;

const typeIcon: Record<SearchResult["type"], typeof CheckCircle2> = {
  TASK: CheckCircle2,
  BUG: BugIcon,
  REQUIREMENT: FileText,
  INTAKE: Target,
  DOCUMENT: Files,
};

const typeIconColor: Record<SearchResult["type"], string> = {
  TASK: "text-primary/80",
  BUG: "text-destructive/80",
  REQUIREMENT: "text-info/80",
  INTAKE: "text-muted-foreground",
  DOCUMENT: "text-primary/80",
};

function getDetailHref(
  item: Pick<SearchResult, "id" | "href" | "spaceId" | "type">,
) {
  if (item.type === "TASK") {
    return withQuery("/work-items", {
      workItemId: item.id,
      spaceId: item.spaceId,
    });
  }
  if (item.type === "BUG") {
    return withQuery("/bugs", {
      bugId: item.id,
      spaceId: item.spaceId,
    });
  }
  if (item.type === "INTAKE") {
    return withQuery("/intake-items", {
      id: item.id,
      spaceId: item.spaceId,
    });
  }
  if (item.type === "DOCUMENT") {
    return withQuery(`/documents/${encodeURIComponent(item.id)}`, {
      spaceId: item.spaceId,
    });
  }
  return withQuery(item.href, { spaceId: item.spaceId });
}

function withDetailHref(item: SearchResult): SearchResult {
  return { ...item, href: getDetailHref(item) };
}

function withQuery(
  href: string,
  params: Record<string, string | undefined>,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  if (!queryString) {
    return href;
  }

  return `${href}${href.includes("?") ? "&" : "?"}${queryString}`;
}

const PAGE_SIZE = 25;
const TAG_FILTER_TARGET_PATHS = new Set([
  "/requirements",
  "/intake-items",
  "/work-items",
  "/bugs",
  "/documents",
]);

type CommandPaletteProps = {
  enabled?: boolean;
};

export function CommandPalette({ enabled = true }: CommandPaletteProps) {
  const t = useTranslations("shell.command");
  const tTags = useTranslations("tags.commandPalette");
  const tRoot = useTranslations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [tagResults, setTagResults] = useState<TagSearchResult[]>([]);
  const [lookupResult, setLookupResult] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTagLoading, setIsTagLoading] = useState(false);
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [tagSearchFailed, setTagSearchFailed] = useState(false);
  const [lookupErrorKey, setLookupErrorKey] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [canPruneRecent, setCanPruneRecent] = useState(false);
  const [recent, setRecent] = useState<SearchResult[]>([]);
  const [switchSpaceErrorKey, setSwitchSpaceErrorKey] = useState<string | null>(
    null,
  );
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const {
    currentOrganization,
    currentSpace,
    persistPreferences,
    session,
    spacesForCurrentOrganization,
    switchSpace,
  } = useSession();

  const spaceId = session?.defaultSpaceId;
  const organizationId = session?.defaultOrganizationId;
  const hasCurrentOrganization = Boolean(currentOrganization);
  const canManageCurrentOrganization = canManageOrganization(
    currentOrganization?.role,
  );
  const effectiveCurrentSpace =
    currentSpace ??
    spacesForCurrentOrganization.find((space) => space.id === spaceId);
  const effectiveSpaceId = effectiveCurrentSpace?.id ?? spaceId;
  const hasCurrentSpace = Boolean(effectiveCurrentSpace);
  const canCreateTaskInCurrentSpace = canCreateTasks(
    effectiveCurrentSpace?.role,
    effectiveCurrentSpace?.status,
  );
  const canCreateBugInCurrentSpace = canCreateBugs(
    effectiveCurrentSpace?.role,
    effectiveCurrentSpace?.status,
  );
  const canCreateRequirementInCurrentSpace = canWriteRequirements(
    effectiveCurrentSpace?.role,
    effectiveCurrentSpace?.status,
  );
  const hasCreateCommands =
    canCreateTaskInCurrentSpace ||
    canCreateBugInCurrentSpace ||
    canCreateRequirementInCurrentSpace;
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );
  const recentStorageKey = useMemo(
    () => createRecentStorageKey(recentScope),
    [recentScope],
  );
  const trimmedQuery = query.trim();
  const isTagQuery = trimmedQuery.startsWith("#");
  const normalizedObjectCodeQuery = isTagQuery
    ? null
    : normalizeObjectDisplayCodeQuery(trimmedQuery);
  const isObjectCodeLikeQuery =
    !isTagQuery && isObjectDisplayCodeLike(trimmedQuery);
  const lookupSpaceId = shouldUseSpaceScopedObjectLookup(pathname)
    ? effectiveSpaceId
    : undefined;
  const listSearchQuery =
    !isTagQuery && !normalizedObjectCodeQuery && trimmedQuery.length >= 2
      ? trimmedQuery
      : undefined;
  const tagSearchTerm = normalizeTagInput(query);
  const canSearchTags = Boolean(
    enabled && open && hasCurrentSpace && effectiveSpaceId && isTagQuery,
  );

  useEffect(() => {
    if (!enabled) {
      openExternal = null;
      setOpen(false);
      return;
    }

    openExternal = (next) => setOpen(next ?? true);
    return () => {
      openExternal = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setQuery("");
      setRecent([]);
      return;
    }

    if (!open) {
      setQuery("");
      setLookupResult(null);
      setLookupErrorKey(null);
      setIsLookupLoading(false);
    } else {
      setSwitchSpaceErrorKey(null);
      setRecent(readRecent(recentScope).map(withDetailHref));
    }
  }, [enabled, open, recentScope]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onRecentChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ storageKey?: string }>).detail;
      if (detail?.storageKey && detail.storageKey !== recentStorageKey) {
        return;
      }

      setRecent(readRecent(recentScope).map(withDetailHref));
    };

    window.addEventListener(RECENT_CHANGED_EVENT, onRecentChanged);

    return () => {
      window.removeEventListener(RECENT_CHANGED_EVENT, onRecentChanged);
    };
  }, [enabled, recentScope, recentStorageKey]);

  // Fetch a bounded page for default/local fuzzy matching; when the user types
  // a normal keyword, pass it through to the list APIs as a server-side query.
  useEffect(() => {
    if (!enabled || !open || !spaceId) return;

    let cancelled = false;
    setIsLoading(true);
    setHasFetched(false);
    setCanPruneRecent(false);
    setResults([]);

    void (async () => {
      try {
        const [tasks, bugs, requirements, intake, documents] =
          await Promise.allSettled([
            listWorkItems({
              spaceId,
              organizationId,
              page: 1,
              pageSize: PAGE_SIZE,
              ...(listSearchQuery ? { query: listSearchQuery } : {}),
            }),
            listBugs({
              spaceId,
              organizationId,
              page: 1,
              pageSize: PAGE_SIZE,
              ...(listSearchQuery ? { query: listSearchQuery } : {}),
            }),
            listRequirements({
              spaceId,
              organizationId,
              page: 1,
              pageSize: PAGE_SIZE,
              includeDrafts: true,
              ...(listSearchQuery ? { query: listSearchQuery } : {}),
            }),
            listIntakeItems({
              spaceId,
              organizationId,
              page: 1,
              pageSize: PAGE_SIZE,
              ...(listSearchQuery ? { query: listSearchQuery } : {}),
            }),
            listDocuments({
              spaceId,
              organizationId,
              page: 1,
              pageSize: PAGE_SIZE,
              ...(listSearchQuery ? { query: listSearchQuery } : {}),
            }),
          ]);

        if (cancelled) return;

        const merged: SearchResult[] = [];
        let canPrune = !listSearchQuery;
        if (tasks.status === "fulfilled") {
          canPrune = canPrune && tasks.value.items.length >= tasks.value.total;
          for (const item of tasks.value.items) {
            const itemSpaceId = item.spaceId ?? spaceId;
            merged.push({
              id: item.id,
              type: "TASK",
              displayCode: resolveWorkItemDisplayCode({
                ...item,
                type: "TASK",
              }),
              title: item.title,
              organizationId: item.organizationId,
              spaceId: itemSpaceId,
              href: getDetailHref({
                id: item.id,
                type: "TASK",
                href: "/work-items",
                spaceId: itemSpaceId,
              }),
            });
          }
        } else {
          canPrune = false;
        }
        if (bugs.status === "fulfilled") {
          canPrune = canPrune && bugs.value.items.length >= bugs.value.total;
          for (const item of bugs.value.items) {
            const itemSpaceId = item.spaceId ?? spaceId;
            // Per design: bugId === workItemId
            merged.push({
              id: item.id,
              type: "BUG",
              displayCode: resolveWorkItemDisplayCode({
                ...item,
                type: "BUG",
              }),
              title: item.title,
              organizationId: item.organizationId,
              spaceId: itemSpaceId,
              href: getDetailHref({
                id: item.id,
                type: "BUG",
                href: "/bugs",
                spaceId: itemSpaceId,
              }),
            });
          }
        } else {
          canPrune = false;
        }
        if (requirements.status === "fulfilled") {
          canPrune =
            canPrune &&
            requirements.value.items.length >= requirements.value.total;
          for (const item of requirements.value.items) {
            const itemSpaceId = item.spaceId ?? spaceId;
            merged.push({
              id: item.id,
              type: "REQUIREMENT",
              displayCode: resolveRequirementDisplayCode(item, {
                draftLabel: t("draftCode"),
              }),
              title: item.title || t("untitled"),
              organizationId: item.organizationId,
              spaceId: itemSpaceId,
              href: getDetailHref({
                id: item.id,
                type: "REQUIREMENT",
                href: `/requirements/${item.id}`,
                spaceId: itemSpaceId,
              }),
            });
          }
        } else {
          canPrune = false;
        }
        if (intake.status === "fulfilled") {
          canPrune =
            canPrune && intake.value.items.length >= intake.value.total;
          for (const item of intake.value.items) {
            const itemSpaceId = item.spaceId ?? spaceId;
            merged.push({
              id: item.id,
              type: "INTAKE",
              displayCode: resolveIntakeDisplayCode(item),
              title: item.title,
              organizationId: item.organizationId,
              spaceId: itemSpaceId,
              href: getDetailHref({
                id: item.id,
                type: "INTAKE",
                href: "/intake-items",
                spaceId: itemSpaceId,
              }),
            });
          }
        } else {
          canPrune = false;
        }
        if (documents.status === "fulfilled") {
          canPrune =
            canPrune && documents.value.items.length >= documents.value.total;
          for (const item of documents.value.items) {
            const itemSpaceId = item.spaceId ?? spaceId;
            merged.push({
              id: item.id,
              type: "DOCUMENT",
              displayCode: t("documentLabel"),
              title: item.title || t("untitled"),
              organizationId: item.organizationId,
              spaceId: itemSpaceId,
              href: getDetailHref({
                id: item.id,
                type: "DOCUMENT",
                href: `/documents/${item.id}`,
                spaceId: itemSpaceId,
              }),
            });
          }
        } else {
          canPrune = false;
        }

        setResults(merged);
        setCanPruneRecent(canPrune);
        setHasFetched(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, listSearchQuery, open, spaceId, organizationId, t]);

  useEffect(() => {
    if (!canSearchTags || !effectiveSpaceId) {
      setTagResults([]);
      setIsTagLoading(false);
      setTagSearchFailed(false);
      return;
    }

    let cancelled = false;
    setIsTagLoading(true);
    setTagSearchFailed(false);

    void listTags({
      includeUsage: true,
      organizationId,
      page: 1,
      pageSize: PAGE_SIZE,
      query: tagSearchTerm || undefined,
      spaceId: effectiveSpaceId,
    })
      .then((response) => {
        if (!cancelled) {
          setTagResults(response.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTagResults([]);
          setTagSearchFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsTagLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canSearchTags, effectiveSpaceId, organizationId, tagSearchTerm]);

  useEffect(() => {
    if (!enabled || !open || isTagQuery || trimmedQuery.length < 2) {
      setLookupResult(null);
      setLookupErrorKey(null);
      setIsLookupLoading(false);
      return;
    }

    if (!isObjectCodeLikeQuery) {
      setLookupResult(null);
      setLookupErrorKey(null);
      setIsLookupLoading(false);
      return;
    }

    if (!normalizedObjectCodeQuery) {
      setLookupResult(null);
      setLookupErrorKey("lookup.invalid");
      setIsLookupLoading(false);
      return;
    }

    if (!organizationId) {
      setLookupResult(null);
      setLookupErrorKey("lookup.missingOrganization");
      setIsLookupLoading(false);
      return;
    }

    let cancelled = false;
    setIsLookupLoading(true);
    setLookupErrorKey(null);

    void lookupObjectCode({
      code: normalizedObjectCodeQuery,
      organizationId,
      ...(lookupSpaceId ? { spaceId: lookupSpaceId } : {}),
    })
      .then((result) => {
        if (!cancelled) {
          setLookupResult(
            toSearchResultFromObjectCodeLookup(
              result,
              spacesForCurrentOrganization,
              lookupSpaceId,
            ),
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLookupResult(null);
          setLookupErrorKey(getObjectCodeLookupErrorKey(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLookupLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    effectiveSpaceId,
    enabled,
    isObjectCodeLikeQuery,
    isTagQuery,
    lookupSpaceId,
    normalizedObjectCodeQuery,
    open,
    organizationId,
    spacesForCurrentOrganization,
    trimmedQuery.length,
  ]);

  // Reset in-memory fetch state if user switches organization / space.
  useEffect(() => {
    setHasFetched(false);
    setCanPruneRecent(false);
    setResults([]);
    setRecent([]);
    setLookupResult(null);
    setLookupErrorKey(null);
    setIsLookupLoading(false);
  }, [enabled, organizationId, spaceId]);

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const navigateAndRemember = (item: SearchResult) => {
    const itemWithDetailHref = withDetailHref(item);
    const targetRecentScope = {
      organizationId: itemWithDetailHref.organizationId ?? organizationId,
      spaceId: itemWithDetailHref.spaceId ?? spaceId,
    };
    const next = writeRecent(itemWithDetailHref, targetRecentScope);
    if (createRecentStorageKey(targetRecentScope) === recentStorageKey) {
      setRecent(next);
    }
    navigate(itemWithDetailHref.href);
  };

  const navigateToTag = (tag: TagSearchResult) => {
    navigate(buildTagFilterHref(tag.id, pathname));
  };

  const selectTheme = (theme: NextThemeMode) => {
    setOpen(false);
    setTheme(theme);
    if (session) {
      void persistPreferences({ themeMode: toThemeMode(theme) });
    }
  };

  const selectSpace = async (spaceId: string) => {
    setSwitchSpaceErrorKey(null);
    try {
      await switchSpace(spaceId);
      setOpen(false);
    } catch (error) {
      setSwitchSpaceErrorKey(getApiErrorMessageKey(error));
    }
  };

  const searchResults = useMemo(() => {
    if (!lookupResult) {
      return results;
    }

    const lookupKey = buildLiveKey(lookupResult.type, lookupResult.id);
    return [
      lookupResult,
      ...results.filter(
        (item) => buildLiveKey(item.type, item.id) !== lookupKey,
      ),
    ];
  }, [lookupResult, results]);

  const grouped = useMemo(() => {
    const out: Record<SearchResult["type"], SearchResult[]> = {
      TASK: [],
      BUG: [],
      REQUIREMENT: [],
      INTAKE: [],
      DOCUMENT: [],
    };
    for (const r of searchResults) out[r.type].push(r);
    return out;
  }, [searchResults]);

  // Once an entity fetch completes, soft-delete any recent entry whose
  // underlying item is no longer surfaced by its service (e.g. it has been
  // deleted). We only prune when the palette is open AND we have a fresh
  // fetch in hand — otherwise we'd wipe the list every time the cache
  // hasn't loaded yet.
  useEffect(() => {
    if (!enabled || !open || !hasFetched || !canPruneRecent) return;
    const liveKeys = new Set<string>();
    for (const r of results) liveKeys.add(buildLiveKey(r.type, r.id));
    setRecent((prev) => {
      const { next, changed } = pruneStaleRecent(prev, liveKeys, recentScope);
      return changed ? next : prev;
    });
  }, [canPruneRecent, enabled, open, hasFetched, recentScope, results]);

  const showSearchView = isTagQuery
    ? canSearchTags
    : Boolean(trimmedQuery.length >= 2 && (spaceId || organizationId));
  const showTagResults = canSearchTags && tagResults.length > 0;
  const isSearchLoading =
    isLoading ||
    isLookupLoading ||
    (canSearchTags && isTagLoading && tagResults.length === 0);

  if (!enabled) {
    return null;
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        data-testid="command-palette-input"
        placeholder={t("placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {showSearchView ? (
          <>
            {isSearchLoading &&
            results.length === 0 &&
            tagResults.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t("searching")}</span>
              </div>
            ) : (
              <>
                <CommandEmpty>{t("empty")}</CommandEmpty>
                {tagSearchFailed ? (
                  <div
                    role="alert"
                    className="mx-2 mb-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                  >
                    {tTags("error")}
                  </div>
                ) : null}
                {lookupErrorKey ? (
                  <div
                    role="alert"
                    data-testid="command-palette-lookup-error"
                    className="mx-2 mb-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                  >
                    {t(lookupErrorKey)}
                  </div>
                ) : null}
                {showTagResults && (
                  <TagSearchGroup
                    heading={tTags("results")}
                    items={tagResults}
                    onSelect={navigateToTag}
                  />
                )}
                {grouped.TASK.length > 0 && (
                  <SearchGroup
                    testId="command-palette-group-tasks"
                    itemTestIdPrefix="command-palette-item-task"
                    heading={t("results.tasks")}
                    items={grouped.TASK}
                    onSelect={navigateAndRemember}
                  />
                )}
                {grouped.BUG.length > 0 && (
                  <SearchGroup
                    testId="command-palette-group-bugs"
                    itemTestIdPrefix="command-palette-item-bug"
                    heading={t("results.bugs")}
                    items={grouped.BUG}
                    onSelect={navigateAndRemember}
                  />
                )}
                {grouped.REQUIREMENT.length > 0 && (
                  <SearchGroup
                    testId="command-palette-group-requirements"
                    itemTestIdPrefix="command-palette-item-requirement"
                    heading={t("results.requirements")}
                    items={grouped.REQUIREMENT}
                    onSelect={navigateAndRemember}
                  />
                )}
                {grouped.INTAKE.length > 0 && (
                  <SearchGroup
                    testId="command-palette-group-intake"
                    itemTestIdPrefix="command-palette-item-intake"
                    heading={t("results.intake")}
                    items={grouped.INTAKE}
                    onSelect={navigateAndRemember}
                  />
                )}
                {grouped.DOCUMENT.length > 0 && (
                  <SearchGroup
                    testId="command-palette-group-documents"
                    itemTestIdPrefix="command-palette-item-document"
                    heading={t("results.documents")}
                    items={grouped.DOCUMENT}
                    onSelect={navigateAndRemember}
                  />
                )}
                {/* In search view, real results take priority; "recent" sinks
                    to the bottom as a fallback shortcut row. */}
                {recent.length > 0 && (
                  <>
                    <CommandSeparator />
                    <SearchGroup
                      heading={t("recent")}
                      items={recent}
                      onSelect={navigateAndRemember}
                    />
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <CommandEmpty>{t("empty")}</CommandEmpty>

            {/* Default view: recently opened is the most-used action, so it
                sits above navigation / switchSpace / create / preferences. */}
            {recent.length > 0 ? (
              <>
                <SearchGroup
                  heading={t("recent")}
                  items={recent}
                  onSelect={navigateAndRemember}
                />
                <CommandSeparator />
              </>
            ) : null}

            <CommandGroup heading={t("navigation")}>
              <CommandItem onSelect={() => navigate("/")}>
                <Inbox className="text-muted-foreground" />
                <span>{t("nav.workbench")}</span>
                <CommandShortcut>G I</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/overview")}>
                <LayoutDashboard className="text-muted-foreground" />
                <span>{t("nav.overview")}</span>
              </CommandItem>
              <CommandItem
                data-testid="command-palette-nav-spaces"
                onSelect={() => navigate("/spaces")}
              >
                <FolderKanban className="text-muted-foreground" />
                <span>{t("nav.spaces")}</span>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/versions")}>
                <GitBranch className="text-muted-foreground" />
                <span>{t("nav.versions")}</span>
                <CommandShortcut>G V</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/work-items")}>
                <CheckCircle2 className="text-muted-foreground" />
                <span>{t("nav.tasks")}</span>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/bugs")}>
                <ShieldAlert className="text-muted-foreground" />
                <span>{t("nav.bugs")}</span>
                <CommandShortcut>G B</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/exceptions")}>
                <AlertTriangle className="text-muted-foreground" />
                <span>{t("nav.exceptions")}</span>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/requirements")}>
                <FileText className="text-muted-foreground" />
                <span>{t("nav.requirements")}</span>
                <CommandShortcut>G R</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/documents")}>
                <Files className="text-muted-foreground" />
                <span>{t("nav.documents")}</span>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/intake-items")}>
                <Target className="text-muted-foreground" />
                <span>{t("nav.intake")}</span>
              </CommandItem>
              <CommandItem onSelect={() => navigate("/workflow")}>
                <Workflow className="text-muted-foreground" />
                <span>{t("nav.workflow")}</span>
              </CommandItem>
              {hasCurrentSpace && (
                <CommandItem
                  data-testid="command-palette-nav-settings"
                  onSelect={() => navigate("/settings")}
                >
                  <Settings2 className="text-muted-foreground" />
                  <span>{t("nav.spaceSettings")}</span>
                </CommandItem>
              )}
              {hasCurrentOrganization && canManageCurrentOrganization && (
                <CommandItem
                  data-testid="command-palette-nav-organization"
                  onSelect={() => navigate("/organization")}
                >
                  <Cog className="text-muted-foreground" />
                  <span>{t("nav.organization")}</span>
                </CommandItem>
              )}
            </CommandGroup>

            {spacesForCurrentOrganization.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("switchSpace")}>
                  {switchSpaceErrorKey ? (
                    <div
                      role="alert"
                      data-testid="command-palette-switch-space-error"
                      className="mx-2 mb-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                    >
                      {tRoot(switchSpaceErrorKey)}
                    </div>
                  ) : null}
                  {spacesForCurrentOrganization.map((space) => (
                    <CommandItem
                      key={space.id}
                      onSelect={() => void selectSpace(space.id)}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">
                        #
                      </span>
                      <span>{space.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {hasCreateCommands && (
              <>
                <CommandSeparator />
                <CommandGroup
                  heading={t("create")}
                  data-testid="command-palette-create-group"
                >
                  {canCreateTaskInCurrentSpace && (
                    <CommandItem
                      onSelect={() => navigate("/work-items?new=task")}
                    >
                      <Plus className="text-muted-foreground" />
                      <span>{t("createTask")}</span>
                    </CommandItem>
                  )}
                  {canCreateBugInCurrentSpace && (
                    <CommandItem onSelect={() => navigate("/bugs?new=bug")}>
                      <Plus className="text-muted-foreground" />
                      <span>{t("createBug")}</span>
                    </CommandItem>
                  )}
                  {canCreateRequirementInCurrentSpace && (
                    <CommandItem
                      onSelect={() => navigate("/requirements?new=requirement")}
                    >
                      <Plus className="text-muted-foreground" />
                      <span>{t("createRequirement")}</span>
                    </CommandItem>
                  )}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />
            <CommandGroup heading={t("preferences")}>
              {THEME_COMMANDS.map(({ icon: Icon, labelKey, mode }) => (
                <CommandItem key={mode} onSelect={() => selectTheme(mode)}>
                  <Icon className="text-muted-foreground" />
                  <span>{t(labelKey)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function SearchGroup({
  heading,
  items,
  onSelect,
  testId,
  itemTestIdPrefix,
}: {
  heading: string;
  items: SearchResult[];
  onSelect: (item: SearchResult) => void;
  testId?: string;
  itemTestIdPrefix?: string;
}) {
  return (
    <CommandGroup heading={heading} data-testid={testId}>
      {items.map((item) => {
        const Icon = typeIcon[item.type];
        return (
          <CommandItem
            key={item.id}
            data-testid={itemTestIdPrefix ?? "command-palette-item"}
            data-id={item.id}
            data-type={item.type.toLowerCase()}
            value={`${item.displayCode} ${item.title} ${item.spaceLabel ?? ""}`}
            onSelect={() => onSelect(item)}
          >
            <Icon className={typeIconColor[item.type]} />
            <span className="font-mono text-[10px] text-muted-foreground">
              {item.displayCode}
            </span>
            <span className="truncate">{item.title}</span>
            {item.spaceLabel ? (
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {item.spaceLabel}
              </span>
            ) : null}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

function TagSearchGroup({
  heading,
  items,
  onSelect,
}: {
  heading: string;
  items: TagSearchResult[];
  onSelect: (tag: TagSearchResult) => void;
}) {
  const tTags = useTranslations("tags.commandPalette");

  return (
    <CommandGroup heading={heading} data-testid="command-palette-group-tags">
      {items.map((tag) => (
        <CommandItem
          key={tag.id}
          data-testid="command-palette-item-tag"
          data-id={tag.id}
          value={`${formatTagDisplayName(tag)} ${tag.name} ${tag.normalizedName}`}
          onSelect={() => onSelect(tag)}
        >
          <TagIcon className="text-muted-foreground" />
          <TagBadge tag={tag} className="max-w-[180px]" />
          {typeof tag.usageCount === "number" ? (
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {tTags("usage", { count: tag.usageCount })}
            </span>
          ) : null}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function toSearchResultFromObjectCodeLookup(
  result: ObjectCodeLookupResult,
  spaces: Array<{ code?: string; id: string; name: string }>,
  currentSpaceId: string | undefined,
): SearchResult {
  const type = resolveLookupResultType(result);
  const space = spaces.find((item) => item.id === result.spaceId);
  const showSpace = !currentSpaceId || currentSpaceId !== result.spaceId;
  const spaceLabel = showSpace
    ? space?.code
      ? `${space.name} · ${space.code}`
      : space?.name
    : undefined;

  return {
    id: result.id,
    type,
    displayCode: result.displayCode,
    title: result.title,
    href: getDetailHref({
      id: result.id,
      type,
      href: type === "REQUIREMENT" ? `/requirements/${result.id}` : "/",
      spaceId: result.spaceId,
    }),
    organizationId: result.organizationId,
    spaceId: result.spaceId,
    spaceLabel,
  };
}

function resolveLookupResultType(
  result: ObjectCodeLookupResult,
): SearchResult["type"] {
  if (result.type === "REQUIREMENT") {
    return "REQUIREMENT";
  }

  if (result.type === "INTAKE_ITEM") {
    return "INTAKE";
  }

  return result.workItemType === "BUG" ? "BUG" : "TASK";
}

function getObjectCodeLookupErrorKey(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.error.code === "OBJECT_CODE_INVALID") {
      return "lookup.invalid";
    }
    if (error.error.code === "OBJECT_CODE_NOT_FOUND") {
      return "lookup.notFound";
    }
    if (error.error.code === "OBJECT_CODE_AMBIGUOUS") {
      return "lookup.ambiguous";
    }
    if (error.error.code === "SPACE_CONTEXT_REQUIRED") {
      return "lookup.spaceContextRequired";
    }
  }

  return "lookup.failed";
}

function buildTagFilterHref(tagId: string, pathname: string) {
  const targetPath = getTagFilterTargetPath(pathname);
  const queryString = buildTagFilterQueryString({
    tagIds: [tagId],
    tagMatch: "ANY",
  });

  return queryString ? `${targetPath}?${queryString}` : targetPath;
}

function getTagFilterTargetPath(pathname: string) {
  const normalized = normalizeAppPathname(pathname);
  const withoutLocale = normalized;

  if (TAG_FILTER_TARGET_PATHS.has(normalized)) {
    return normalized;
  }

  if (TAG_FILTER_TARGET_PATHS.has(withoutLocale)) {
    return withoutLocale;
  }

  return "/work-items";
}

function shouldUseSpaceScopedObjectLookup(pathname: string): boolean {
  const normalized = normalizeAppPathname(pathname);
  const spaceScopedPrefixes = [
    "/bugs",
    "/exceptions",
    "/intake-items",
    "/requirements",
    "/documents",
    "/settings",
    "/versions",
    "/work-items",
    "/workflow",
  ];

  return spaceScopedPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function normalizeAppPathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/u, "") || "/";

  return normalized.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/)/u, "") || "/";
}
