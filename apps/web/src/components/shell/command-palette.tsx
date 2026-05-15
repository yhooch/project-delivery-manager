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
  Plus,
  Settings2,
  ShieldAlert,
  Sun,
  Target,
  Workflow,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { listBugs } from "../../lib/bug-service";
import { formatDisplayCode } from "../../lib/display-code";
import { listIntakeItems } from "../../lib/intake-service";
import { toThemeMode, type NextThemeMode } from "../../lib/preferences";
import { listRequirements } from "../../lib/requirement-service";
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
import { useRouter } from "../../i18n/routing";
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

export function openCommandPalette() {
  openExternal?.(true);
}

export function useCommandPaletteShortcut() {
  const router = useRouter();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isInput =
        tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openExternal?.();
        return;
      }

      if (isInput) return;

      if (event.key.toLowerCase() === "g") {
        const sequenceHandler = (next: KeyboardEvent) => {
          window.removeEventListener("keydown", sequenceHandler);
          // Ignore the chord if the user is typing in a form field by the
          // time the second key fires.
          const nextTarget = next.target as HTMLElement | null;
          const nextTag = nextTarget?.tagName;
          if (
            nextTag === "INPUT" ||
            nextTag === "TEXTAREA" ||
            nextTarget?.isContentEditable
          ) {
            return;
          }
          const routes: Record<string, string> = {
            i: "/",
            v: "/versions",
            r: "/requirements",
            b: "/bugs",
          };
          const route = routes[next.key.toLowerCase()];
          if (route) {
            router.push(route);
          }
        };
        window.addEventListener("keydown", sequenceHandler, { once: true });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);
}

type SearchResult = RecentEntry;

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

export function CommandPalette() {
  const t = useTranslations("shell.command");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [canPruneRecent, setCanPruneRecent] = useState(false);
  const [recent, setRecent] = useState<SearchResult[]>([]);
  const router = useRouter();
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
  const canManageOrganization =
    currentOrganization?.role === "OWNER" ||
    currentOrganization?.role === "ADMIN";
  const effectiveCurrentSpace =
    currentSpace ??
    spacesForCurrentOrganization.find((space) => space.id === spaceId);
  const hasCurrentSpace = Boolean(effectiveCurrentSpace);
  const canCreateWorkItemInCurrentSpace = canWriteWorkItems(
    effectiveCurrentSpace?.role,
    effectiveCurrentSpace?.status,
  );
  const canCreateRequirementInCurrentSpace = canWriteRequirements(
    effectiveCurrentSpace?.role,
    effectiveCurrentSpace?.status,
  );
  const hasCreateCommands =
    canCreateWorkItemInCurrentSpace || canCreateRequirementInCurrentSpace;
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );
  const recentStorageKey = useMemo(
    () => createRecentStorageKey(recentScope),
    [recentScope],
  );

  useEffect(() => {
    openExternal = (next) => setOpen(next ?? true);
    return () => {
      openExternal = null;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
    } else {
      setRecent(readRecent(recentScope).map(withDetailHref));
    }
  }, [open, recentScope]);

  useEffect(() => {
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
  }, [recentScope, recentStorageKey]);

  // Pre-fetch the first page of each entity type when the palette opens.
  // cmdk filters in-memory based on each CommandItem's `value` prop.
  useEffect(() => {
    if (!open || !spaceId || hasFetched) return;

    let cancelled = false;
    setIsLoading(true);

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
  }, [open, spaceId, organizationId, hasFetched, t]);

  // Reset in-memory fetch state if user switches organization / space.
  useEffect(() => {
    setHasFetched(false);
    setCanPruneRecent(false);
    setResults([]);
    setRecent([]);
  }, [organizationId, spaceId]);

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

  const selectTheme = (theme: NextThemeMode) => {
    setOpen(false);
    setTheme(theme);
    if (session) {
      void persistPreferences({ themeMode: toThemeMode(theme) });
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
    if (!open || !hasFetched || !canPruneRecent) return;
    const liveKeys = new Set<string>();
    for (const r of results) liveKeys.add(buildLiveKey(r.type, r.id));
    setRecent((prev) => {
      const { next, changed } = pruneStaleRecent(prev, liveKeys, recentScope);
      return changed ? next : prev;
    });
  }, [canPruneRecent, open, hasFetched, recentScope, results]);

  const showSearchView = query.trim().length >= 2 && spaceId;

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
            {isLoading && results.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t("searching")}</span>
              </div>
            ) : (
              <>
                <CommandEmpty>{t("empty")}</CommandEmpty>
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
              {canManageOrganization && (
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
                  {spacesForCurrentOrganization.map((space) => (
                    <CommandItem
                      key={space.id}
                      onSelect={() => {
                        setOpen(false);
                        void switchSpace(space.id);
                      }}
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
                  {canCreateWorkItemInCurrentSpace && (
                    <>
                      <CommandItem
                        onSelect={() => navigate("/work-items?new=task")}
                      >
                        <Plus className="text-muted-foreground" />
                        <span>{t("createTask")}</span>
                      </CommandItem>
                      <CommandItem onSelect={() => navigate("/bugs?new=bug")}>
                        <Plus className="text-muted-foreground" />
                        <span>{t("createBug")}</span>
                      </CommandItem>
                    </>
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
              <CommandItem
                onSelect={() => {
                  selectTheme("light");
                }}
              >
                <Sun className="text-muted-foreground" />
                <span>{t("themeLight")}</span>
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  selectTheme("dark");
                }}
              >
                <Sun className="text-muted-foreground" />
                <span>{t("themeDark")}</span>
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  selectTheme("system");
                }}
              >
                <Sun className="text-muted-foreground" />
                <span>{t("themeSystem")}</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

function canWriteWorkItems(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(role) && role !== "VIEWER" && status !== "DISABLED";
}

function canWriteRequirements(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return (
    status !== "DISABLED" &&
    (role === "SPACE_ADMIN" || role === "PM" || role === "REQUIREMENT")
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
