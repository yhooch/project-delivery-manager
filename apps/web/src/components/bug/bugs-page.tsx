"use client";

import {
  BugSeverity,
  BugView,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  StatusCategory,
  TagDto,
  Version,
  WorkItem,
  WorkItemStatusCategoryCount,
} from "@project-delivery/shared";
import { Bug, Filter, GitBranch, Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { formatDisplayCode } from "../../lib/display-code";
import {
  getBug,
  listBugs,
  type BugListFilterState,
} from "../../lib/bug-service";
import {
  useFocusReturn,
  useListKeyboardNav,
} from "../../lib/hooks/use-list-keyboard-nav";
import { useTagFilterOptions } from "../../lib/hooks/use-tag-filter-options";
import { useTagFilterSelection } from "../../lib/hooks/use-tag-filter-selection";
import { useUrlTagFilter } from "../../lib/hooks/use-url-tag-filter";
import { usePathname, useRouter } from "../../i18n/routing";
import { canCreateBugs } from "../../lib/permission-gates";
import { listRequirements } from "../../lib/requirement-service";
import { serializeTagFilterQuery } from "../../lib/tag-query";
import {
  useSpaceMembers,
  useVersions,
  useWorkflowStateLookup,
} from "../../lib/v2/lookups";
import {
  filterTraceOptionsByVersion,
  isTraceOptionCompatibleWithVersion,
} from "../../lib/versioned-trace-linking";
import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { cn } from "../../lib/utils";
import { translateWorkflowStateName } from "../../lib/workflow-display";
import { listWorkItems } from "../../lib/work-item-service";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { SelectMenu } from "../ui/select-menu";
import { Tip } from "../ui/tooltip";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { FilterField, FilterPanel } from "../v2/filter-controls";
import { PageHeader } from "../v2/page-header";

import { TaskDetailSheet } from "../work-item/task-detail-sheet";
import { ListTagRail, TagFilter } from "../tag";

import { CreateBugDialog } from "./create-bug-dialog";
import { EditBugDialog } from "./edit-bug-dialog";

const severityColor: Record<BugSeverity, string> = {
  BLOCKER: "bg-destructive text-destructive-foreground",
  CRITICAL: "bg-destructive/15 text-destructive",
  MAJOR: "bg-warning/15 text-warning",
  MINOR: "bg-info/15 text-info",
  TRIVIAL: "bg-muted text-muted-foreground",
};

type StatusFilterKey = "all" | StatusCategory;

const STATUS_FILTERS: StatusCategory[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
];
const PRIORITY_FILTERS: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const SEVERITY_FILTERS: BugSeverity[] = [
  "BLOCKER",
  "CRITICAL",
  "MAJOR",
  "MINOR",
  "TRIVIAL",
];
const LIST_PAGE_SIZE = 100;
const INITIAL_PAGE_INFO = { page: 1, pageSize: LIST_PAGE_SIZE, total: 0 };

type BugItemViewModel = WorkItemViewModel & {
  severity: BugSeverity;
  tags?: readonly TagDto[];
};

export function BugsPage() {
  const tNav = useTranslations("shell.nav");
  const t = useTranslations("bugs");
  const tStatus = useTranslations("bugs.statusCategory");
  const tPriority = useTranslations("bugs.priority");
  const tSeverity = useTranslations("bugs.severity");
  const tFilters = useTranslations("bugs.filters");
  const tTags = useTranslations("tags.field");
  const tApiError = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { currentSpace, status: sessionStatus } = useSession();
  const spaceId = currentSpace?.id;
  const organizationId = currentSpace?.organizationId;
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );
  const { members, getMember } = useSpaceMembers(spaceId, organizationId);
  const { versions, getVersion } = useVersions(spaceId, organizationId);

  const [items, setItems] = useState<BugView[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionFocusRequest, setActionFocusRequest] = useState(0);
  const [filters, setFilters] = useState<BugListFilterState>(() =>
    createInitialFilters(searchParams),
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [relatedTasks, setRelatedTasks] = useState<WorkItem[]>([]);
  const [pageInfo, setPageInfo] = useState(INITIAL_PAGE_INFO);
  const [statusCategoryCounts, setStatusCategoryCounts] = useState<
    WorkItemStatusCategoryCount[]
  >([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBug, setEditingBug] = useState<BugView | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [handledDeepLinkKey, setHandledDeepLinkKey] = useState<string | null>(
    null,
  );
  const { captureFocus, restoreFocus } = useFocusReturn();
  const canCreateBug = canCreateBugs(currentSpace?.role, currentSpace?.status);
  const requestedVersionId = normalizeSearchParam(
    searchParams.get("versionId"),
  );
  const requestedStatusCategory = normalizeStatusCategory(
    searchParams.get("statusCategory"),
  );
  const requestedNew = normalizeSearchParam(searchParams.get("new"));
  const requestedBugId =
    normalizeSearchParam(searchParams.get("bugId")) ??
    normalizeSearchParam(searchParams.get("workItemId"));
  const [tagFilter, setTagFilter] = useUrlTagFilter({
    fixedTagMatch: "ANY",
    pathname,
    router,
    searchParams,
  });
  const listScopeKey = useMemo(
    () =>
      createBugListScopeKey({
        filters,
        organizationId,
        spaceId,
        tagIds: tagFilter.tagIds,
        tagMatch: tagFilter.tagMatch,
      }),
    [filters, organizationId, spaceId, tagFilter],
  );
  const contextKey = useMemo(
    () => `${organizationId ?? ""}:${spaceId ?? ""}`,
    [organizationId, spaceId],
  );
  const latestListScopeKeyRef = useRef(listScopeKey);
  const listRequestIdRef = useRef(0);
  const previousContextKeyRef = useRef(contextKey);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  latestListScopeKeyRef.current = listScopeKey;
  const loadedCount = items.length;
  const paginationFrom = loadedCount > 0 ? 1 : 0;
  const paginationTo = Math.min(loadedCount, pageInfo.total);
  const hasMoreItems = loadedCount < pageInfo.total;
  const filteredRequirements = useMemo(
    () => filterTraceOptionsByVersion(requirements, filters.versionId ?? ""),
    [filters.versionId, requirements],
  );
  const filteredRelatedTasks = useMemo(
    () => filterTraceOptionsByVersion(relatedTasks, filters.versionId ?? ""),
    [filters.versionId, relatedTasks],
  );
  const { items: tagFilterOptions, reload: reloadTagFilterOptions } =
    useTagFilterOptions({
      organizationId,
      scope: "BUG",
      spaceId,
    });
  const { selectedTags: selectedFilterTags, setSelectedTags } =
    useTagFilterSelection({
      organizationId,
      sourceTags: tagFilterOptions,
      spaceId,
      tagIds: tagFilter.tagIds,
    });

  const setFilter = useCallback(
    (key: keyof BugListFilterState, value: string) => {
      setFilters((current) => ({ ...current, [key]: value || undefined }));
    },
    [],
  );
  const setVersionFilter = useCallback(
    (nextVersionId: string) => {
      setFilters((current) => {
        const selectedRequirement = requirements.find(
          (requirement) => requirement.id === current.requirementId,
        );
        const selectedRelatedTask = relatedTasks.find(
          (task) => task.id === current.relatedTaskId,
        );
        const nextRequirementId = isTraceOptionCompatibleWithVersion(
          selectedRequirement,
          nextVersionId,
        )
          ? current.requirementId
          : undefined;
        const nextRelatedTaskId = isTraceOptionCompatibleWithVersion(
          selectedRelatedTask,
          nextVersionId,
        )
          ? current.relatedTaskId
          : undefined;

        return {
          ...current,
          relatedTaskId: nextRelatedTaskId,
          requirementId: nextRequirementId,
          versionId: nextVersionId || undefined,
        };
      });
    },
    [relatedTasks, requirements],
  );
  const setRequirementFilter = useCallback(
    (nextRequirementId: string) => {
      setFilters((current) => {
        const selectedRequirement = requirements.find(
          (requirement) => requirement.id === nextRequirementId,
        );
        const selectedRelatedTask = relatedTasks.find(
          (task) => task.id === current.relatedTaskId,
        );
        const nextVersionId =
          selectedRequirement?.versionId || current.versionId || "";

        return {
          ...current,
          relatedTaskId: isTraceOptionCompatibleWithVersion(
            selectedRelatedTask,
            nextVersionId,
          )
            ? current.relatedTaskId
            : undefined,
          requirementId: nextRequirementId || undefined,
          versionId: nextVersionId || undefined,
        };
      });
    },
    [relatedTasks, requirements],
  );
  const setRelatedTaskFilter = useCallback(
    (nextRelatedTaskId: string) => {
      setFilters((current) => {
        const selectedRequirement = requirements.find(
          (requirement) => requirement.id === current.requirementId,
        );
        const selectedRelatedTask = relatedTasks.find(
          (task) => task.id === nextRelatedTaskId,
        );
        const nextVersionId =
          selectedRelatedTask?.versionId || current.versionId || "";

        return {
          ...current,
          relatedTaskId: nextRelatedTaskId || undefined,
          requirementId: isTraceOptionCompatibleWithVersion(
            selectedRequirement,
            nextVersionId,
          )
            ? current.requirementId
            : undefined,
          versionId: nextVersionId || undefined,
        };
      });
    },
    [relatedTasks, requirements],
  );

  const fetchBugs = useCallback(
    async (page = 1, mode: "replace" | "append" = "replace") => {
      if (!spaceId) {
        return;
      }

      const requestId = listRequestIdRef.current + 1;
      listRequestIdRef.current = requestId;
      const requestScopeKey = listScopeKey;
      const append = mode === "append";

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setHasLoadedItems(false);
      }
      setErrorMessage(null);

      try {
        const result = await listBugs({
          organizationId,
          page,
          pageSize: LIST_PAGE_SIZE,
          spaceId,
          type: "BUG",
          ...filters,
          ...(tagFilter.tagIds.length > 0
            ? serializeTagFilterQuery(tagFilter)
            : {}),
        });
        if (
          listRequestIdRef.current !== requestId ||
          latestListScopeKeyRef.current !== requestScopeKey
        ) {
          return;
        }
        setItems((current) =>
          append ? [...current, ...result.items] : result.items,
        );
        setPageInfo({
          page: result.page ?? page,
          pageSize: result.pageSize ?? LIST_PAGE_SIZE,
          total: result.total ?? result.items.length,
        });
        setStatusCategoryCounts(result.statusCategoryCounts ?? []);
      } catch (error) {
        if (
          listRequestIdRef.current === requestId &&
          latestListScopeKeyRef.current === requestScopeKey
        ) {
          const key = getApiErrorMessageKey(error);
          setErrorMessage(tApiError(key));
        }
      } finally {
        if (
          listRequestIdRef.current === requestId &&
          latestListScopeKeyRef.current === requestScopeKey
        ) {
          if (append) {
            setLoadingMore(false);
          } else {
            setLoading(false);
          }
          setHasLoadedItems(true);
        }
      }
    },
    [filters, listScopeKey, organizationId, spaceId, tApiError, tagFilter],
  );

  useEffect(() => {
    if (spaceId) {
      void fetchBugs(1, "replace");
    } else {
      listRequestIdRef.current += 1;
      setItems([]);
      setPageInfo(INITIAL_PAGE_INFO);
      setStatusCategoryCounts([]);
      setLoading(false);
      setLoadingMore(false);
      setHasLoadedItems(false);
    }
  }, [fetchBugs, spaceId]);

  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) {
      return;
    }
    previousContextKeyRef.current = contextKey;
    setActiveItem(null);
    setSheetOpen(false);
    setActionFocusRequest(0);
    setEditingBug(null);
    setCreateOpen(false);
    setFilterOpen(false);
    setRequirements([]);
    setRelatedTasks([]);
    setDetailRevision((revision) => revision + 1);
    setHandledDeepLinkKey(null);
  }, [contextKey]);

  useEffect(() => {
    if (!filterOpen || !spaceId) {
      return;
    }

    let cancelled = false;

    void Promise.all([
      listRequirements({ organizationId, page: 1, pageSize: 100, spaceId }),
      listWorkItems({
        organizationId,
        page: 1,
        pageSize: 100,
        spaceId,
        type: "TASK",
      }),
    ])
      .then(([requirementPage, taskPage]) => {
        if (!cancelled) {
          setRequirements(requirementPage.items);
          setRelatedTasks(taskPage.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRequirements([]);
          setRelatedTasks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filterOpen, organizationId, spaceId]);

  useEffect(() => {
    if (!filterOpen) {
      return;
    }

    setFilters((current) => {
      const selectedRequirement = requirements.find(
        (requirement) => requirement.id === current.requirementId,
      );
      const selectedRelatedTask = relatedTasks.find(
        (task) => task.id === current.relatedTaskId,
      );
      const nextVersionId =
        current.versionId ||
        selectedRequirement?.versionId ||
        selectedRelatedTask?.versionId ||
        "";
      const nextRequirementId = isTraceOptionCompatibleWithVersion(
        selectedRequirement,
        nextVersionId,
      )
        ? current.requirementId
        : undefined;
      const nextRelatedTaskId = isTraceOptionCompatibleWithVersion(
        selectedRelatedTask,
        nextVersionId,
      )
        ? current.relatedTaskId
        : undefined;

      if (
        current.versionId === (nextVersionId || undefined) &&
        current.requirementId === nextRequirementId &&
        current.relatedTaskId === nextRelatedTaskId
      ) {
        return current;
      }

      return {
        ...current,
        relatedTaskId: nextRelatedTaskId,
        requirementId: nextRequirementId,
        versionId: nextVersionId || undefined,
      };
    });
  }, [filterOpen, relatedTasks, requirements]);

  const workflowVersionIds = useMemo(
    () => items.map((item) => item.workflowVersionId),
    [items],
  );
  const workflowStateLookup = useWorkflowStateLookup(
    workflowVersionIds,
    spaceId,
    organizationId,
  );

  const bugViewModels = useMemo<BugItemViewModel[]>(
    () =>
      items.map((bug) =>
        toBugViewModel(
          bug,
          tStatus,
          tApiError,
          {
            getMember,
            getVersion,
            getWorkflowState: workflowStateLookup.getState,
          },
          locale,
        ),
      ),
    [
      getMember,
      getVersion,
      items,
      locale,
      tStatus,
      tApiError,
      workflowStateLookup.getState,
    ],
  );

  const filtered = bugViewModels;

  const openBug = useCallback(
    (bug: BugItemViewModel, options: { focusActions?: boolean } = {}) => {
      captureFocus();
      recordRecentOpen(
        {
          id: bug.id,
          type: "BUG",
          code: bug.code,
          title: bug.title,
          href: `/bugs?bugId=${encodeURIComponent(bug.id)}`,
        },
        recentScope,
      );
      setActiveItem(bug);
      setActionFocusRequest((current) =>
        options.focusActions ? current + 1 : 0,
      );
      setSheetOpen(true);
    },
    [captureFocus, recentScope],
  );

  const openBugActionArea = useCallback(
    (bug: BugItemViewModel) => {
      openBug(bug, { focusActions: true });
    },
    [openBug],
  );

  const openEditBug = useCallback((bug: BugView) => {
    setEditingBug(bug);
  }, []);

  const openEditBugFromViewModel = useCallback(
    (bug: BugItemViewModel) => {
      const source = items.find((item) => item.id === bug.id);
      if (
        source &&
        canEditBug(source, currentSpace?.role, currentSpace?.status)
      ) {
        captureFocus();
        openEditBug(source);
      }
    },
    [
      captureFocus,
      currentSpace?.role,
      currentSpace?.status,
      items,
      openEditBug,
    ],
  );

  const handleSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      setSheetOpen(nextOpen);
      if (!nextOpen) {
        setActionFocusRequest(0);
        restoreFocus();
      }
    },
    [restoreFocus],
  );

  const handleBugUpdated = useCallback(
    (updated: BugView) => {
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setActiveItem(
        toBugViewModel(
          updated,
          tStatus,
          tApiError,
          {
            getMember,
            getVersion,
            getWorkflowState: workflowStateLookup.getState,
          },
          locale,
        ),
      );
      setDetailRevision((revision) => revision + 1);
      void fetchBugs(1, "replace");
    },
    [
      fetchBugs,
      getMember,
      getVersion,
      locale,
      tApiError,
      tStatus,
      workflowStateLookup.getState,
    ],
  );

  const focusRow = useCallback((bugId: string) => {
    rowRefs.current
      .get(bugId)
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (requestedNew === "bug" && canCreateBug) {
      setCreateOpen(true);
    }
  }, [canCreateBug, requestedNew]);

  useEffect(() => {
    setFilters((current) => {
      if (
        current.versionId === requestedVersionId &&
        current.statusCategory === requestedStatusCategory
      ) {
        return current;
      }
      return {
        ...current,
        statusCategory: requestedStatusCategory,
        versionId: requestedVersionId,
      };
    });
  }, [requestedStatusCategory, requestedVersionId]);

  useEffect(() => {
    if (!requestedBugId || !spaceId) {
      return;
    }

    const key = `bug:${spaceId}:${requestedBugId}`;
    if (handledDeepLinkKey === key) {
      return;
    }

    const listed = bugViewModels.find((item) => item.id === requestedBugId);
    if (listed) {
      openBug(listed);
      setHandledDeepLinkKey(key);
      return;
    }

    if (loading || !hasLoadedItems) {
      return;
    }

    let cancelled = false;
    void getBug({ bugId: requestedBugId, organizationId, spaceId })
      .then((bug) => {
        if (!cancelled) {
          openBug(
            toBugViewModel(
              bug,
              tStatus,
              tApiError,
              {
                getMember,
                getVersion,
                getWorkflowState: workflowStateLookup.getState,
              },
              locale,
            ),
          );
          setHandledDeepLinkKey(key);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHandledDeepLinkKey(key);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    getMember,
    getVersion,
    handledDeepLinkKey,
    hasLoadedItems,
    loading,
    locale,
    openBug,
    organizationId,
    requestedBugId,
    spaceId,
    tApiError,
    tStatus,
    bugViewModels,
    workflowStateLookup.getState,
  ]);

  useListKeyboardNav<BugItemViewModel>({
    items: filtered,
    activeId: activeItem?.id,
    getId: (item) => item.id,
    onSelect: (item) => {
      setActiveItem(item);
      focusRow(item.id);
    },
    onOpen: openBug,
    onEdit: openEditBugFromViewModel,
    canAssign: (bug) =>
      canEditBug(
        items.find((item) => item.id === bug.id),
        currentSpace?.role,
        currentSpace?.status,
      ),
    onAssign: openEditBugFromViewModel,
    onSubmit: openBugActionArea,
    onClose: sheetOpen ? () => handleSheetOpenChange(false) : undefined,
  });

  const buckets: { count: number; label: string; key: StatusFilterKey }[] =
    useMemo(
      () => [
        {
          label: t("buckets.all"),
          key: "all",
          count: getAllStatusCategoryCount(
            statusCategoryCounts,
            bugViewModels.length,
          ),
        },
        {
          count: getStatusCategoryCount(statusCategoryCounts, "NOT_STARTED"),
          label: tStatus("NOT_STARTED"),
          key: "NOT_STARTED",
        },
        {
          count: getStatusCategoryCount(statusCategoryCounts, "IN_PROGRESS"),
          label: tStatus("IN_PROGRESS"),
          key: "IN_PROGRESS",
        },
        {
          count: getStatusCategoryCount(statusCategoryCounts, "WAITING"),
          label: tStatus("WAITING"),
          key: "WAITING",
        },
        {
          count: getStatusCategoryCount(statusCategoryCounts, "VERIFYING"),
          label: tStatus("VERIFYING"),
          key: "VERIFYING",
        },
        {
          count: getStatusCategoryCount(statusCategoryCounts, "DONE"),
          label: tStatus("DONE"),
          key: "DONE",
        },
        {
          count: getStatusCategoryCount(statusCategoryCounts, "TERMINATED"),
          label: tStatus("TERMINATED"),
          key: "TERMINATED",
        },
      ],
      [bugViewModels.length, statusCategoryCounts, t, tStatus],
    );

  const header = (
    <PageHeader
      eyebrow={tNav("group.deliver")}
      title={tNav("bugs")}
      description={t("page.description")}
      actions={
        <>
          {spaceId && (
            <Button
              variant={filterOpen ? "secondary" : "outline"}
              size="sm"
              className="text-xs"
              data-testid="bugs-filter-button"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
            >
              <Filter className="h-3 w-3" />
              {t("actions.filter")}
            </Button>
          )}
          {spaceId && canCreateBug && (
            <Button
              size="sm"
              className="text-xs"
              data-testid="bugs-create-button"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3 w-3" />
              {t("actions.create")}
            </Button>
          )}
        </>
      }
    />
  );
  const paginationFooter =
    pageInfo.total > 0 ? (
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <span data-testid="bugs-pagination-summary">
          {t("pagination.summary", {
            from: paginationFrom,
            to: paginationTo,
            total: pageInfo.total,
          })}
        </span>
        {hasMoreItems ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-testid="bugs-load-more"
            disabled={loadingMore}
            onClick={() => {
              void fetchBugs(pageInfo.page + 1, "append");
            }}
          >
            {loadingMore
              ? t("pagination.loadingMore")
              : t("pagination.loadMore")}
          </Button>
        ) : null}
      </div>
    ) : null;

  if (sessionStatus === "loading") {
    return (
      <div data-testid="bugs-page" className="flex h-full min-w-0 flex-col">
        {header}
        <ListSkeleton />
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div data-testid="bugs-page" className="flex h-full min-w-0 flex-col">
        {header}
        <EmptyState
          title={t("states.noSpace.title")}
          description={t("states.noSpace.description")}
        />
      </div>
    );
  }

  return (
    <div data-testid="bugs-page" className="flex h-full min-w-0 flex-col">
      {header}

      <div className="border-b border-border px-4 py-3 sm:px-6">
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="flex min-w-max items-center gap-1">
            {buckets.map((b) => (
              <button
                key={b.key}
                type="button"
                data-testid="bugs-filter-option"
                data-filter-key={b.key}
                onClick={() => {
                  setFilter("statusCategory", b.key === "all" ? "" : b.key);
                }}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  (filters.statusCategory ?? "all") === b.key
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {b.label}
                <span className="rounded bg-background px-1 font-mono text-[10px]">
                  {b.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {filterOpen && (
        <FilterPanel
          data-testid="bugs-filter-panel"
        >
          <FilterField label={tFilters("version")}>
            <SelectMenu
              data-testid="bugs-filter-version"
              value={filters.versionId ?? ""}
              onChange={(event) => setVersionFilter(event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{tFilters("allVersions")}</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={tFilters("assignee")}>
            <SelectMenu
              data-testid="bugs-filter-assignee"
              value={filters.assigneeId ?? ""}
              onChange={(event) => setFilter("assigneeId", event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{tFilters("allAssignees")}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user.name || member.user.username}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={tFilters("statusCategory")} width="sm">
            <SelectMenu
              data-testid="bugs-filter-status"
              value={filters.statusCategory ?? ""}
              onChange={(event) => {
                setFilter("statusCategory", event.target.value);
              }}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{tFilters("allStatusCategories")}</option>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {tStatus(status)}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={tFilters("priority")} width="sm">
            <SelectMenu
              data-testid="bugs-filter-priority"
              value={filters.priority ?? ""}
              onChange={(event) => setFilter("priority", event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{tFilters("allPriorities")}</option>
              {PRIORITY_FILTERS.map((priority) => (
                <option key={priority} value={priority}>
                  {tPriority(priority)}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={tFilters("severity")} width="sm">
            <SelectMenu
              data-testid="bugs-filter-severity"
              value={filters.severity ?? ""}
              onChange={(event) => setFilter("severity", event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{tFilters("allSeverities")}</option>
              {SEVERITY_FILTERS.map((severity) => (
                <option key={severity} value={severity}>
                  {tSeverity(severity)}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={tFilters("requirement")} width="lg">
            <SelectMenu
              data-testid="bugs-filter-requirement"
              value={filters.requirementId ?? ""}
              onChange={(event) => setRequirementFilter(event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              contentClassName="w-72"
            >
              <option value="">{tFilters("allRequirements")}</option>
              {filteredRequirements.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.title || requirement.id}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={tFilters("relatedTask")} width="lg">
            <SelectMenu
              data-testid="bugs-filter-related-task"
              value={filters.relatedTaskId ?? ""}
              onChange={(event) => setRelatedTaskFilter(event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              contentClassName="w-72"
            >
              <option value="">{tFilters("allRelatedTasks")}</option>
              {filteredRelatedTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={tTags("label")} width="tag">
            <TagFilter
              availableTags={tagFilterOptions}
              onChange={(value, selectedTags) => {
                setSelectedTags(selectedTags);
                setTagFilter(value);
              }}
              selectedTags={selectedFilterTags}
              showMatchMode={false}
              value={tagFilter}
              data-testid="bugs-filter-tags"
            />
          </FilterField>
        </FilterPanel>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto">
        {loading ? (
          <ListSkeleton />
        ) : errorMessage ? (
          <ErrorState
            title={t("states.error.title")}
            message={errorMessage}
            retryLabel={t("actions.retry")}
            onRetry={() => {
              void fetchBugs();
            }}
          />
        ) : filtered.length === 0 ? (
          <>
            <EmptyState
              title={t("states.empty.title")}
              description={t("states.empty.description")}
            />
            {paginationFooter}
          </>
        ) : (
          <>
            <ul
              data-testid="bugs-list"
              role="list"
              aria-label={tNav("bugs")}
              className="divide-y divide-border"
            >
              {filtered.map((bug) => (
                <li
                  key={bug.id}
                  data-testid="bugs-row"
                  data-id={bug.id}
                  ref={(node) => {
                    if (node) {
                      rowRefs.current.set(bug.id, node);
                    } else {
                      rowRefs.current.delete(bug.id);
                    }
                  }}
                  aria-current={activeItem?.id === bug.id ? "true" : undefined}
                >
                  <div
                    className={cn(
                      "flex min-w-0 items-center gap-2 border-l-2 px-4 py-2.5 transition-colors sm:px-6",
                      activeItem?.id === bug.id
                        ? "border-primary bg-primary/10"
                        : "border-transparent hover:bg-muted/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openBug(bug)}
                      data-selected={activeItem?.id === bug.id}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-sm text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <Bug className="h-3.5 w-3.5 shrink-0 text-destructive/80" />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {bug.code}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-[13px] font-medium">
                          {bug.title}
                        </span>
                        <ListTagRail tags={bug.tags} />
                      </span>
                      <span
                        className={cn(
                          "hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline-flex",
                          severityColor[bug.severity],
                        )}
                      >
                        {tSeverity(bug.severity)}
                      </span>
                      <span className="shrink-0">
                        <StatusBadge
                          category={bug.statusCategory}
                          label={bug.statusLabel}
                          withDot={false}
                        />
                      </span>
                      {bug.versionName && (
                        <Tip
                          content={`${tFilters("version")}: ${bug.versionName}`}
                        >
                          <Badge
                            variant="outline"
                            className="hidden gap-1 md:inline-flex"
                          >
                            <GitBranch
                              aria-hidden="true"
                              className="h-2.5 w-2.5"
                            />
                            {bug.versionName}
                          </Badge>
                        </Tip>
                      )}
                      {bug.isOverdue && (
                        <Badge variant="destructive" className="text-[10px]">
                          {t("badges.overdue")}
                        </Badge>
                      )}
                      {bug.dueDate && (
                        <span
                          className={cn(
                            "hidden shrink-0 text-[11px] md:inline-block",
                            bug.isOverdue
                              ? "text-destructive"
                              : "text-muted-foreground",
                          )}
                        >
                          {bug.dueDate}
                        </span>
                      )}
                      <Tip content={bug.assignee.name || undefined}>
                        <Avatar className="h-5 w-5 shrink-0">
                          <AvatarFallback className="text-[9px]">
                            {bug.assignee.initial}
                          </AvatarFallback>
                        </Avatar>
                      </Tip>
                    </button>
                    {canEditBug(
                      items.find((item) => item.id === bug.id),
                      currentSpace?.role,
                      currentSpace?.status,
                    ) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        data-testid="bugs-edit-button"
                        data-id={bug.id}
                        aria-label={t("actions.edit")}
                        onClick={() => {
                          openEditBugFromViewModel(bug);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {paginationFooter}
          </>
        )}
      </div>

      <TaskDetailSheet
        key={`${activeItem?.id ?? "empty"}:${detailRevision}`}
        actionFocusRequest={actionFocusRequest}
        item={activeItem}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        organizationId={organizationId}
        spaceId={spaceId}
        onChanged={() => {
          setDetailRevision((revision) => revision + 1);
          reloadTagFilterOptions();
          void fetchBugs(1, "replace");
        }}
      />

      {spaceId && canCreateBug && (
        <CreateBugDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          spaceId={spaceId}
          onCreated={() => {
            reloadTagFilterOptions();
            void fetchBugs(1, "replace");
          }}
        />
      )}

      {spaceId && (
        <EditBugDialog
          bug={editingBug}
          open={Boolean(editingBug)}
          onOpenChange={(open) => {
            if (!open) {
              setEditingBug(null);
            }
          }}
          organizationId={organizationId}
          spaceId={spaceId}
          onUpdated={(bug) => {
            reloadTagFilterOptions();
            handleBugUpdated(bug);
          }}
        />
      )}
    </div>
  );
}

function canWriteBugs(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(role) && role !== "VIEWER" && status !== "DISABLED";
}

function canEditBug(
  bug: BugView | undefined,
  role: string | undefined,
  status: string | undefined,
): boolean {
  return canWriteBugs(role, status) && bug?.permissions?.canEdit === true;
}

type BugLookupHelpers = {
  getMember: (userId: string) => SpaceMemberWithUser | undefined;
  getVersion: (versionId: string) => Version | undefined;
  getWorkflowState: (
    workflowVersionId: string | undefined,
    stateId: string | undefined,
  ) => { code: string; name: string } | undefined;
};

function toBugViewModel(
  bug: BugView,
  tStatus: (key: StatusCategory) => string,
  tRoot: (key: string) => string,
  lookups: BugLookupHelpers,
  locale: string,
): BugItemViewModel {
  const code = formatDisplayCode("BUG", bug.id);
  const member = bug.assigneeId ? lookups.getMember(bug.assigneeId) : undefined;
  const assigneeName = member?.user.name ?? member?.user.username ?? "";
  const initial = deriveInitial(assigneeName);
  const version = bug.versionId ? lookups.getVersion(bug.versionId) : undefined;
  const dueDate = bug.dueDate ? formatDate(bug.dueDate, locale) : undefined;
  const isOverdue = bug.dueDate
    ? new Date(bug.dueDate).getTime() < Date.now() &&
      bug.statusCategory !== "DONE" &&
      bug.statusCategory !== "TERMINATED"
    : false;
  const isBlocked = Boolean(bug.blockedAt);
  const workflowState = lookups.getWorkflowState(
    bug.workflowVersionId,
    bug.currentStateId,
  );
  const statusLabel = workflowState
    ? translateWorkflowStateName(tRoot, workflowState)
    : tStatus(bug.statusCategory);

  return {
    id: bug.id,
    code,
    type: "BUG",
    title: bug.title,
    workflowVersionId: bug.workflowVersionId,
    currentStateId: bug.currentStateId,
    statusCategory: bug.statusCategory,
    statusLabel,
    priority: bug.priority,
    assignee: { name: assigneeName, initial },
    versionName: version?.name,
    dueDate,
    isOverdue,
    isBlocked,
    blockedReason: bug.blockedReason,
    updatedAgo: undefined,
    tags: bug.tags,
    severity: bug.bugDetail.severity,
  };
}

function deriveInitial(value?: string): string {
  if (!value) {
    return "?";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "?";
  }
  return trimmed.charAt(0).toUpperCase();
}

function formatDate(iso: string, locale: string): string | undefined {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date,
    );
  } catch {
    return undefined;
  }
}

function normalizeSearchParam(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function createInitialFilters(
  searchParams: URLSearchParams,
): BugListFilterState {
  const versionId = normalizeSearchParam(searchParams.get("versionId"));
  const statusCategory = normalizeStatusCategory(
    searchParams.get("statusCategory"),
  );

  return {
    ...(versionId ? { versionId } : {}),
    ...(statusCategory ? { statusCategory } : {}),
  };
}

function normalizeStatusCategory(
  value: string | null,
): StatusCategory | undefined {
  const normalized = normalizeSearchParam(value);
  return normalized && STATUS_FILTERS.includes(normalized as StatusCategory)
    ? (normalized as StatusCategory)
    : undefined;
}

function getStatusCategoryCount(
  counts: WorkItemStatusCategoryCount[],
  statusCategory: StatusCategory,
): number {
  return (
    counts.find((entry) => entry.statusCategory === statusCategory)?.count ?? 0
  );
}

function getAllStatusCategoryCount(
  counts: WorkItemStatusCategoryCount[],
  fallback: number,
): number {
  if (counts.length === 0) {
    return fallback;
  }

  return counts.reduce((sum, entry) => sum + entry.count, 0);
}

function createBugListScopeKey({
  filters,
  organizationId,
  spaceId,
  tagIds,
  tagMatch,
}: {
  filters: BugListFilterState;
  organizationId?: string;
  spaceId?: string;
  tagIds: readonly string[];
  tagMatch: string;
}): string {
  return [
    organizationId ?? "",
    spaceId ?? "",
    filters.assigneeId ?? "",
    filters.priority ?? "",
    filters.relatedTaskId ?? "",
    filters.reporterId ?? "",
    filters.requirementId ?? "",
    filters.severity ?? "",
    filters.statusCategory ?? "",
    filters.versionId ?? "",
    tagIds.join(","),
    tagIds.length > 0 ? tagMatch : "",
  ].join("\u001f");
}
