"use client";

import type {
  Priority,
  Requirement,
  TagDto,
  StatusCategory,
  WorkItem,
  ListWorkItemsResponse,
  WorkItemDimensionCount,
  WorkItemStatusCategoryCount,
  TagMatch,
} from "@project-delivery/shared";
import { Filter, Plus, Search } from "lucide-react";
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
import {
  useFocusReturn,
  useListKeyboardNav,
} from "../../lib/hooks/use-list-keyboard-nav";
import { useTagFilterOptions } from "../../lib/hooks/use-tag-filter-options";
import { useTagFilterSelection } from "../../lib/hooks/use-tag-filter-selection";
import { useUrlTagFilter } from "../../lib/hooks/use-url-tag-filter";
import { canCreateTasks } from "../../lib/permission-gates";
import { listRequirements } from "../../lib/requirement-service";
import {
  isRealtimeRefreshMode,
  resolveRefreshMode,
  shouldShowBlockingRefreshState,
  shouldSurfaceRefreshError,
  useRealtimeInvalidation,
  type RefreshModeOptions,
} from "../../lib/realtime";
import { usePathname, useRouter } from "../../i18n/routing";
import { serializeTagFilterQuery } from "../../lib/tag-query";
import {
  useSpaceMembers,
  useVersions,
  useWorkflowStateLookup,
} from "../../lib/v2/lookups";
import {
  toWorkItemListViewModel,
  type WorkItemViewModel,
} from "../../lib/v2/work-item-view-model";
import {
  getWorkItem,
  listWorkItems,
  type TaskListFilterState,
} from "../../lib/work-item-service";
import { translateWorkflowStateName } from "../../lib/workflow-display";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SelectMenu } from "../ui/select-menu";
import { useSession } from "../providers/session-provider";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import {
  DimensionFilterHeader,
  type DimensionFilterBucket,
  type DimensionFilterOption,
} from "../v2/dimension-filter-header";
import { FilterField, FilterPanel } from "../v2/filter-controls";
import { PageHeader } from "../v2/page-header";
import { WorkItemRow } from "../v2/work-item-row";
import { recordRecentOpen } from "../shell/recent-opens";
import { formatTagDisplayName, TagFilter } from "../tag";

import { CreateTaskDialog } from "./create-task-dialog";
import { TaskDetailSheet } from "./task-detail-sheet";
import { normalizeWorkItemDetailPanel } from "./work-item-detail-panel";

type TaskDimensionKey =
  | "assigneeId"
  | "priority"
  | "requirementId"
  | "statusCategory"
  | "tagId"
  | "versionId";

const STATUS_FILTERS: StatusCategory[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
];
const PRIORITY_FILTERS: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const TASK_DIMENSIONS: TaskDimensionKey[] = [
  "statusCategory",
  "assigneeId",
  "priority",
  "versionId",
  "requirementId",
  "tagId",
];
const LIST_PAGE_SIZE = 100;
const INITIAL_PAGE_INFO = { page: 1, pageSize: LIST_PAGE_SIZE, total: 0 };
const TASKS_REALTIME_KEYS = [
  "work-item-list",
  "timeline",
  "comments",
  "attachments",
] as const;

export function TasksPage() {
  const tNav = useTranslations("shell.nav");
  const t = useTranslations("tasks");
  const tStatus = useTranslations("workItems.statusCategory");
  const tPriority = useTranslations("workItems.priority");
  const tFilters = useTranslations("workItems.filters");
  const tTags = useTranslations("tags.field");
  const tApiError = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { currentSpace, status: sessionStatus } = useSession();
  const spaceId = currentSpace?.id;
  const organizationId = currentSpace?.organizationId;
  const requestedNew = normalizeSearchParam(searchParams.get("new"));
  const requestedWorkItemId = normalizeSearchParam(
    searchParams.get("workItemId"),
  );
  const requestedCommentId = normalizeSearchParam(searchParams.get("commentId"));
  const requestedAttachmentId = normalizeSearchParam(
    searchParams.get("attachmentId"),
  );
  const requestedTimelineEventId = normalizeSearchParam(
    searchParams.get("eventId"),
  );
  const requestedDetailPanel =
    normalizeWorkItemDetailPanel(searchParams.get("panel")) ??
    (requestedCommentId
      ? "comments"
      : requestedAttachmentId
        ? "attachments"
        : requestedTimelineEventId
          ? "timeline"
          : undefined);
  const requestedIntakeItemId = normalizeSearchParam(
    searchParams.get("intakeItemId"),
  );
  const requestedVersionId = normalizeSearchParam(
    searchParams.get("versionId"),
  );
  const requestedStatusCategory = normalizeStatusCategory(
    searchParams.get("statusCategory"),
  );
  const [tagFilter, setTagFilter] = useUrlTagFilter({
    fixedTagMatch: "ANY",
    pathname,
    router,
    searchParams,
  });
  const { members, getMember } = useSpaceMembers(spaceId, organizationId);
  const { versions, getVersion } = useVersions(spaceId, organizationId);

  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionFocusRequest, setActionFocusRequest] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TaskListFilterState>(() => ({
    intakeItemId: requestedIntakeItemId,
    statusCategory: requestedStatusCategory,
    versionId: requestedVersionId,
  }));
  const [filterOpen, setFilterOpen] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [pageInfo, setPageInfo] = useState(INITIAL_PAGE_INFO);
  const [dimensionCounts, setDimensionCounts] = useState<
    WorkItemDimensionCount[]
  >([]);
  const [activeDimension, setActiveDimension] =
    useState<TaskDimensionKey>("statusCategory");
  const [createOpen, setCreateOpen] = useState(false);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [handledDeepLinkKey, setHandledDeepLinkKey] = useState<string | null>(
    null,
  );
  const { captureFocus, restoreFocus } = useFocusReturn();
  const canCreateTask = canCreateTasks(
    currentSpace?.role,
    currentSpace?.status,
  );
  const listScopeKey = useMemo(
    () =>
      createTaskListScopeKey({
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
  const itemsLengthRef = useRef(0);
  const pageInfoRef = useRef(pageInfo);
  const previousContextKeyRef = useRef(contextKey);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const searchQuery = useMemo(() => normalizeSearchQuery(query), [query]);
  latestListScopeKeyRef.current = listScopeKey;
  itemsLengthRef.current = items.length;
  pageInfoRef.current = pageInfo;
  const loadedCount = items.length;
  const paginationFrom = loadedCount > 0 ? 1 : 0;
  const paginationTo = Math.min(loadedCount, pageInfo.total);
  const hasMoreItems = loadedCount < pageInfo.total;
  const { items: tagFilterOptions, reload: reloadTagFilterOptions } =
    useTagFilterOptions({
      organizationId,
      scope: "TASK",
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
    (key: keyof TaskListFilterState, value: string) => {
      setFilters((current) =>
        applyTaskDimensionFilter(current, key, value || undefined),
      );
    },
    [],
  );

  const setDimensionFilter = useCallback(
    (dimension: TaskDimensionKey, value: string | null | undefined) => {
      setFilters((current) =>
        applyTaskDimensionFilter(current, dimension, value),
      );
    },
    [],
  );

  const fetchTasks = useCallback(
    async (
      page = 1,
      mode: "replace" | "append" = "replace",
      options?: RefreshModeOptions,
    ) => {
      const refreshMode = resolveRefreshMode(options);
      if (!spaceId) {
        return;
      }

      const requestId = listRequestIdRef.current + 1;
      listRequestIdRef.current = requestId;
      const requestScopeKey = listScopeKey;
      const append = mode === "append";
      const realtimeRefresh = isRealtimeRefreshMode(refreshMode);
      const pageSize =
        !append && realtimeRefresh
          ? Math.max(LIST_PAGE_SIZE, pageInfoRef.current.page * LIST_PAGE_SIZE)
          : LIST_PAGE_SIZE;
      const keepCurrentItems =
        !append &&
        (realtimeRefresh || Boolean(searchQuery)) &&
        itemsLengthRef.current > 0;

      if (append) {
        setLoadingMore(true);
      } else if (shouldShowBlockingRefreshState(refreshMode)) {
        setLoading(!keepCurrentItems);
        if (!keepCurrentItems) {
          setHasLoadedItems(false);
        }
      }
      if (shouldSurfaceRefreshError(refreshMode)) {
        setErrorMessage(null);
      }

      try {
        const result = await listWorkItems({
          organizationId,
          page,
          pageSize,
          spaceId,
          type: "TASK",
          ...(searchQuery ? { query: searchQuery } : {}),
          ...filters,
          ...serializeTagFilterQuery(tagFilter),
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
          page: realtimeRefresh ? pageInfoRef.current.page : (result.page ?? page),
          pageSize: result.pageSize ?? pageSize,
          total: result.total ?? result.items.length,
        });
        setDimensionCounts(resolveDimensionCounts(result));
      } catch (error) {
        if (
          listRequestIdRef.current === requestId &&
          latestListScopeKeyRef.current === requestScopeKey
        ) {
          if (shouldSurfaceRefreshError(refreshMode) && !keepCurrentItems) {
            const key = getApiErrorMessageKey(error);
            setErrorMessage(tApiError(key));
          }
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
    [
      filters,
      listScopeKey,
      organizationId,
      searchQuery,
      spaceId,
      tApiError,
      tagFilter,
    ],
  );

  useEffect(() => {
    if (spaceId) {
      void fetchTasks(1, "replace", { mode: "initial" });
    } else {
      listRequestIdRef.current += 1;
      setItems([]);
      setPageInfo(INITIAL_PAGE_INFO);
      setDimensionCounts([]);
      setLoading(false);
      setLoadingMore(false);
      setHasLoadedItems(false);
    }
  }, [fetchTasks, spaceId]);

  useRealtimeInvalidation(TASKS_REALTIME_KEYS, () => {
    void fetchTasks(1, "replace", { mode: "realtime" });
  });

  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) {
      return;
    }
    previousContextKeyRef.current = contextKey;
    setActiveItem(null);
    setSheetOpen(false);
    setActionFocusRequest(0);
    setCreateOpen(false);
    setFilterOpen(false);
    setRequirements([]);
    setHandledDeepLinkKey(null);
  }, [contextKey]);

  useEffect(() => {
    if ((!filterOpen && activeDimension !== "requirementId") || !spaceId) {
      return;
    }

    let cancelled = false;

    void listRequirements({
      organizationId,
      page: 1,
      pageSize: 100,
      spaceId,
    })
      .then((result) => {
        if (!cancelled) {
          setRequirements(result.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRequirements([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDimension, filterOpen, organizationId, spaceId]);

  const workflowVersionIds = useMemo(
    () => items.map((item) => item.workflowVersionId),
    [items],
  );
  const workflowStateLookup = useWorkflowStateLookup(
    workflowVersionIds,
    spaceId,
    organizationId,
  );

  const dimensionOptions: DimensionFilterOption[] = useMemo(
    () =>
      TASK_DIMENSIONS.map((dimension) => ({
        key: dimension,
        label: t(`dimensionFilter.dimensions.${dimension}`),
      })),
    [t],
  );

  const dimensionBuckets = useMemo(
    () =>
      createTaskDimensionBuckets({
        activeDimension,
        dimensionCounts,
        filters,
        getMember,
        getVersion,
        onSelect: (dimension, value) => {
          selectTaskDimensionBucket({
            dimension,
            setDimensionFilter,
            setSelectedTags,
            setTagFilter,
            tagFilterOptions,
            tagMatch: tagFilter.tagMatch,
            value,
          });
        },
        pageTotal: pageInfo.total,
        requirements,
        tagFilter,
        tagFilterOptions,
        t,
        tPriority,
        tStatus,
      }),
    [
      activeDimension,
      dimensionCounts,
      filters,
      getMember,
      getVersion,
      pageInfo.total,
      requirements,
      setDimensionFilter,
      setSelectedTags,
      setTagFilter,
      tagFilter,
      tagFilterOptions,
      t,
      tPriority,
      tStatus,
    ],
  );

  const taskViewModels = useMemo(
    () =>
      items.map((item) =>
        toWorkItemListViewModel(item, {
          locale,
          lookups: {
            getMember,
            getVersion,
            getWorkflowState: workflowStateLookup.getState,
          },
          statusLabel: (category) => tStatus(category),
          workflowStateLabel: (state) =>
            translateWorkflowStateName(tApiError, state),
        }),
      ),
    [
      getMember,
      getVersion,
      items,
      locale,
      tApiError,
      tStatus,
      workflowStateLookup.getState,
    ],
  );

  const filtered = useMemo(() => {
    return taskViewModels.filter((task) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          task.title.toLowerCase().includes(q) ||
          task.code.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [searchQuery, taskViewModels]);

  const open = useCallback(
    (
      item: WorkItemViewModel,
      options: { focusActions?: boolean } = {},
    ) => {
      captureFocus();
      const itemOrganizationId = item.organizationId ?? organizationId;
      const itemSpaceId = item.spaceId ?? spaceId;

      recordRecentOpen(
        {
          id: item.id,
          type: "TASK",
          displayCode: item.code,
          title: item.title,
          href: `/work-items?workItemId=${encodeURIComponent(item.id)}`,
          organizationId: itemOrganizationId,
          spaceId: itemSpaceId,
        },
        { organizationId: itemOrganizationId, spaceId: itemSpaceId },
      );
      setActiveItem(item);
      setActionFocusRequest((current) =>
        options.focusActions ? current + 1 : 0,
      );
      setSheetOpen(true);
    },
    [captureFocus, organizationId, spaceId],
  );

  const openActionArea = useCallback(
    (item: WorkItemViewModel) => {
      open(item, { focusActions: true });
    },
    [open],
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

  useEffect(() => {
    if (requestedNew === "task" && canCreateTask) {
      setCreateOpen(true);
    }
  }, [canCreateTask, requestedNew]);

  useEffect(() => {
    setFilters((current) => {
      if (current.intakeItemId === requestedIntakeItemId) {
        return current;
      }
      return { ...current, intakeItemId: requestedIntakeItemId };
    });
  }, [requestedIntakeItemId]);

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
    if (!requestedWorkItemId || !spaceId) {
      return;
    }

    const key = [
      "workItem",
      spaceId,
      requestedWorkItemId,
      requestedDetailPanel ?? "",
      requestedCommentId ?? "",
      requestedAttachmentId ?? "",
      requestedTimelineEventId ?? "",
    ].join(":");
    if (handledDeepLinkKey === key) {
      return;
    }

    const listed = taskViewModels.find(
      (item) => item.id === requestedWorkItemId,
    );
    if (listed) {
      open(listed);
      setHandledDeepLinkKey(key);
      return;
    }

    if (loading || !hasLoadedItems) {
      return;
    }

    let cancelled = false;
    void getWorkItem({
      organizationId,
      spaceId,
      workItemId: requestedWorkItemId,
    })
      .then((item) => {
        if (!cancelled) {
          open(
            toWorkItemListViewModel(item, {
              locale,
              lookups: {
                getMember,
                getVersion,
                getWorkflowState: workflowStateLookup.getState,
              },
              statusLabel: (category) => tStatus(category),
              workflowStateLabel: (state) =>
                translateWorkflowStateName(tApiError, state),
            }),
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
    hasLoadedItems,
    handledDeepLinkKey,
    loading,
    open,
    organizationId,
    requestedAttachmentId,
    requestedCommentId,
    requestedDetailPanel,
    requestedTimelineEventId,
    requestedWorkItemId,
    spaceId,
    taskViewModels,
    locale,
    tStatus,
    tApiError,
    workflowStateLookup.getState,
  ]);

  const focusRow = useCallback((itemId: string) => {
    rowRefs.current
      .get(itemId)
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, []);

  const select = useCallback(
    (item: WorkItemViewModel) => {
      setActiveItem(item);
      focusRow(item.id);
    },
    [focusRow],
  );

  useListKeyboardNav<WorkItemViewModel>({
    items: filtered,
    activeId: activeItem?.id,
    getId: (item) => item.id,
    onSelect: select,
    onOpen: open,
    onEdit: open,
    onSubmit: openActionArea,
    onClose: sheetOpen ? () => handleSheetOpenChange(false) : undefined,
  });

  const header = (
    <PageHeader
      eyebrow={tNav("group.deliver")}
      title={tNav("tasks")}
      description={t("page.description")}
      actions={
        <>
          {spaceId && (
            <Button
              variant={filterOpen ? "secondary" : "outline"}
              size="sm"
              className="text-xs"
              data-testid="tasks-filter-button"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
            >
              <Filter className="h-3 w-3" />
              {t("actions.filter")}
            </Button>
          )}
          {spaceId && canCreateTask && (
            <Button
              size="sm"
              className="text-xs"
              data-testid="tasks-create-button"
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
        <span data-testid="tasks-pagination-summary">
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
            data-testid="tasks-load-more"
            disabled={loadingMore}
            onClick={() => {
              void fetchTasks(pageInfo.page + 1, "append");
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
      <div data-testid="tasks-page" className="flex h-full min-w-0 flex-col">
        {header}
        <ListSkeleton />
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div data-testid="tasks-page" className="flex h-full min-w-0 flex-col">
        {header}
        <EmptyState
          title={t("states.noSpace.title")}
          description={t("states.noSpace.description")}
        />
      </div>
    );
  }

  return (
    <div data-testid="tasks-page" className="flex h-full min-w-0 flex-col">
      {header}

      <DimensionFilterHeader
        activeDimension={activeDimension}
        buckets={dimensionBuckets}
        dimensionAriaLabel={t("dimensionFilter.ariaLabel")}
        dimensionLabel={t("dimensionFilter.label")}
        dimensions={dimensionOptions}
        leadingContent={
          <div className="relative min-w-0">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 pl-7"
            />
          </div>
        }
        onDimensionChange={(dimension) =>
          setActiveDimension(dimension as TaskDimensionKey)
        }
        testId="tasks-dimension-filter"
      />

      {filterOpen && (
        <FilterPanel
          data-testid="tasks-filter-panel"
        >
          <FilterField label={tFilters("version")}>
            <SelectMenu
              data-testid="tasks-filter-version"
              value={filters.versionId ?? ""}
              onChange={(event) => setFilter("versionId", event.target.value)}
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
              data-testid="tasks-filter-assignee"
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
              data-testid="tasks-filter-status"
              value={filters.statusCategory ?? ""}
              onChange={(event) =>
                setFilter("statusCategory", event.target.value)
              }
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
              data-testid="tasks-filter-priority"
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
          <FilterField label={tFilters("requirement")} width="lg">
            <SelectMenu
              data-testid="tasks-filter-requirement"
              value={filters.requirementId ?? ""}
              onChange={(event) =>
                setFilter("requirementId", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              contentClassName="w-72"
            >
              <option value="">{tFilters("allRequirements")}</option>
              {requirements.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.title || requirement.id}
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
                setDimensionFilter("tagId", undefined);
              }}
              selectedTags={selectedFilterTags}
              showMatchMode={false}
              value={tagFilter}
              data-testid="tasks-filter-tags"
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
              void fetchTasks();
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
              data-testid="tasks-list"
              role="list"
              aria-label={tNav("tasks")}
              className="divide-y divide-border"
            >
              {filtered.map((item) => (
                <li
                  key={item.id}
                  data-testid="tasks-row"
                  data-id={item.id}
                  ref={(node) => {
                    if (node) {
                      rowRefs.current.set(item.id, node);
                    } else {
                      rowRefs.current.delete(item.id);
                    }
                  }}
                  aria-current={activeItem?.id === item.id ? "true" : undefined}
                >
                  <WorkItemRow
                    item={item}
                    onSelect={open}
                    selected={activeItem?.id === item.id}
                  />
                </li>
              ))}
            </ul>
            {paginationFooter}
          </>
        )}
      </div>

      <TaskDetailSheet
        actionFocusRequest={actionFocusRequest}
        focusedAttachmentId={
          activeItem?.id === requestedWorkItemId
            ? requestedAttachmentId
            : undefined
        }
        focusedCommentId={
          activeItem?.id === requestedWorkItemId ? requestedCommentId : undefined
        }
        focusedTimelineEventId={
          activeItem?.id === requestedWorkItemId
            ? requestedTimelineEventId
            : undefined
        }
        initialPanel={
          activeItem?.id === requestedWorkItemId
            ? requestedDetailPanel
            : undefined
        }
        item={activeItem}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        organizationId={activeItem?.organizationId ?? organizationId}
        spaceId={activeItem?.spaceId ?? spaceId}
        onChanged={() => {
          reloadTagFilterOptions();
          void fetchTasks(1, "replace");
        }}
      />

      {spaceId && canCreateTask && (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          spaceId={spaceId}
          onCreated={() => {
            reloadTagFilterOptions();
            void fetchTasks(1, "replace");
          }}
        />
      )}
    </div>
  );
}

function normalizeSearchParam(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeSearchQuery(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeStatusCategory(
  value: string | null,
): StatusCategory | undefined {
  const normalized = normalizeSearchParam(value);
  return STATUS_FILTERS.includes(normalized as StatusCategory)
    ? (normalized as StatusCategory)
    : undefined;
}

function resolveDimensionCounts(
  result: ListWorkItemsResponse,
): WorkItemDimensionCount[] {
  const dimensionCounts = result.dimensionCounts;

  if (dimensionCounts) {
    return dimensionCounts;
  }

  return [
    {
      buckets: (result.statusCategoryCounts ?? []).map((entry) => ({
        count: entry.count,
        value: entry.statusCategory,
      })),
      dimension: "statusCategory",
      total: getAllStatusCategoryCount(
        result.statusCategoryCounts ?? [],
        result.total ?? result.items.length,
      ),
    },
  ];
}

function createTaskDimensionBuckets({
  activeDimension,
  dimensionCounts,
  filters,
  getMember,
  getVersion,
  onSelect,
  pageTotal,
  requirements,
  tagFilter,
  tagFilterOptions,
  t,
  tPriority,
  tStatus,
}: {
  activeDimension: TaskDimensionKey;
  dimensionCounts: readonly WorkItemDimensionCount[];
  filters: TaskListFilterState;
  getMember: (id: string) =>
    | { user: { name?: string | null; username?: string | null } }
    | undefined;
  getVersion: (id: string) => { name?: string | null } | undefined;
  onSelect: (
    dimension: TaskDimensionKey,
    value: string | null | undefined,
  ) => void;
  pageTotal: number;
  requirements: readonly Requirement[];
  tagFilter: { tagIds: readonly string[] };
  tagFilterOptions: readonly TagDto[];
  t: (key: string) => string;
  tPriority: (key: Priority) => string;
  tStatus: (key: StatusCategory) => string;
}): DimensionFilterBucket[] {
  const countSet = getDimensionCountSet(dimensionCounts, activeDimension);
  const allCount = countSet?.total ?? pageTotal;
  const selectedValue = getTaskDimensionSelectedValue(
    activeDimension,
    filters,
    tagFilter.tagIds,
  );
  const buckets: DimensionFilterBucket[] = [
    {
      active: selectedValue === undefined,
      count: allCount,
      key: "__all",
      label: t("buckets.all"),
      onSelect: () => onSelect(activeDimension, undefined),
      testKey: "all",
    },
  ];

  for (const bucket of createOrderedTaskCountBuckets(
    activeDimension,
    countSet?.buckets ?? [],
  )) {
    const key = bucket.value ?? "__none";
    const label = getTaskDimensionBucketLabel({
      dimension: activeDimension,
      getMember,
      getVersion,
      requirements,
      tagFilterOptions,
      t,
      tPriority,
      tStatus,
      value: bucket.value,
    });

    buckets.push({
      active: selectedValue === bucket.value,
      count: bucket.count,
      key,
      label,
      onSelect: () => onSelect(activeDimension, bucket.value),
      testKey: bucket.value ?? "none",
      title: label,
    });
  }

  return buckets;
}

function selectTaskDimensionBucket({
  dimension,
  setDimensionFilter,
  setSelectedTags,
  setTagFilter,
  tagFilterOptions,
  tagMatch,
  value,
}: {
  dimension: TaskDimensionKey;
  setDimensionFilter: (
    dimension: TaskDimensionKey,
    value: string | null | undefined,
  ) => void;
  setSelectedTags: (value: TagDto[]) => void;
  setTagFilter: (value: { tagIds: string[]; tagMatch: TagMatch }) => void;
  tagFilterOptions: readonly TagDto[];
  tagMatch: TagMatch;
  value: string | null | undefined;
}) {
  if (dimension === "tagId") {
    const nextTags = value
      ? tagFilterOptions.filter((tag) => tag.id === value)
      : [];
    setSelectedTags(nextTags);
    setTagFilter({
      tagIds: value ? [value] : [],
      tagMatch,
    });
    setDimensionFilter("tagId", value);
    return;
  }

  setDimensionFilter(dimension, value);
}

function getTaskDimensionSelectedValue(
  dimension: TaskDimensionKey,
  filters: TaskListFilterState,
  tagIds: readonly string[],
): string | null | undefined {
  if (dimension === "tagId") {
    if (filters.noTags) {
      return null;
    }

    return tagIds.length === 1 ? tagIds[0] : undefined;
  }

  if (dimension === "assigneeId" && filters.unassigned) {
    return null;
  }
  if (dimension === "versionId" && filters.noVersion) {
    return null;
  }
  if (dimension === "requirementId" && filters.noRequirement) {
    return null;
  }

  return filters[dimension];
}

function getDimensionCountSet(
  counts: readonly WorkItemDimensionCount[],
  dimension: string,
) {
  return counts.find((entry) => entry.dimension === dimension);
}

function createOrderedTaskCountBuckets(
  dimension: TaskDimensionKey,
  buckets: readonly WorkItemDimensionCount["buckets"][number][],
): WorkItemDimensionCount["buckets"][number][] {
  const byValue = new Map(buckets.map((bucket) => [bucket.value, bucket]));

  if (dimension === "statusCategory") {
    return STATUS_FILTERS.map((status) => ({
      count: byValue.get(status)?.count ?? 0,
      value: status,
    }));
  }

  if (dimension === "priority") {
    return PRIORITY_FILTERS.map((priority) => ({
      count: byValue.get(priority)?.count ?? 0,
      value: priority,
    }));
  }

  return [...buckets].sort((left, right) => {
    if (left.value === null) {
      return -1;
    }
    if (right.value === null) {
      return 1;
    }

    return right.count - left.count;
  });
}

function getTaskDimensionBucketLabel({
  dimension,
  getMember,
  getVersion,
  requirements,
  tagFilterOptions,
  t,
  tPriority,
  tStatus,
  value,
}: {
  dimension: TaskDimensionKey;
  getMember: (id: string) =>
    | { user: { name?: string | null; username?: string | null } }
    | undefined;
  getVersion: (id: string) => { name?: string | null } | undefined;
  requirements: readonly Requirement[];
  tagFilterOptions: readonly TagDto[];
  t: (key: string) => string;
  tPriority: (key: Priority) => string;
  tStatus: (key: StatusCategory) => string;
  value: string | null;
}): string {
  if (value === null) {
    switch (dimension) {
      case "assigneeId":
        return t("dimensionFilter.buckets.unassigned");
      case "versionId":
        return t("dimensionFilter.buckets.noVersion");
      case "requirementId":
        return t("dimensionFilter.buckets.noRequirement");
      case "tagId":
        return t("dimensionFilter.buckets.noTag");
      case "priority":
      case "statusCategory":
        return "";
    }
  }

  switch (dimension) {
    case "assigneeId": {
      const member = getMember(value);
      return member?.user.name || member?.user.username || value;
    }
    case "priority":
      return tPriority(value as Priority);
    case "requirementId":
      return (
        requirements.find((requirement) => requirement.id === value)?.title ||
        value
      );
    case "statusCategory":
      return tStatus(value as StatusCategory);
    case "tagId": {
      const tag = tagFilterOptions.find((item) => item.id === value);
      return tag ? formatTagDisplayName(tag) : value;
    }
    case "versionId":
      return getVersion(value)?.name || value;
  }
}

function applyTaskDimensionFilter(
  current: TaskListFilterState,
  dimension: keyof TaskListFilterState | "tagId",
  value: string | null | undefined,
): TaskListFilterState {
  const next: TaskListFilterState = { ...current };

  switch (dimension) {
    case "assigneeId":
      next.assigneeId = typeof value === "string" ? value : undefined;
      next.unassigned = value === null ? true : undefined;
      break;
    case "versionId":
      next.versionId = typeof value === "string" ? value : undefined;
      next.noVersion = value === null ? true : undefined;
      break;
    case "requirementId":
      next.requirementId = typeof value === "string" ? value : undefined;
      next.noRequirement = value === null ? true : undefined;
      break;
    case "noTags":
    case "tagId":
      next.noTags = value === null ? true : undefined;
      break;
    default:
      next[dimension] = (value ?? undefined) as never;
      break;
  }

  return next;
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

function createTaskListScopeKey({
  filters,
  organizationId,
  spaceId,
  tagIds,
  tagMatch,
}: {
  filters: TaskListFilterState;
  organizationId?: string;
  spaceId?: string;
  tagIds: readonly string[];
  tagMatch: string;
}): string {
  return [
    organizationId ?? "",
    spaceId ?? "",
    filters.assigneeId ?? "",
    filters.intakeItemId ?? "",
    filters.noRequirement ? "noRequirement" : "",
    filters.noTags ? "noTags" : "",
    filters.noVersion ? "noVersion" : "",
    filters.priority ?? "",
    filters.reporterId ?? "",
    filters.requirementId ?? "",
    filters.statusCategory ?? "",
    filters.unassigned ? "unassigned" : "",
    filters.versionId ?? "",
    tagIds.join(","),
    tagIds.length > 0 ? tagMatch : "",
  ].join("\u001f");
}
