"use client";

import {
  AlertTriangle,
  Bug as BugIcon,
  CheckCircle2,
  Cog,
  FileText,
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
import type { TagDto } from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { listBugs } from "../../lib/bug-service";
import { formatDisplayCode } from "../../lib/display-code";
import { isEditableTarget } from "../../lib/hooks/use-list-keyboard-nav";
import { listIntakeItems } from "../../lib/intake-service";
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

type SearchResult = RecentEntry;
type TagSearchResult = TagDto;

const typeIcon: Record<SearchResult["type"], typeof CheckCircle2> = {
  TASK: CheckCircle2,
  BUG: BugIcon,
  REQUIREMENT: FileText,
  INTAKE: Target,
};

const typeIconColor: Record<SearchResult["type"], string> = {
  TASK: "text-primary/80",
  BUG: "text-destructive/80",
  REQUIREMENT: "text-info/80",
  INTAKE: "text-muted-foreground",
};

function getDetailHref(item: Pick<SearchResult, "id" | "href" | "type">) {
  if (item.type === "TASK") {
    return `/work-items?workItemId=${encodeURIComponent(item.id)}`;
  }
  if (item.type === "BUG") {
    return `/bugs?bugId=${encodeURIComponent(item.id)}`;
  }
  if (item.type === "INTAKE") {
    return `/intake-items?id=${encodeURIComponent(item.id)}`;
  }
  return item.href;
}

function withDetailHref(item: SearchResult): SearchResult {
  return { ...item, href: getDetailHref(item) };
}

const PAGE_SIZE = 25;
const TAG_FILTER_TARGET_PATHS = new Set([
  "/requirements",
  "/intake-items",
  "/work-items",
  "/bugs",
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
  const [isLoading, setIsLoading] = useState(false);
  const [isTagLoading, setIsTagLoading] = useState(false);
  const [tagSearchFailed, setTagSearchFailed] = useState(false);
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

  // MVP list APIs do not expose a query/search parameter yet, so fetch a
  // bounded larger page and let cmdk filter the local result set.
  useEffect(() => {
    if (!enabled || !open || !spaceId) return;

    let cancelled = false;
    setIsLoading(true);
    setHasFetched(false);
    setCanPruneRecent(false);
    setResults([]);

    void (async () => {
      try {
        const [tasks, bugs, requirements, intake] = await Promise.allSettled([
          listWorkItems({
            spaceId,
            organizationId,
            page: 1,
            pageSize: PAGE_SIZE,
          }),
          listBugs({
            spaceId,
            organizationId,
            page: 1,
            pageSize: PAGE_SIZE,
          }),
          listRequirements({
            spaceId,
            organizationId,
            page: 1,
            pageSize: PAGE_SIZE,
            includeDrafts: true,
          }),
          listIntakeItems({
            spaceId,
            organizationId,
            page: 1,
            pageSize: PAGE_SIZE,
          }),
        ]);

        if (cancelled) return;

        const merged: SearchResult[] = [];
        let canPrune = true;
        if (tasks.status === "fulfilled") {
          canPrune = canPrune && tasks.value.items.length >= tasks.value.total;
          for (const item of tasks.value.items) {
            merged.push({
              id: item.id,
              type: "TASK",
              code: formatDisplayCode("TASK", item.id),
              title: item.title,
              href: getDetailHref({
                id: item.id,
                type: "TASK",
                href: "/work-items",
              }),
            });
          }
        } else {
          canPrune = false;
        }
        if (bugs.status === "fulfilled") {
          canPrune = canPrune && bugs.value.items.length >= bugs.value.total;
          for (const item of bugs.value.items) {
            // Per design: bugId === workItemId
            merged.push({
              id: item.id,
              type: "BUG",
              code: formatDisplayCode("BUG", item.id),
              title: item.title,
              href: getDetailHref({ id: item.id, type: "BUG", href: "/bugs" }),
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
            merged.push({
              id: item.id,
              type: "REQUIREMENT",
              code: formatDisplayCode("REQ", item.id),
              title: item.title || t("untitled"),
              href: `/requirements/${item.id}`,
            });
          }
        } else {
          canPrune = false;
        }
        if (intake.status === "fulfilled") {
          canPrune =
            canPrune && intake.value.items.length >= intake.value.total;
          for (const item of intake.value.items) {
            merged.push({
              id: item.id,
              type: "INTAKE",
              code: formatDisplayCode("INK", item.id),
              title: item.title,
              href: getDetailHref({
                id: item.id,
                type: "INTAKE",
                href: "/intake-items",
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
  }, [enabled, open, spaceId, organizationId, t]);

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

  // Reset in-memory fetch state if user switches organization / space.
  useEffect(() => {
    setHasFetched(false);
    setCanPruneRecent(false);
    setResults([]);
    setRecent([]);
  }, [enabled, organizationId, spaceId]);

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const navigateAndRemember = (item: SearchResult) => {
    const itemWithDetailHref = withDetailHref(item);
    const next = writeRecent(itemWithDetailHref, recentScope);
    setRecent(next);
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

  const grouped = useMemo(() => {
    const out: Record<SearchResult["type"], SearchResult[]> = {
      TASK: [],
      BUG: [],
      REQUIREMENT: [],
      INTAKE: [],
    };
    for (const r of results) out[r.type].push(r);
    return out;
  }, [results]);

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

  const showSearchView = Boolean(
    (trimmedQuery.length >= 2 && spaceId) || canSearchTags,
  );
  const showTagResults = canSearchTags && tagResults.length > 0;
  const isSearchLoading =
    isLoading || (canSearchTags && isTagLoading && tagResults.length === 0);

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
            value={`${item.code} ${item.title}`}
            onSelect={() => onSelect(item)}
          >
            <Icon className={typeIconColor[item.type]} />
            <span className="font-mono text-[10px] text-muted-foreground">
              {item.code}
            </span>
            <span className="truncate">{item.title}</span>
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

function buildTagFilterHref(tagId: string, pathname: string) {
  const targetPath = getTagFilterTargetPath(pathname);
  const queryString = buildTagFilterQueryString({
    tagIds: [tagId],
    tagMatch: "ANY",
  });

  return queryString ? `${targetPath}?${queryString}` : targetPath;
}

function getTagFilterTargetPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/u, "") || "/";
  const withoutLocale =
    normalized.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/)/u, "") || "/";

  if (TAG_FILTER_TARGET_PATHS.has(normalized)) {
    return normalized;
  }

  if (TAG_FILTER_TARGET_PATHS.has(withoutLocale)) {
    return withoutLocale;
  }

  return "/work-items";
}
