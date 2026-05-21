"use client";

import type {
  GetMyWorkbenchViewResponse,
  SpaceMemberWithUser,
  StatusCategory,
  Version,
  ViewExceptionType,
  ViewWorkItemSummary,
  WorkItemType,
} from "@project-delivery/shared";
import {
  ArrowUpRight,
  Bug,
  CheckCircle2,
  Filter,
  GitBranch,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  useFocusReturn,
  useListKeyboardNav,
} from "../../lib/hooks/use-list-keyboard-nav";
import {
  resolveRefreshMode,
  shouldClearDataForRefresh,
  shouldShowBlockingRefreshState,
  shouldSurfaceRefreshError,
  useRealtimeInvalidation,
  type RefreshModeOptions,
} from "../../lib/realtime";
import { getTimelineEventHref } from "../../lib/timeline-links";
import { cn } from "../../lib/utils";
import { translateWorkflowActionName } from "../../lib/workflow-display";
import {
  getMembers,
  getVersions,
  useSpaceMembers,
  useVersions,
} from "../../lib/v2/lookups";
import {
  M4_EXCEPTION_TYPE_OPTIONS,
  M4_STATUS_CATEGORY_OPTIONS,
  M4_WORK_ITEM_TYPE_OPTIONS,
} from "../../lib/view-forms";
import {
  createWorkItemViewModelMapper,
  type WorkItemViewModel,
  type WorkItemViewModelLookupHelpers,
} from "../../lib/v2/work-item-view-model";
import { getMyWorkbenchView } from "../../lib/view-service";
import { Link } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SelectMenu } from "../ui/select-menu";
import { getStatusCategoryDotClass } from "../ui/status-badge";
import { Tip } from "../ui/tooltip";
import { TimelineEventItem } from "../timeline/timeline-event-item";

import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";

type WorkbenchItemViewModel = WorkItemViewModel & {
  listKey?: string;
  organizationId?: string;
  preferredActionId?: string;
  spaceLabel?: string;
  spaceId?: string;
};

type WorkbenchFilterState = {
  assigneeId?: string;
  exceptionType?: ViewExceptionType;
  statusCategory?: StatusCategory;
  versionId?: string;
  workItemType?: WorkItemType;
};

const WORKBENCH_REALTIME_KEYS = ["workbench"] as const;

export function MyWorkbench() {
  const t = useTranslations("workbench");
  const tTimelineEvent = useTranslations("common.timeline.event");
  const tRoot = useTranslations();
  const locale = useLocale();
  const {
    session,
    currentOrganization,
    spacesForCurrentOrganization = [],
  } = useSession();
  const [view, setView] = useState<GetMyWorkbenchViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [activeItemContext, setActiveItemContext] = useState<{
    organizationId?: string;
    spaceId?: string;
  } | null>(null);
  const [activeWorkbenchItemKey, setActiveWorkbenchItemKey] = useState<
    string | undefined
  >(undefined);
  const [activeWorkbenchContextKey, setActiveWorkbenchContextKey] = useState<
    string | undefined
  >(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionFocusRequest, setActionFocusRequest] = useState(0);
  const [preferredActionId, setPreferredActionId] = useState<
    string | undefined
  >(undefined);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | undefined>(
    undefined,
  );
  const [filters, setFilters] = useState<WorkbenchFilterState>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const [organizationLookups, setOrganizationLookups] = useState<{
    membersBySpaceId: Map<string, SpaceMemberWithUser[]>;
    versionsBySpaceId: Map<string, Version[]>;
  }>({
    membersBySpaceId: new Map(),
    versionsBySpaceId: new Map(),
  });
  const itemButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const { captureFocus, restoreFocus } = useFocusReturn();

  const organizationId = session?.defaultOrganizationId;
  const workbenchContextKey = `${organizationId ?? ""}:${selectedSpaceId ?? ""}`;
  const selectedSpace = spacesForCurrentOrganization.find(
    (space) => space.id === selectedSpaceId,
  );
  const getOrganizationSpaceLabel = useCallback(
    (itemSpaceId?: string) => {
      if (selectedSpaceId || !itemSpaceId) {
        return undefined;
      }

      return spacesForCurrentOrganization.find(
        (space) => space.id === itemSpaceId,
      )?.name;
    },
    [selectedSpaceId, spacesForCurrentOrganization],
  );
  // Lookups: hooks return empty results gracefully when spaceId is undefined.
  const { getMember, members: selectedSpaceMembers } = useSpaceMembers(
    selectedSpaceId,
    organizationId,
  );
  const { getVersion, versions: selectedSpaceVersions } = useVersions(
    selectedSpaceId,
    organizationId,
  );

  const workItemSummaries = useMemo(
    () => collectWorkbenchWorkItems(view),
    [view],
  );

  useEffect(() => {
    if (!organizationId || selectedSpaceId) {
      setOrganizationLookups({
        membersBySpaceId: new Map(),
        versionsBySpaceId: new Map(),
      });
      return;
    }

    if (workItemSummaries.length === 0) {
      return;
    }

    const spaceIds = Array.from(
      new Set(workItemSummaries.map((item) => item.spaceId)),
    );
    let active = true;

    void Promise.all(
      spaceIds.map(async (spaceId) => {
        const [members, versions] = await Promise.all([
          getMembers(spaceId, organizationId),
          getVersions(spaceId, organizationId),
        ]);
        return { members, spaceId, versions };
      }),
    )
      .then((entries) => {
        if (!active) {
          return;
        }

        setOrganizationLookups({
          membersBySpaceId: new Map(
            entries.map((entry) => [entry.spaceId, entry.members]),
          ),
          versionsBySpaceId: new Map(
            entries.map((entry) => [entry.spaceId, entry.versions]),
          ),
        });
      })
      .catch(() => {
        if (active) {
          setOrganizationLookups({
            membersBySpaceId: new Map(),
            versionsBySpaceId: new Map(),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [organizationId, selectedSpaceId, workItemSummaries]);

  const lookupHelpers = useMemo<WorkbenchLookupHelpers>(
    () => ({
      getMember: (userId, itemSpaceId) => {
        if (selectedSpaceId) {
          return getMember(userId);
        }

        const spaceMembers = itemSpaceId
          ? organizationLookups.membersBySpaceId.get(itemSpaceId)
          : undefined;
        return spaceMembers?.find((member) => member.userId === userId);
      },
      getVersion: (versionId, itemSpaceId) => {
        if (selectedSpaceId) {
          return getVersion(versionId);
        }

        const spaceVersions = itemSpaceId
          ? organizationLookups.versionsBySpaceId.get(itemSpaceId)
          : undefined;
        return spaceVersions?.find((version) => version.id === versionId);
      },
    }),
    [getMember, getVersion, organizationLookups, selectedSpaceId],
  );

  useEffect(() => {
    setSelectedSpaceId(undefined);
    setFilters((current) => (Object.keys(current).length > 0 ? {} : current));
    setFilterOpen(false);
  }, [organizationId]);

  useEffect(() => {
    if (!filterOpen) {
      return;
    }

    function handlePointerOutside(event: MouseEvent | TouchEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        filterPopoverRef.current?.contains(target)
      ) {
        return;
      }

      setFilterOpen(false);
    }

    document.addEventListener("mousedown", handlePointerOutside);
    document.addEventListener("touchstart", handlePointerOutside);

    return () => {
      document.removeEventListener("mousedown", handlePointerOutside);
      document.removeEventListener("touchstart", handlePointerOutside);
    };
  }, [filterOpen]);

  useEffect(() => {
    setSheetOpen(false);
    setActiveItem(null);
    setActiveItemContext(null);
    setActiveWorkbenchItemKey(undefined);
    setActiveWorkbenchContextKey(undefined);
    setActionFocusRequest(0);
    setPreferredActionId(undefined);
  }, [organizationId, selectedSpaceId]);

  const availableMembers = useMemo(() => {
    if (selectedSpaceId) {
      return selectedSpaceMembers;
    }

    return uniqueMembers(
      Array.from(organizationLookups.membersBySpaceId.values()).flat(),
    );
  }, [
    organizationLookups.membersBySpaceId,
    selectedSpaceId,
    selectedSpaceMembers,
  ]);

  const availableVersions = useMemo(() => {
    if (selectedSpaceId) {
      return selectedSpaceVersions;
    }

    return uniqueVersions(
      Array.from(organizationLookups.versionsBySpaceId.values()).flat(),
    );
  }, [
    organizationLookups.versionsBySpaceId,
    selectedSpaceId,
    selectedSpaceVersions,
  ]);

  const setFilterValue = useCallback(
    <K extends keyof WorkbenchFilterState>(
      key: K,
      value: WorkbenchFilterState[K] | "",
    ) => {
      setFilters((current) => {
        const next = { ...current };

        if (value) {
          next[key] = value as WorkbenchFilterState[K];
        } else {
          delete next[key];
        }

        return next;
      });
    },
    [],
  );

  const handleSpaceChange = useCallback((spaceId: string | undefined) => {
    setSelectedSpaceId(spaceId);
    setFilters((current) => ({
      exceptionType: current.exceptionType,
      statusCategory: current.statusCategory,
      workItemType: current.workItemType,
    }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  const fetchView = useCallback(async (options?: RefreshModeOptions) => {
    const mode = resolveRefreshMode(options);
    if (!organizationId) {
      requestSeq.current += 1;
      setView(null);
      setIsLoading(false);
      setErrorKey(null);
      return;
    }

    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    if (shouldClearDataForRefresh(mode)) {
      setView(null);
    }
    if (shouldShowBlockingRefreshState(mode)) {
      setIsLoading(true);
    }
    if (shouldSurfaceRefreshError(mode)) {
      setErrorKey(null);
    }

    try {
      const next = await getMyWorkbenchView({
        ...filters,
        organizationId,
        spaceId: selectedSpaceId,
      });
      if (requestSeq.current !== requestId) {
        return;
      }
      setView(next);
      setErrorKey(null);
    } catch (error) {
      if (requestSeq.current !== requestId) {
        return;
      }
      if (shouldSurfaceRefreshError(mode)) {
        setErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (requestSeq.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [filters, organizationId, selectedSpaceId]);

  useEffect(() => {
    void fetchView({ mode: "initial" });

    return () => {
      requestSeq.current += 1;
    };
  }, [fetchView]);

  useRealtimeInvalidation(WORKBENCH_REALTIME_KEYS, () => {
    void fetchView({ mode: "realtime" });
  });

  const registerWorkbenchItemButton = useCallback(
    (key: string, node: HTMLButtonElement | null) => {
      if (node) {
        itemButtonRefs.current.set(key, node);
      } else {
        itemButtonRefs.current.delete(key);
      }
    },
    [],
  );

  const focusWorkbenchItem = useCallback((key: string) => {
    const schedule =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame
        : (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 0);

    schedule(() => {
      itemButtonRefs.current.get(key)?.focus({ preventScroll: true });
    });
  }, []);

  const setActiveWorkbenchItem = useCallback((item: WorkbenchItemViewModel) => {
    setActiveWorkbenchItemKey(getWorkbenchItemKey(item));
  }, []);

  const selectWorkbenchItem = useCallback(
    (item: WorkbenchItemViewModel) => {
      const key = getWorkbenchItemKey(item);
      setActiveWorkbenchItemKey(key);
      focusWorkbenchItem(key);
    },
    [focusWorkbenchItem],
  );

  const openItem = useCallback(
    (
      item: WorkbenchItemViewModel,
      trigger?: HTMLElement | null,
      options: { focusActions?: boolean } = {},
    ) => {
      captureFocus(trigger);
      const itemOrganizationId = item.organizationId ?? organizationId;
      const itemSpaceId = item.spaceId ?? selectedSpaceId;

      recordRecentOpen(
        {
          id: item.id,
          type: item.type,
          displayCode: item.code,
          title: item.title,
          href:
            item.type === "BUG"
              ? `/bugs?bugId=${encodeURIComponent(item.id)}`
              : `/work-items?workItemId=${encodeURIComponent(item.id)}`,
          organizationId: itemOrganizationId,
          spaceId: itemSpaceId,
        },
        { organizationId: itemOrganizationId, spaceId: itemSpaceId },
      );
      setActiveWorkbenchItemKey(getWorkbenchItemKey(item));
      setActiveWorkbenchContextKey(workbenchContextKey);
      setActiveItem(item);
      setActiveItemContext({
        organizationId: itemOrganizationId,
        spaceId: itemSpaceId,
      });
      setActionFocusRequest((current) =>
        options.focusActions ? current + 1 : 0,
      );
      setPreferredActionId(
        options.focusActions ? item.preferredActionId : undefined,
      );
      setSheetOpen(true);
    },
    [captureFocus, organizationId, selectedSpaceId, workbenchContextKey],
  );

  const closeDetailSheet = useCallback(() => {
    setSheetOpen(false);
    setActionFocusRequest(0);
    setPreferredActionId(undefined);
    restoreFocus();
  }, [restoreFocus]);

  const handleDetailSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      setSheetOpen(nextOpen);
      if (!nextOpen) {
        setActionFocusRequest(0);
        setPreferredActionId(undefined);
        restoreFocus();
      }
    },
    [restoreFocus],
  );

  const openItemActionArea = useCallback(
    (item: WorkbenchItemViewModel) => {
      openItem(item, undefined, { focusActions: true });
    },
    [openItem],
  );

  const greetingName = session?.user.name ?? t("title");

  const todoItems = useMemo(
    () =>
      (view?.sections.myTodos.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            t("time.justNow"),
            t("versionFallback"),
            getOrganizationSpaceLabel,
          ),
        )
        .map(withWorkbenchListKey("todo")),
    [getOrganizationSpaceLabel, view, locale, lookupHelpers, t],
  );
  const assignedTaskItems = useMemo(
    () =>
      (view?.sections.assignedTasks.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            t("time.justNow"),
            t("versionFallback"),
            getOrganizationSpaceLabel,
          ),
        )
        .map(withWorkbenchListKey("assigned-task")),
    [getOrganizationSpaceLabel, view, locale, lookupHelpers, t],
  );
  const assignedBugItems = useMemo(
    () =>
      (view?.sections.assignedBugs.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            t("time.justNow"),
            t("versionFallback"),
            getOrganizationSpaceLabel,
          ),
        )
        .map(withWorkbenchListKey("assigned-bug")),
    [getOrganizationSpaceLabel, view, locale, lookupHelpers, t],
  );
  const actionItems = useMemo(() => {
    const toWorkItem = toWorkbenchItem(
      locale,
      lookupHelpers,
      t("time.justNow"),
      t("versionFallback"),
      getOrganizationSpaceLabel,
    );

    return (view?.sections.actionTodos.items.items ?? [])
      .map((todo) => ({
        ...toWorkItem(todo.workItem),
        contextLabel: translateWorkflowActionName(tRoot, todo.availableAction),
        listKey: todo.id,
        preferredActionId: todo.availableAction.id,
      }))
      .map(withWorkbenchListKey("action"));
  }, [getOrganizationSpaceLabel, view, locale, lookupHelpers, t, tRoot]);
  const pendingConfirmItems = useMemo(
    () =>
      (view?.sections.pendingConfirm.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            t("time.justNow"),
            t("versionFallback"),
            getOrganizationSpaceLabel,
          ),
        )
        .map(withWorkbenchListKey("pending-confirm")),
    [getOrganizationSpaceLabel, view, locale, lookupHelpers, t],
  );
  const dueSoonItems = useMemo(
    () =>
      (view?.sections.dueSoon.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            t("time.justNow"),
            t("versionFallback"),
            getOrganizationSpaceLabel,
          ),
        )
        .map(withWorkbenchListKey("due-soon")),
    [getOrganizationSpaceLabel, view, locale, lookupHelpers, t],
  );
  const blockedItems = useMemo(
    () =>
      (view?.sections.blocked?.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            t("time.justNow"),
            t("versionFallback"),
            getOrganizationSpaceLabel,
          ),
        )
        .map(withWorkbenchListKey("blocked")),
    [getOrganizationSpaceLabel, view, locale, lookupHelpers, t],
  );
  const recentEvents = view?.sections.recentActivities.items.items ?? [];

  const keyboardItems = useMemo(
    () => [
      ...todoItems,
      ...assignedTaskItems,
      ...assignedBugItems,
      ...actionItems,
      ...pendingConfirmItems,
      ...dueSoonItems,
      ...blockedItems,
    ],
    [
      actionItems,
      assignedBugItems,
      assignedTaskItems,
      blockedItems,
      dueSoonItems,
      pendingConfirmItems,
      todoItems,
    ],
  );

  useEffect(() => {
    if (
      activeWorkbenchItemKey &&
      !keyboardItems.some(
        (item) => getWorkbenchItemKey(item) === activeWorkbenchItemKey,
      )
    ) {
      setActiveWorkbenchItemKey(undefined);
    }
  }, [activeWorkbenchItemKey, keyboardItems]);

  useListKeyboardNav<WorkbenchItemViewModel>({
    items: keyboardItems,
    activeId: activeWorkbenchItemKey,
    getId: getWorkbenchItemKey,
    onSelect: selectWorkbenchItem,
    onOpen: openItem,
    onEdit: openItem,
    onSubmit: openItemActionArea,
    onClose: sheetOpen ? closeDetailSheet : undefined,
    enabled: Boolean(session && organizationId),
  });

  const stats = view?.stats;
  const todoCount = view?.sections.myTodos.total ?? todoItems.length;
  const pendingConfirmSectionCount =
    view?.sections.pendingConfirm.total ?? pendingConfirmItems.length;
  const dueSoonCount = view?.sections.dueSoon.total ?? dueSoonItems.length;
  const blockedSectionCount =
    view?.sections.blocked?.total ?? blockedItems.length;
  const blockedCount = stats?.blockedCount ?? blockedSectionCount;
  const pendingConfirmCount = stats?.pendingConfirmCount;
  const detailSheetOpen =
    sheetOpen && activeWorkbenchContextKey === workbenchContextKey;
  const detailSheetItem = detailSheetOpen ? activeItem : null;

  if (!session) {
    return (
      <div
        data-testid="workbench-page"
        className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6"
      >
        <EmptyState
          title={t("empty.signIn.title")}
          description={t("empty.signIn.description")}
        />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div
        data-testid="workbench-page"
        className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6"
      >
        <EmptyState
          title={t("empty.noOrganization.title")}
          description={t("empty.noOrganization.description")}
        />
      </div>
    );
  }

  if (errorKey) {
    return (
      <div
        data-testid="workbench-page"
        className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6"
      >
        <ErrorState
          title={t("errorTitle")}
          message={tRoot(errorKey)}
          onRetry={() => void fetchView({ mode: "manual" })}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="workbench-page"
      className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {selectedSpace?.name ??
              currentOrganization?.name ??
              t("filters.allSpaces")}
          </div>
          <h1 className="text-3xl font-light tracking-tight text-foreground">
            {greetingName} <span className="text-muted-foreground mx-1">·</span>{" "}
            {t("title")}
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <WorkbenchSpaceFilter
            spaces={spacesForCurrentOrganization}
            selectedSpaceId={selectedSpaceId}
            onChange={handleSpaceChange}
            tRoot={tRoot}
          />
          <div ref={filterPopoverRef} className="relative">
            <Button
              variant={filterOpen ? "secondary" : "outline"}
              size="sm"
              className="text-xs"
              data-testid="workbench-filter-button"
              aria-controls="workbench-filter-panel"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
              type="button"
            >
              <Filter className="h-3 w-3" />
              {t("filter")}
            </Button>
            {filterOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-[min(calc(100vw-2rem),600px)] overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg animate-in fade-in zoom-in-95 origin-top-right">
                <WorkbenchFilters
                  filters={filters}
                  members={availableMembers}
                  versions={availableVersions}
                  onChange={setFilterValue}
                  onClear={clearFilters}
                  tRoot={tRoot}
                />
              </div>
            )}
          </div>
          <Button asChild variant="ghost" size="sm" className="text-xs">
            <Link href="/work-items?workItemType=TASK">
              {t("viewAll")}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary chips */}
      <div
        data-testid="workbench-summary"
        className="grid grid-cols-2 gap-2 lg:grid-cols-4"
      >
        <SummaryChip
          tone="primary"
          value={todoCount}
          label={t("summary.todo")}
        />
        <SummaryChip
          tone="info"
          value={dueSoonCount}
          label={t("summary.dueSoon")}
        />
        <SummaryChip
          tone="warning"
          value={blockedCount}
          label={t("summary.blocked")}
        />
        <SummaryChip
          tone="success"
          value={pendingConfirmCount}
          label={t("summary.pendingConfirm")}
        />
      </div>

      <div className="h-px w-full bg-border/40 my-1" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px] items-start">
        <div className="grid grid-cols-1 gap-7 xl:grid-cols-2">
          <Section
            title={t("sections.todo")}
            count={todoCount}
            empty={t("empty.todo")}
            isLoading={isLoading && !view}
          >
            <ItemList
              activeItemKey={activeWorkbenchItemKey}
              items={todoItems}
              onFocusItem={setActiveWorkbenchItem}
              onSelect={openItem}
              registerItemButton={registerWorkbenchItemButton}
            />
          </Section>

          <Section
            title={t("sections.assignedTasks")}
            count={
              view?.sections.assignedTasks.total ?? assignedTaskItems.length
            }
            empty={t("empty.assignedTasks")}
            isLoading={isLoading && !view}
          >
            <ItemList
              activeItemKey={activeWorkbenchItemKey}
              items={assignedTaskItems}
              onFocusItem={setActiveWorkbenchItem}
              onSelect={openItem}
              registerItemButton={registerWorkbenchItemButton}
            />
          </Section>

          <Section
            title={t("sections.assignedBugs")}
            count={view?.sections.assignedBugs.total ?? assignedBugItems.length}
            empty={t("empty.assignedBugs")}
            isLoading={isLoading && !view}
          >
            <ItemList
              activeItemKey={activeWorkbenchItemKey}
              items={assignedBugItems}
              onFocusItem={setActiveWorkbenchItem}
              onSelect={openItem}
              registerItemButton={registerWorkbenchItemButton}
            />
          </Section>

          <Section
            title={t("sections.actions")}
            count={view?.sections.actionTodos.total ?? actionItems.length}
            empty={t("empty.actions")}
            isLoading={isLoading && !view}
          >
            <ItemList
              activeItemKey={activeWorkbenchItemKey}
              items={actionItems}
              onFocusItem={setActiveWorkbenchItem}
              onSelect={openItem}
              registerItemButton={registerWorkbenchItemButton}
            />
          </Section>

          <Section
            title={t("sections.pendingConfirm")}
            count={pendingConfirmSectionCount}
            empty={t("empty.pendingConfirm")}
            isLoading={isLoading && !view}
          >
            <ItemList
              activeItemKey={activeWorkbenchItemKey}
              items={pendingConfirmItems}
              onFocusItem={setActiveWorkbenchItem}
              onSelect={openItem}
              registerItemButton={registerWorkbenchItemButton}
            />
          </Section>

          <Section
            title={t("sections.dueSoon")}
            count={dueSoonCount}
            empty={t("empty.dueSoon")}
            isLoading={isLoading && !view}
          >
            <ItemList
              activeItemKey={activeWorkbenchItemKey}
              items={dueSoonItems}
              onFocusItem={setActiveWorkbenchItem}
              onSelect={openItem}
              registerItemButton={registerWorkbenchItemButton}
            />
          </Section>

          <Section
            title={t("sections.blocked")}
            count={blockedSectionCount}
            empty={t("empty.blocked")}
            isLoading={isLoading && !view}
          >
            <ItemList
              activeItemKey={activeWorkbenchItemKey}
              items={blockedItems}
              onFocusItem={setActiveWorkbenchItem}
              onSelect={openItem}
              registerItemButton={registerWorkbenchItemButton}
            />
          </Section>
        </div>

        <aside className="sticky top-6 flex flex-col gap-4 pt-1 lg:pl-6 lg:border-l lg:border-border/40 lg:-ml-6 min-h-[50vh]">
          <div className="flex items-center justify-between pb-2 border-b border-border/40">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("sections.recent")}
            </h3>
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <Link href="/overview" aria-label={t("sections.recent")}>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          {isLoading && !view ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-10 animate-pulse rounded-md bg-muted/40"
                />
              ))}
            </div>
          ) : recentEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("empty.recent")}</p>
          ) : (
            <ul className="relative flex flex-col gap-5 before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-border/50">
              {recentEvents.map((event) => (
                <TimelineEventItem
                  key={event.id}
                  contextLabel={getOrganizationSpaceLabel(event.spaceId)}
                  density="compact"
                  event={event}
                  href={getTimelineEventHref(event)}
                  locale={locale}
                  justNowLabel={t("time.justNow")}
                  timeStyle="relative"
                  translateEventType={tTimelineEvent}
                />
              ))}
            </ul>
          )}
        </aside>
      </div>

      <TaskDetailSheet
        actionFocusRequest={actionFocusRequest}
        item={detailSheetItem}
        open={detailSheetOpen}
        onOpenChange={handleDetailSheetOpenChange}
        preferredActionId={preferredActionId}
        spaceId={activeItemContext?.spaceId ?? selectedSpaceId}
        organizationId={activeItemContext?.organizationId ?? organizationId}
        onChanged={() => {
          void fetchView({ mode: "manual" });
        }}
      />
    </div>
  );
}

function WorkbenchSpaceFilter({
  spaces,
  selectedSpaceId,
  onChange,
  tRoot,
}: {
  spaces: { id: string; name: string }[];
  selectedSpaceId: string | undefined;
  onChange: (spaceId: string | undefined) => void;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const selectedSpace = spaces.find((space) => space.id === selectedSpaceId);

  return (
    <SelectMenu
      value={selectedSpace?.id ?? ""}
      onChange={(event) => onChange(event.target.value || undefined)}
      data-testid="workbench-space-filter"
      triggerTestId="workbench-space-filter-trigger"
      menuAlign="end"
      className="h-8 min-w-[9rem] max-w-[12rem] text-xs"
      contentClassName="w-52"
      aria-label={tRoot("workbench.filters.space")}
    >
      <option value="">{tRoot("workbench.filters.allSpaces")}</option>
      {spaces.map((space) => (
        <option key={space.id} value={space.id}>
          {space.name}
        </option>
      ))}
    </SelectMenu>
  );
}

function WorkbenchFilters({
  filters,
  members,
  versions,
  onChange,
  onClear,
  tRoot,
}: {
  filters: WorkbenchFilterState;
  members: SpaceMemberWithUser[];
  versions: Version[];
  onChange: (key: keyof WorkbenchFilterState, value: string) => void;
  onClear: () => void;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const hasFilters = Object.values(filters).some(Boolean);
  const versionOptions = versions.map((version) => ({
    label: version.name,
    value: version.id,
  }));
  const memberOptions = members.map((member) => ({
    label: member.user.name || member.user.username,
    value: member.userId,
  }));

  return (
    <div
      id="workbench-filter-panel"
      aria-label={tRoot("m4Views.filters.label")}
      className="flex max-h-[min(70vh,540px)] flex-col gap-3 overflow-y-auto rounded-xl bg-muted/30 p-3 animate-in fade-in slide-in-from-top-2"
      data-testid="workbench-filter-panel"
    >
      <WorkbenchFilterGroup
        label={tRoot("m4Views.filters.version")}
        value={filters.versionId ?? ""}
        allLabel={tRoot("m4Views.filters.allVersions")}
        options={versionOptions}
        onSelect={(value) => onChange("versionId", value)}
      />

      <WorkbenchFilterGroup
        label={tRoot("m4Views.filters.assignee")}
        value={filters.assigneeId ?? ""}
        allLabel={tRoot("m4Views.filters.allAssignees")}
        options={memberOptions}
        onSelect={(value) => onChange("assigneeId", value)}
      />

      <WorkbenchFilterGroup
        label={tRoot("m4Views.filters.statusCategory")}
        value={filters.statusCategory ?? ""}
        allLabel={tRoot("m4Views.filters.allStatusCategories")}
        options={M4_STATUS_CATEGORY_OPTIONS.map((option) => ({
          label: tRoot(option.labelKey),
          value: option.value,
        }))}
        onSelect={(value) => onChange("statusCategory", value)}
      />

      <WorkbenchFilterGroup
        label={tRoot("m4Views.filters.workItemType")}
        value={filters.workItemType ?? ""}
        allLabel={tRoot("m4Views.filters.allWorkItemTypes")}
        options={M4_WORK_ITEM_TYPE_OPTIONS.map((option) => ({
          label: tRoot(option.labelKey),
          value: option.value,
        }))}
        onSelect={(value) => onChange("workItemType", value)}
      />

      <WorkbenchFilterGroup
        label={tRoot("m4Views.filters.exceptionType")}
        value={filters.exceptionType ?? ""}
        allLabel={tRoot("m4Views.filters.allExceptionTypes")}
        options={M4_EXCEPTION_TYPE_OPTIONS.map((option) => ({
          label: tRoot(option.labelKey),
          value: option.value,
        }))}
        onSelect={(value) => onChange("exceptionType", value)}
      />

      <div className="flex justify-end border-t border-border/50 pt-2">
        <Button
          className="h-8 text-[12px] rounded-md bg-transparent hover:bg-background shadow-sm border border-border/40 hover:border-border/80 transition-all text-muted-foreground hover:text-foreground"
          disabled={!hasFilters}
          onClick={onClear}
          type="button"
          variant="ghost"
        >
          {tRoot("m4Views.filters.clear")}
        </Button>
      </div>
    </div>
  );
}

function WorkbenchFilterGroup({
  allLabel,
  label,
  onSelect,
  options,
  value,
}: {
  allLabel: string;
  label: string;
  onSelect: (value: string) => void;
  options: { label: string; value: string }[];
  value: string;
}) {
  const groupOptions = [{ label: allLabel, value: "" }, ...options];

  return (
    <section className="min-w-0 space-y-1.5">
      <h4 className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h4>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {groupOptions.map((option) => {
          const selected = value === option.value;

          return (
            <button
              key={option.value || "__all"}
              type="button"
              aria-pressed={selected}
              className={cn(
                "min-h-7 max-w-full rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                selected
                  ? "border-primary/40 bg-primary/10 text-primary shadow-sm"
                  : "border-border/60 bg-background/70 text-muted-foreground hover:border-border hover:bg-background hover:text-foreground",
              )}
              onClick={() => onSelect(option.value)}
            >
              <span className="block truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type SummaryTone = "primary" | "info" | "warning" | "success";

function SummaryChip({
  tone,
  value,
  label,
}: {
  tone: SummaryTone;
  value: number | undefined;
  label: string;
}) {
  return (
    <div className="group flex flex-col gap-0.5 rounded-lg p-2.5 transition-colors hover:bg-muted/30 cursor-default">
      <div className="text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-light tracking-tight transition-colors",
          tone === "primary"
            ? "text-primary group-hover:text-primary/80"
            : tone === "info"
              ? "text-info group-hover:text-info/80"
              : tone === "warning"
                ? "text-warning group-hover:text-warning/80"
                : "text-success group-hover:text-success/80",
        )}
      >
        {typeof value === "number" ? value : "—"}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  isLoading,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <header className="flex items-center justify-between pb-2 border-b border-border/40">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
          <span className="rounded-full bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground border border-border/40">
            {count}
          </span>
        </div>
      </header>
      <div className="mt-1.5">
        {isLoading ? (
          <div className="py-1.5">
            <ListSkeleton rows={3} />
          </div>
        ) : count === 0 ? (
          <div className="py-4 text-xs text-muted-foreground">{empty}</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function ItemList({
  activeItemKey,
  items,
  onFocusItem,
  onSelect,
  registerItemButton,
}: {
  activeItemKey: string | undefined;
  items: WorkbenchItemViewModel[];
  onFocusItem: (item: WorkbenchItemViewModel) => void;
  onSelect: (
    item: WorkbenchItemViewModel,
    trigger?: HTMLElement | null,
  ) => void;
  registerItemButton: (key: string, node: HTMLButtonElement | null) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const itemKey = getWorkbenchItemKey(item);
        const isActive = activeItemKey === itemKey;

        return (
          <li key={itemKey}>
            <button
              ref={(node) => registerItemButton(itemKey, node)}
              type="button"
              data-workbench-item-key={itemKey}
              data-active={isActive ? "true" : undefined}
              onFocus={() => onFocusItem(item)}
              onClick={(event) => onSelect(item, event.currentTarget)}
              className={cn(
                "group flex w-full cursor-pointer items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:bg-muted/30",
                isActive ? "bg-muted/60" : "hover:bg-muted/30",
              )}
            >
              <div className="flex w-4 items-center justify-center shrink-0">
                {item.type === "BUG" ? (
                  <Bug className="h-3.5 w-3.5 text-destructive/80" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary/80" />
                )}
              </div>
              <div className="flex flex-col flex-1 min-w-0 py-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                    {item.title}
                  </span>
                  {item.contextLabel ? (
                    <Badge
                      variant="default"
                      className="hidden sm:inline-flex bg-muted/40 font-normal px-1.5 h-4 text-[9px] shrink-0"
                    >
                      {item.contextLabel}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    {item.code}
                  </span>
                  {item.spaceLabel ? (
                    <>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span className="hidden sm:inline-block truncate text-[10px] text-muted-foreground shrink">
                        {item.spaceLabel}
                      </span>
                    </>
                  ) : null}
                  <span className="w-1 h-1 rounded-full bg-border" />
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1.5 shrink-0">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        getStatusCategoryDotClass(item.statusCategory),
                      )}
                    />
                    {item.statusLabel}
                  </span>
                  {item.versionName && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                        <GitBranch className="h-2.5 w-2.5 opacity-70" />
                        {item.versionName}
                      </span>
                    </>
                  )}
                  {item.dueDate && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span
                        className={cn(
                          "hidden sm:inline-block text-[10px] shrink-0",
                          item.isOverdue
                            ? "text-destructive font-medium"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.dueDate}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center pl-2 shrink-0">
                <Tip content={item.assignee.name || undefined}>
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px] bg-muted/60 text-muted-foreground">
                      {item.assignee.initial}
                    </AvatarFallback>
                  </Avatar>
                </Tip>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export type WorkbenchLookupHelpers = WorkItemViewModelLookupHelpers;

function getWorkbenchItemKey(
  item: Pick<WorkbenchItemViewModel, "id"> & {
    listKey?: string;
  },
) {
  return item.listKey ?? item.id;
}

function withWorkbenchListKey(prefix: string) {
  return (item: WorkbenchItemViewModel): WorkbenchItemViewModel => ({
    ...item,
    listKey: `${prefix}:${item.listKey ?? item.id}`,
  });
}

function toWorkbenchItem(
  locale: string,
  lookups?: WorkbenchLookupHelpers,
  justNowLabel?: string,
  unknownVersionLabel?: string,
  getSpaceLabel?: (spaceId?: string) => string | undefined,
) {
  const toViewModel = createWorkItemViewModelMapper({
    locale,
    lookups,
    justNowLabel,
    unknownVersionLabel,
  });

  return (item: ViewWorkItemSummary): WorkbenchItemViewModel => ({
    ...toViewModel(item),
    organizationId: item.organizationId,
    spaceLabel: getSpaceLabel?.(item.spaceId),
    spaceId: item.spaceId,
  });
}

function collectWorkbenchWorkItems(
  view: GetMyWorkbenchViewResponse | null,
): ViewWorkItemSummary[] {
  if (!view) {
    return [];
  }

  return [
    ...view.sections.myTodos.items.items,
    ...view.sections.assignedTasks.items.items,
    ...view.sections.assignedBugs.items.items,
    ...view.sections.actionTodos.items.items.map((todo) => todo.workItem),
    ...view.sections.pendingConfirm.items.items,
    ...view.sections.dueSoon.items.items,
    ...(view.sections.blocked?.items.items ?? []),
  ];
}

function uniqueMembers(members: SpaceMemberWithUser[]): SpaceMemberWithUser[] {
  const seen = new Set<string>();
  const result: SpaceMemberWithUser[] = [];

  for (const member of members) {
    if (seen.has(member.userId)) {
      continue;
    }

    seen.add(member.userId);
    result.push(member);
  }

  return result;
}

function uniqueVersions(versions: Version[]): Version[] {
  const seen = new Set<string>();
  const result: Version[] = [];

  for (const version of versions) {
    if (seen.has(version.id)) {
      continue;
    }

    seen.add(version.id);
    result.push(version);
  }

  return result;
}
