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
  AlertCircle,
  ArrowUpRight,
  Bug,
  CheckCircle2,
  ChevronDown,
  Clock,
  Filter,
  GitBranch,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  useFocusReturn,
  useListKeyboardNav,
} from "../../lib/hooks/use-list-keyboard-nav";
import { cn } from "../../lib/utils";
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
import { Tip } from "../ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { StatusBadge } from "../ui/status-badge";
import { SelectMenu } from "../ui/select-menu";

import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";

const priorityDotColor: Record<WorkItemViewModel["priority"], string> = {
  LOW: "bg-muted-foreground/40",
  MEDIUM: "bg-info",
  HIGH: "bg-warning",
  URGENT: "bg-destructive",
};

type WorkbenchItemViewModel = WorkItemViewModel & {
  listKey?: string;
  organizationId?: string;
  spaceId?: string;
};

type WorkbenchFilterState = {
  assigneeId?: string;
  exceptionType?: ViewExceptionType;
  statusCategory?: StatusCategory;
  versionId?: string;
  workItemType?: WorkItemType;
};

export function MyWorkbench() {
  const t = useTranslations("workbench");
  const tStatusCategory = useTranslations("workItems.statusCategory");
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
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | undefined>(
    undefined,
  );
  const [filters, setFilters] = useState<WorkbenchFilterState>({});
  const [filterOpen, setFilterOpen] = useState(false);
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
    setSheetOpen(false);
    setActiveItem(null);
    setActiveItemContext(null);
    setActiveWorkbenchItemKey(undefined);
    setActiveWorkbenchContextKey(undefined);
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

  const fetchView = useCallback(async () => {
    if (!organizationId) {
      return;
    }

    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setView(null);
    setIsLoading(true);
    setErrorKey(null);

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
    } catch (error) {
      if (requestSeq.current !== requestId) {
        return;
      }
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (requestSeq.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [filters, organizationId, selectedSpaceId]);

  useEffect(() => {
    if (!organizationId) {
      requestSeq.current += 1;
      setView(null);
      setIsLoading(false);
      return;
    }

    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;

    async function load() {
      setView(null);
      setIsLoading(true);
      setErrorKey(null);

      try {
        const next = await getMyWorkbenchView({
          ...filters,
          organizationId: organizationId!,
          spaceId: selectedSpaceId,
        });

        if (requestSeq.current === requestId) {
          setView(next);
        }
      } catch (error) {
        if (requestSeq.current === requestId) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (requestSeq.current === requestId) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      if (requestSeq.current === requestId) {
        requestSeq.current += 1;
      }
    };
  }, [filters, organizationId, selectedSpaceId]);

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
    (item: WorkbenchItemViewModel, trigger?: HTMLElement | null) => {
      captureFocus(trigger);
      const itemOrganizationId = item.organizationId ?? organizationId;
      const itemSpaceId = item.spaceId ?? selectedSpaceId;

      recordRecentOpen(
        {
          id: item.id,
          type: item.type,
          code: item.code,
          title: item.title,
          href: item.type === "BUG" ? "/bugs" : "/work-items",
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
      setSheetOpen(true);
    },
    [captureFocus, organizationId, selectedSpaceId, workbenchContextKey],
  );

  const closeDetailSheet = useCallback(() => {
    setSheetOpen(false);
    restoreFocus();
  }, [restoreFocus]);

  const handleDetailSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      setSheetOpen(nextOpen);
      if (!nextOpen) {
        restoreFocus();
      }
    },
    [restoreFocus],
  );

  const greetingName = session?.user.name ?? t("title");

  const todoItems = useMemo(
    () =>
      (view?.sections.myTodos.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            tStatusCategory,
            t("time.justNow"),
            t("versionFallback"),
          ),
        )
        .map(withWorkbenchListKey("todo")),
    [view, locale, lookupHelpers, tStatusCategory, t],
  );
  const assignedTaskItems = useMemo(
    () =>
      (view?.sections.assignedTasks.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            tStatusCategory,
            t("time.justNow"),
            t("versionFallback"),
          ),
        )
        .map(withWorkbenchListKey("assigned-task")),
    [view, locale, lookupHelpers, tStatusCategory, t],
  );
  const assignedBugItems = useMemo(
    () =>
      (view?.sections.assignedBugs.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            tStatusCategory,
            t("time.justNow"),
            t("versionFallback"),
          ),
        )
        .map(withWorkbenchListKey("assigned-bug")),
    [view, locale, lookupHelpers, tStatusCategory, t],
  );
  const actionItems = useMemo(() => {
    const toWorkItem = toWorkbenchItem(
      locale,
      lookupHelpers,
      tStatusCategory,
      t("time.justNow"),
      t("versionFallback"),
    );

    return (view?.sections.actionTodos.items.items ?? [])
      .map((todo) => ({
        ...toWorkItem(todo.workItem),
        contextLabel: todo.availableAction.name,
        listKey: todo.id,
      }))
      .map(withWorkbenchListKey("action"));
  }, [view, locale, lookupHelpers, tStatusCategory, t]);
  const pendingConfirmItems = useMemo(
    () =>
      (view?.sections.pendingConfirm.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            tStatusCategory,
            t("time.justNow"),
            t("versionFallback"),
          ),
        )
        .map(withWorkbenchListKey("pending-confirm")),
    [view, locale, lookupHelpers, tStatusCategory, t],
  );
  const dueSoonItems = useMemo(
    () =>
      (view?.sections.dueSoon.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            tStatusCategory,
            t("time.justNow"),
            t("versionFallback"),
          ),
        )
        .map(withWorkbenchListKey("due-soon")),
    [view, locale, lookupHelpers, tStatusCategory, t],
  );
  const blockedItems = useMemo(
    () =>
      (view?.sections.blocked?.items.items ?? [])
        .map(
          toWorkbenchItem(
            locale,
            lookupHelpers,
            tStatusCategory,
            t("time.justNow"),
            t("versionFallback"),
          ),
        )
        .map(withWorkbenchListKey("blocked")),
    [view, locale, lookupHelpers, tStatusCategory, t],
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
  const pendingConfirmCount =
    stats?.pendingConfirmCount ?? pendingConfirmSectionCount;
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
          onRetry={() => void fetchView()}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="workbench-page"
      className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-primary">
            {selectedSpace?.name ??
              currentOrganization?.name ??
              tRoot("dashboard.filters.allSpaces")}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {greetingName} · {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WorkbenchSpaceFilter
            spaces={spacesForCurrentOrganization}
            selectedSpaceId={selectedSpaceId}
            onChange={handleSpaceChange}
            tRoot={tRoot}
          />
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
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <SummaryChip
          icon={Inbox}
          tone="primary"
          value={todoCount}
          label={t("summary.todo")}
        />
        <SummaryChip
          icon={Clock}
          tone="info"
          value={dueSoonCount}
          label={t("summary.dueSoon")}
        />
        <SummaryChip
          icon={AlertCircle}
          tone="warning"
          value={blockedCount}
          label={t("summary.blocked")}
        />
        <SummaryChip
          icon={CheckCircle2}
          tone="success"
          value={pendingConfirmCount}
          label={t("summary.pendingConfirm")}
        />
      </div>

      {filterOpen ? (
        <WorkbenchFilters
          filters={filters}
          members={availableMembers}
          versions={availableVersions}
          onChange={setFilterValue}
          onClear={clearFilters}
          tRoot={tRoot}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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

        <aside className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("sections.recent")}</h3>
            <Button asChild variant="ghost" size="icon-sm">
              <Link href="/overview" aria-label={t("sections.recent")}>
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </Button>
          </div>
          {isLoading && !view ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-10 animate-pulse rounded-md bg-muted/60"
                />
              ))}
            </div>
          ) : recentEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("empty.recent")}</p>
          ) : (
            <ul className="space-y-3">
              {recentEvents.map((event) => (
                <li key={event.id} className="flex gap-2.5">
                  <Tip content={event.actor.name}>
                    <Avatar className="h-6 w-6 cursor-pointer">
                      <AvatarFallback className="text-[10px]">
                        {initialOf(event.actor.name)}
                      </AvatarFallback>
                    </Avatar>
                  </Tip>
                  <div className="flex-1 text-[12px]">
                    <div className="leading-snug">
                      <span className="font-medium">{event.actor.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        {event.title}{" "}
                      </span>
                      {event.target.title && (
                        <span className="font-mono text-[11px]">
                          {event.target.title}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatTimeAgo(
                        event.createdAt,
                        locale,
                        t("time.justNow"),
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <TaskDetailSheet
        item={detailSheetItem}
        open={detailSheetOpen}
        onOpenChange={handleDetailSheetOpenChange}
        spaceId={activeItemContext?.spaceId ?? selectedSpaceId}
        organizationId={activeItemContext?.organizationId ?? organizationId}
        onChanged={() => {
          void fetchView();
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          aria-label={tRoot("dashboard.filters.space")}
          data-testid="workbench-space-filter"
        >
          <span className="max-w-[140px] truncate">
            {selectedSpace?.name ?? tRoot("dashboard.filters.allSpaces")}
          </span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuLabel>
          {tRoot("dashboard.filters.space")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="workbench-space-filter-all"
          onSelect={() => onChange(undefined)}
        >
          {tRoot("dashboard.filters.allSpaces")}
        </DropdownMenuItem>
        {spaces.map((space) => (
          <DropdownMenuItem
            key={space.id}
            data-testid={`workbench-space-filter-${space.id}`}
            onSelect={() => onChange(space.id)}
          >
            {space.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

  return (
    <div
      id="workbench-filter-panel"
      aria-label={tRoot("m4Views.filters.label")}
      className="grid gap-3 rounded-lg border border-border bg-card/40 p-3 md:grid-cols-6"
      data-testid="workbench-filter-panel"
    >
      <WorkbenchSelectFilter
        label={tRoot("m4Views.filters.version")}
        value={filters.versionId ?? ""}
        onChange={(value) => onChange("versionId", value)}
      >
        <option value="">{tRoot("m4Views.filters.allVersions")}</option>
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.name}
          </option>
        ))}
      </WorkbenchSelectFilter>

      <WorkbenchSelectFilter
        label={tRoot("m4Views.filters.assignee")}
        value={filters.assigneeId ?? ""}
        onChange={(value) => onChange("assigneeId", value)}
      >
        <option value="">{tRoot("m4Views.filters.allAssignees")}</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.user.name || member.user.username}
          </option>
        ))}
      </WorkbenchSelectFilter>

      <WorkbenchSelectFilter
        label={tRoot("m4Views.filters.statusCategory")}
        value={filters.statusCategory ?? ""}
        onChange={(value) => onChange("statusCategory", value)}
      >
        <option value="">{tRoot("m4Views.filters.allStatusCategories")}</option>
        {M4_STATUS_CATEGORY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {tRoot(option.labelKey)}
          </option>
        ))}
      </WorkbenchSelectFilter>

      <WorkbenchSelectFilter
        label={tRoot("m4Views.filters.workItemType")}
        value={filters.workItemType ?? ""}
        onChange={(value) => onChange("workItemType", value)}
      >
        <option value="">{tRoot("m4Views.filters.allWorkItemTypes")}</option>
        {M4_WORK_ITEM_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {tRoot(option.labelKey)}
          </option>
        ))}
      </WorkbenchSelectFilter>

      <WorkbenchSelectFilter
        label={tRoot("m4Views.filters.exceptionType")}
        value={filters.exceptionType ?? ""}
        onChange={(value) => onChange("exceptionType", value)}
      >
        <option value="">{tRoot("m4Views.filters.allExceptionTypes")}</option>
        {M4_EXCEPTION_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {tRoot(option.labelKey)}
          </option>
        ))}
      </WorkbenchSelectFilter>

      <div className="flex items-end">
        <Button
          className="h-8 w-full text-xs"
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

function WorkbenchSelectFilter({
  children,
  label,
  onChange,
  value,
}: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-muted-foreground">
      <span className="truncate">{label}</span>
      <SelectMenu
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </SelectMenu>
    </label>
  );
}

type SummaryTone = "primary" | "info" | "warning" | "success";

const toneClass: Record<SummaryTone, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
};

function SummaryChip({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: LucideIcon;
  tone: SummaryTone;
  value: number | undefined;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-4 py-3">
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          toneClass[tone],
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex flex-col">
        <span className="text-lg font-semibold leading-none">
          {typeof value === "number" ? value : "—"}
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">{label}</span>
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
    <section className="rounded-lg border border-border bg-card/40">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {count}
          </span>
        </div>
      </header>
      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : count === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          {empty}
        </div>
      ) : (
        children
      )}
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
    <ul className="divide-y divide-border">
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
                "group flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                isActive && "bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  priorityDotColor[item.priority],
                )}
              />
              {item.type === "BUG" ? (
                <Bug className="h-3.5 w-3.5 shrink-0 text-destructive/80" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary/80" />
              )}
              <span className="font-mono text-[11px] text-muted-foreground">
                {item.code}
              </span>
              <span className="flex-1 truncate text-[13px] font-medium">
                {item.title}
              </span>
              {item.contextLabel ? (
                <Badge
                  variant="outline"
                  className="hidden max-w-36 truncate md:inline-flex"
                >
                  {item.contextLabel}
                </Badge>
              ) : null}
              <StatusBadge
                category={item.statusCategory}
                label={item.statusLabel}
                withDot={false}
              />
              {item.versionName && (
                <Tip content={item.versionName}>
                  <Badge
                    variant="outline"
                    className="hidden gap-1 md:inline-flex"
                  >
                    <GitBranch aria-hidden="true" className="h-2.5 w-2.5" />
                    {item.versionName}
                  </Badge>
                </Tip>
              )}
              {item.dueDate && (
                <span
                  className={cn(
                    "hidden text-[11px] md:inline-block",
                    item.isOverdue
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {item.dueDate}
                </span>
              )}
              <Tip content={item.assignee.name || undefined}>
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarFallback className="text-[9px]">
                    {item.assignee.initial}
                  </AvatarFallback>
                </Avatar>
              </Tip>
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
  statusLabel?: (category: StatusCategory) => string,
  justNowLabel?: string,
  unknownVersionLabel?: string,
) {
  const toViewModel = createWorkItemViewModelMapper({
    locale,
    lookups,
    statusLabel,
    justNowLabel,
    unknownVersionLabel,
  });

  return (item: ViewWorkItemSummary): WorkbenchItemViewModel => ({
    ...toViewModel(item),
    organizationId: item.organizationId,
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
    ...view.sections.blocked.items.items,
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

function initialOf(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "?";
  }

  return trimmed.slice(0, 1).toUpperCase();
}

function formatTimeAgo(value: string, locale: string, justNowLabel = "") {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (Math.abs(diffMin) < 1) {
    return justNowLabel;
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffMin) < 60) {
    return rtf.format(-diffMin, "minute");
  }

  const diffHour = Math.round(diffMin / 60);

  if (Math.abs(diffHour) < 24) {
    return rtf.format(-diffHour, "hour");
  }

  const diffDay = Math.round(diffHour / 24);

  return rtf.format(-diffDay, "day");
}
