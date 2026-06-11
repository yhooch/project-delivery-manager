"use client";

import {
  BugSeverity,
  BugView,
  ListBugsResponse,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  StatusCategory,
  TagDto,
  TagMatch,
  Version,
  WorkItem,
  WorkItemDimensionCount,
  WorkItemStatusCategoryCount,
} from "@project-delivery/shared";
import {
  Bug,
  Filter,
  GitBranch,
  Pencil,
  Plus,
  Search,
  XCircle,
} from "lucide-react";
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
import { resolveWorkItemDisplayCode } from "../../lib/display-code";
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
import {
  isRealtimeRefreshMode,
  resolveRefreshMode,
  shouldShowBlockingRefreshState,
  shouldSurfaceRefreshError,
  useRealtimeInvalidation,
  type RefreshModeOptions,
} from "../../lib/realtime";
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
import { Input } from "../ui/input";
import { StatusBadge } from "../ui/status-badge";
import { SelectMenu } from "../ui/select-menu";
import { Tip } from "../ui/tooltip";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import {
  DimensionFilterHeader,
  type DimensionFilterBucket,
  type DimensionFilterOption,
} from "../v2/dimension-filter-header";
import { FilterField, FilterPanel } from "../v2/filter-controls";
import { PageHeader } from "../v2/page-header";
import { ListItemMetaRow } from "../v2/list-item-meta-row";

import { TaskDetailSheet } from "../work-item/task-detail-sheet";
import { getApiErrorDetailLines } from "../work-item/api-error-details";
import { normalizeWorkItemDetailPanel } from "../work-item/work-item-detail-panel";
import { formatTagDisplayName, TagFilter } from "../tag";

import { CreateBugDialog } from "./create-bug-dialog";
import { EditBugDialog } from "./edit-bug-dialog";

const severityColor: Record<BugSeverity, string> = {
  BLOCKER: "bg-destructive text-destructive-foreground",
  CRITICAL: "bg-destructive/15 text-destructive",
  MAJOR: "bg-warning/15 text-warning",
  MINOR: "bg-info/15 text-info",
  TRIVIAL: "bg-muted text-muted-foreground",
};

type BugDimensionKey =
  | "assigneeId"
  | "createdById"
  | "priority"
  | "relatedTaskId"
  | "requirementId"
  | "severity"
  | "statusCategory"
  | "tagId"
  | "versionId";

type BugDimensionSelection = {
  dimension: BugDimensionKey;
  value?: string | null;
};

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
const BUG_DIMENSIONS: BugDimensionKey[] = [
  "statusCategory",
  "assigneeId",
  "createdById",
  "priority",
  "severity",
  "versionId",
  "requirementId",
  "relatedTaskId",
  "tagId",
];
const LIST_PAGE_SIZE = 100;
const INITIAL_PAGE_INFO = { page: 1, pageSize: LIST_PAGE_SIZE, total: 0 };
const BUGS_REALTIME_KEYS = ["bug-list"] as const;

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
  const apiRequestIdLabel = tApiError("errors.apiDetails.requestId");
  const optionsLoadFailedMessage = tApiError("common.states.optionsLoadFailed");
  const pageErrorTitle = t("states.error.title");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { currentSpace, status: sessionStatus } = useSession();
  const spaceId = currentSpace?.id;
  const organizationId = currentSpace?.organizationId;
  const { members, getMember } = useSpaceMembers(spaceId, organizationId);
  const { versions, getVersion } = useVersions(spaceId, organizationId);
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

  const [items, setItems] = useState<BugView[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [auxiliaryErrorMessage, setAuxiliaryErrorMessage] = useState<
    string | null
  >(null);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [actionFocusRequest, setActionFocusRequest] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<BugListFilterState>(() =>
    createInitialFilters(requestedVersionId),
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [relatedTasks, setRelatedTasks] = useState<WorkItem[]>([]);
  const [pageInfo, setPageInfo] = useState(INITIAL_PAGE_INFO);
  const [dimensionCounts, setDimensionCounts] = useState<
    WorkItemDimensionCount[]
  >([]);
  const [dimensionSelection, setDimensionSelection] =
    useState<BugDimensionSelection>(() => ({
      dimension: "statusCategory",
      value: requestedStatusCategory,
    }));
  const activeDimension = dimensionSelection.dimension;
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBug, setEditingBug] = useState<BugView | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [handledDeepLinkKey, setHandledDeepLinkKey] = useState<string | null>(
    null,
  );
  const { captureFocus, restoreFocus } = useFocusReturn();
  const canCreateBug = canCreateBugs(currentSpace?.role, currentSpace?.status);
  const [tagFilter, setTagFilter] = useUrlTagFilter({
    fixedTagMatch: "ANY",
    pathname,
    router,
    searchParams,
  });
  const effectiveFilters = useMemo(
    () => buildBugListFilters(filters, dimensionSelection),
    [dimensionSelection, filters],
  );
  const effectiveTagFilter = useMemo(
    () => buildBugTagFilter(tagFilter, dimensionSelection),
    [dimensionSelection, tagFilter],
  );
  const listScopeKey = useMemo(
    () =>
      createBugListScopeKey({
        filters: effectiveFilters,
        organizationId,
        spaceId,
        tagIds: effectiveTagFilter.tagIds,
        tagMatch: effectiveTagFilter.tagMatch,
      }),
    [effectiveFilters, effectiveTagFilter, organizationId, spaceId],
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
  const activeDimensionRef = useRef(activeDimension);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const searchQuery = useMemo(() => normalizeSearchQuery(query), [query]);
  activeDimensionRef.current = activeDimension;
  latestListScopeKeyRef.current = listScopeKey;
  itemsLengthRef.current = items.length;
  pageInfoRef.current = pageInfo;
  const loadedCount = items.length;
  const paginationFrom = loadedCount > 0 ? 1 : 0;
  const paginationTo = Math.min(loadedCount, pageInfo.total);
  const hasMoreItems = loadedCount < pageInfo.total;
  const filteredRequirements = useMemo(
    () =>
      filterTraceOptionsByVersion(requirements, effectiveFilters.versionId ?? ""),
    [effectiveFilters.versionId, requirements],
  );
  const filteredRelatedTasks = useMemo(
    () =>
      filterTraceOptionsByVersion(relatedTasks, effectiveFilters.versionId ?? ""),
    [effectiveFilters.versionId, relatedTasks],
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
      setFilters((current) =>
        applyBugDimensionFilter(current, key, value || undefined),
      );
    },
    [],
  );
  const setDimensionFilter = useCallback(
    (dimension: BugDimensionKey, value: string | null | undefined) => {
      setDimensionSelection({ dimension, value });
    },
    [],
  );
  const clearFilterQuery = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (activeDimension !== "statusCategory") {
      params.delete("statusCategory");
    }
    params.delete("tagIds");
    params.delete("tagMatch");
    if (activeDimension !== "versionId") {
      params.delete("versionId");
    }
    const query = params.toString();

    router.replace((query ? `${pathname}?${query}` : pathname) as never, {
      scroll: false,
    });
  }, [activeDimension, pathname, router, searchParams]);
  const clearFilters = useCallback(() => {
    setFilters({});
    setSelectedTags([]);
    setTagFilter({ tagIds: [], tagMatch: tagFilter.tagMatch });
    clearFilterQuery();
  }, [clearFilterQuery, setSelectedTags, setTagFilter, tagFilter.tagMatch]);
  const handleDimensionChange = useCallback(
    (dimension: string) => {
      const nextDimension = dimension as BugDimensionKey;

      setDimensionSelection({ dimension: nextDimension });
      setFilters((current) => clearBugDimensionFilter(current, nextDimension));

      if (nextDimension === "tagId" && tagFilter.tagIds.length > 0) {
        setSelectedTags([]);
        setTagFilter({ tagIds: [], tagMatch: tagFilter.tagMatch });
      }
    },
    [setSelectedTags, setTagFilter, tagFilter],
  );
  const hasActiveFilters =
    hasActiveBugFilterState(filters) || tagFilter.tagIds.length > 0;
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
          noVersion: undefined,
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
      const selectedRequirement = requirements.find(
        (requirement) => requirement.id === nextRequirementId,
      );
      const inheritedVersionId =
        selectedRequirement?.versionId || filters.versionId || "";

      setFilters((current) => {
        const selectedRelatedTask = relatedTasks.find(
          (task) => task.id === current.relatedTaskId,
        );
        const nextVersionId =
          selectedRequirement?.versionId || current.versionId || "";

        return {
          ...current,
          noRequirement: undefined,
          noVersion: nextVersionId ? undefined : current.noVersion,
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
      if (activeDimension === "versionId") {
        setDimensionSelection((current) => {
          const emptyVersionValue =
            current.dimension === "versionId" && current.value === null
              ? null
              : undefined;

          return {
            dimension: "versionId",
            value: inheritedVersionId || emptyVersionValue,
          };
        });
      }
    },
    [activeDimension, filters.versionId, relatedTasks, requirements],
  );
  const setRelatedTaskFilter = useCallback(
    (nextRelatedTaskId: string) => {
      const selectedRelatedTask = relatedTasks.find(
        (task) => task.id === nextRelatedTaskId,
      );
      const inheritedVersionId =
        selectedRelatedTask?.versionId || filters.versionId || "";

      setFilters((current) => {
        const selectedRequirement = requirements.find(
          (requirement) => requirement.id === current.requirementId,
        );
        const nextVersionId =
          selectedRelatedTask?.versionId || current.versionId || "";

        return {
          ...current,
          noRelatedTask: undefined,
          noVersion: nextVersionId ? undefined : current.noVersion,
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
      if (activeDimension === "versionId") {
        setDimensionSelection((current) => {
          const emptyVersionValue =
            current.dimension === "versionId" && current.value === null
              ? null
              : undefined;

          return {
            dimension: "versionId",
            value: inheritedVersionId || emptyVersionValue,
          };
        });
      }
    },
    [activeDimension, filters.versionId, relatedTasks, requirements],
  );

  const fetchBugs = useCallback(
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
        const result = await listBugs({
          organizationId,
          page,
          pageSize,
          spaceId,
          type: "BUG",
          ...(searchQuery ? { query: searchQuery } : {}),
          ...effectiveFilters,
          ...(effectiveTagFilter.tagIds.length > 0
            ? serializeTagFilterQuery(effectiveTagFilter)
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
        setAuxiliaryErrorMessage(null);
        setPageInfo({
          page: realtimeRefresh ? pageInfoRef.current.page : (result.page ?? page),
          pageSize: result.pageSize ?? pageSize,
          total: result.total ?? result.items.length,
        });
        setDimensionCounts(resolveBugDimensionCounts(result));
      } catch (error) {
        if (
          listRequestIdRef.current === requestId &&
          latestListScopeKeyRef.current === requestScopeKey
        ) {
          if (shouldSurfaceRefreshError(refreshMode) && !keepCurrentItems) {
            const key = getApiErrorMessageKey(error);
            setErrorMessage(
              formatApiErrorMessage(
                tApiError(key),
                getApiErrorDetailLines(error, {
                  requestIdLabel: apiRequestIdLabel,
                }),
              ),
            );
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
      apiRequestIdLabel,
      effectiveFilters,
      effectiveTagFilter,
      listScopeKey,
      organizationId,
      searchQuery,
      spaceId,
      tApiError,
    ],
  );

  useEffect(() => {
    if (spaceId) {
      void fetchBugs(1, "replace", { mode: "initial" });
    } else {
      listRequestIdRef.current += 1;
      setItems([]);
      setPageInfo(INITIAL_PAGE_INFO);
      setDimensionCounts([]);
      setLoading(false);
      setLoadingMore(false);
      setHasLoadedItems(false);
    }
  }, [fetchBugs, spaceId]);

  useRealtimeInvalidation(BUGS_REALTIME_KEYS, () => {
    void fetchBugs(1, "replace", { mode: "realtime" });
  });

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
    setAuxiliaryErrorMessage(null);
    setDetailRevision((revision) => revision + 1);
    setHandledDeepLinkKey(null);
  }, [contextKey]);

  useEffect(() => {
    if (
      (!filterOpen &&
        activeDimension !== "requirementId" &&
        activeDimension !== "relatedTaskId") ||
      !spaceId
    ) {
      return;
    }

    let cancelled = false;
    setAuxiliaryErrorMessage(null);

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
      .catch((error) => {
        if (!cancelled) {
          setRequirements([]);
          setRelatedTasks([]);
          setAuxiliaryErrorMessage(
            formatApiErrorMessage(
              optionsLoadFailedMessage,
              getApiErrorDetailLines(error, {
                requestIdLabel: apiRequestIdLabel,
              }),
            ),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeDimension,
    apiRequestIdLabel,
    filterOpen,
    optionsLoadFailedMessage,
    organizationId,
    spaceId,
  ]);

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
      const itemOrganizationId = bug.organizationId ?? organizationId;
      const itemSpaceId = bug.spaceId ?? spaceId;

      recordRecentOpen(
        {
          id: bug.id,
          type: "BUG",
          displayCode: bug.code,
          title: bug.title,
          href: `/bugs?bugId=${encodeURIComponent(bug.id)}`,
          organizationId: itemOrganizationId,
          spaceId: itemSpaceId,
        },
        { organizationId: itemOrganizationId, spaceId: itemSpaceId },
      );
      setActiveItem(bug);
      setAuxiliaryErrorMessage(null);
      setActionFocusRequest((current) =>
        options.focusActions ? current + 1 : 0,
      );
      setSheetOpen(true);
    },
    [captureFocus, organizationId, spaceId],
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
    const currentActiveDimension = activeDimensionRef.current;

    setFilters((current) => {
      const nextStatusCategory =
        currentActiveDimension === "statusCategory"
          ? undefined
          : requestedStatusCategory;
      const nextVersionId =
        currentActiveDimension === "versionId" ? undefined : requestedVersionId;

      if (
        current.statusCategory === nextStatusCategory &&
        current.versionId === nextVersionId
      ) {
        return current;
      }
      return {
        ...current,
        statusCategory: nextStatusCategory,
        versionId: nextVersionId,
      };
    });
    setDimensionSelection((current) => {
      if (
        current.dimension !== "statusCategory" &&
        current.dimension !== "versionId"
      ) {
        return current;
      }

      const nextValue =
        current.dimension === "statusCategory"
          ? requestedStatusCategory
          : requestedVersionId;

      return current.value === nextValue
        ? current
        : { ...current, value: nextValue };
    });
  }, [requestedStatusCategory, requestedVersionId]);

  useEffect(() => {
    if (!requestedBugId || !spaceId) {
      return;
    }

    const key = [
      "bug",
      spaceId,
      requestedBugId,
      requestedDetailPanel ?? "",
      requestedCommentId ?? "",
      requestedAttachmentId ?? "",
      requestedTimelineEventId ?? "",
    ].join(":");
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
      .catch((error) => {
        if (!cancelled) {
          setAuxiliaryErrorMessage(
            formatApiErrorMessage(
              pageErrorTitle,
              getApiErrorDetailLines(error, {
                requestIdLabel: apiRequestIdLabel,
              }),
            ),
          );
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
    requestedAttachmentId,
    requestedBugId,
    requestedCommentId,
    requestedDetailPanel,
    requestedTimelineEventId,
    spaceId,
    apiRequestIdLabel,
    pageErrorTitle,
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

  const dimensionOptions: DimensionFilterOption[] = useMemo(
    () =>
      BUG_DIMENSIONS.map((dimension) => ({
        key: dimension,
        label: t(`dimensionFilter.dimensions.${dimension}`),
      })),
    [t],
  );

  const dimensionBuckets = useMemo(
    () =>
      createBugDimensionBuckets({
        activeDimension,
        dimensionCounts,
        getMember,
        getVersion,
        onSelect: (dimension, value) => {
          selectBugDimensionBucket({
            dimension,
            setDimensionFilter,
            value,
          });
        },
        pageTotal: pageInfo.total,
        relatedTasks,
        requirements,
        tagFilterOptions,
        t,
        tPriority,
        tSeverity,
        tStatus,
        value: dimensionSelection.value,
      }),
    [
      activeDimension,
      dimensionCounts,
      dimensionSelection.value,
      getMember,
      getVersion,
      pageInfo.total,
      relatedTasks,
      requirements,
      setDimensionFilter,
      tagFilterOptions,
      t,
      tPriority,
      tSeverity,
      tStatus,
    ],
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
        onDimensionChange={handleDimensionChange}
        optionTestId="bugs-filter-option"
        testId="bugs-dimension-filter"
      />

      {filterOpen && (
        <FilterPanel
          data-testid="bugs-filter-panel"
        >
          {activeDimension !== "versionId" ? (
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
          ) : null}
          {activeDimension !== "assigneeId" ? (
            <FilterField label={tFilters("assignee")}>
              <SelectMenu
                data-testid="bugs-filter-assignee"
                value={filters.assigneeId ?? ""}
                onChange={(event) =>
                  setFilter("assigneeId", event.target.value)
                }
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
          ) : null}
          {activeDimension !== "createdById" ? (
            <FilterField label={tFilters("creator")}>
              <SelectMenu
                data-testid="bugs-filter-creator"
                value={filters.createdById ?? ""}
                onChange={(event) =>
                  setFilter("createdById", event.target.value)
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">{tFilters("allCreators")}</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name || member.user.username}
                  </option>
                ))}
              </SelectMenu>
            </FilterField>
          ) : null}
          {activeDimension !== "statusCategory" ? (
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
          ) : null}
          {activeDimension !== "priority" ? (
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
          ) : null}
          {activeDimension !== "severity" ? (
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
          ) : null}
          {activeDimension !== "requirementId" ? (
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
          ) : null}
          {activeDimension !== "relatedTaskId" ? (
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
          ) : null}
          {activeDimension !== "tagId" ? (
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
          ) : null}
          {hasActiveFilters ? (
            <div className="flex h-8 items-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                data-testid="bugs-filter-clear"
                onClick={clearFilters}
                type="button"
              >
                <XCircle className="h-3 w-3" />
                {tFilters("clear")}
              </Button>
            </div>
          ) : null}
        </FilterPanel>
      )}

      {auxiliaryErrorMessage && (
        <AuxiliaryErrorNotice message={auxiliaryErrorMessage} />
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
                      <Bug className="mt-0.5 h-3.5 w-3.5 shrink-0 self-start text-destructive/80" />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            {bug.code}
                          </span>
                          <span className="truncate text-[13px] font-medium">
                            {bug.title}
                          </span>
                        </span>
                        <ListItemMetaRow
                          createdAt={bug.createdAt}
                          creatorName={bug.creatorName}
                          tags={bug.tags}
                        />
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
        focusedAttachmentId={
          activeItem?.id === requestedBugId ? requestedAttachmentId : undefined
        }
        focusedCommentId={
          activeItem?.id === requestedBugId ? requestedCommentId : undefined
        }
        focusedTimelineEventId={
          activeItem?.id === requestedBugId
            ? requestedTimelineEventId
            : undefined
        }
        initialPanel={
          activeItem?.id === requestedBugId ? requestedDetailPanel : undefined
        }
        item={activeItem}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        organizationId={activeItem?.organizationId ?? organizationId}
        spaceId={activeItem?.spaceId ?? spaceId}
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
  const code = resolveWorkItemDisplayCode(bug);
  const member = bug.assigneeId ? lookups.getMember(bug.assigneeId) : undefined;
  const assigneeName = member?.user.name ?? member?.user.username ?? "";
  const creatorId = bug.createdById ?? bug.reporterId;
  const creator = lookups.getMember(creatorId);
  const creatorName = creator?.user.name ?? creator?.user.username ?? creatorId;
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
    organizationId: bug.organizationId,
    spaceId: bug.spaceId,
    title: bug.title,
    workflowVersionId: bug.workflowVersionId,
    currentStateId: bug.currentStateId,
    statusCategory: bug.statusCategory,
    statusLabel,
    priority: bug.priority,
    assignee: { name: assigneeName, initial },
    creatorName,
    createdAt: bug.createdAt,
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

function normalizeSearchQuery(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function createInitialFilters(versionId: string | undefined): BugListFilterState {
  return {
    ...(versionId ? { versionId } : {}),
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

function resolveBugDimensionCounts(
  result: ListBugsResponse,
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

function createBugDimensionBuckets({
  activeDimension,
  dimensionCounts,
  getMember,
  getVersion,
  onSelect,
  pageTotal,
  relatedTasks,
  requirements,
  tagFilterOptions,
  t,
  tPriority,
  tSeverity,
  tStatus,
  value,
}: {
  activeDimension: BugDimensionKey;
  dimensionCounts: readonly WorkItemDimensionCount[];
  getMember: (id: string) => SpaceMemberWithUser | undefined;
  getVersion: (id: string) => Version | undefined;
  onSelect: (
    dimension: BugDimensionKey,
    value: string | null | undefined,
  ) => void;
  pageTotal: number;
  relatedTasks: readonly WorkItem[];
  requirements: readonly Requirement[];
  tagFilterOptions: readonly TagDto[];
  t: (key: string) => string;
  tPriority: (key: Priority) => string;
  tSeverity: (key: BugSeverity) => string;
  tStatus: (key: StatusCategory) => string;
  value?: string | null;
}): DimensionFilterBucket[] {
  const countSet = getDimensionCountSet(dimensionCounts, activeDimension);
  const allCount = countSet?.total ?? pageTotal;
  const selectedValue = value;
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

  for (const bucket of createOrderedBugCountBuckets(
    activeDimension,
    countSet?.buckets ?? [],
  )) {
    const key = bucket.value ?? "__none";
    const label = getBugDimensionBucketLabel({
      dimension: activeDimension,
      getMember,
      getVersion,
      relatedTasks,
      requirements,
      tagFilterOptions,
      t,
      tPriority,
      tSeverity,
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

function selectBugDimensionBucket({
  dimension,
  setDimensionFilter,
  value,
}: {
  dimension: BugDimensionKey;
  setDimensionFilter: (
    dimension: BugDimensionKey,
    value: string | null | undefined,
  ) => void;
  value: string | null | undefined;
}) {
  setDimensionFilter(dimension, value);
}

function getDimensionCountSet(
  counts: readonly WorkItemDimensionCount[],
  dimension: string,
) {
  return counts.find((entry) => entry.dimension === dimension);
}

function createOrderedBugCountBuckets(
  dimension: BugDimensionKey,
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

  if (dimension === "severity") {
    return SEVERITY_FILTERS.map((severity) => ({
      count: byValue.get(severity)?.count ?? 0,
      value: severity,
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

function getBugDimensionBucketLabel({
  dimension,
  getMember,
  getVersion,
  relatedTasks,
  requirements,
  tagFilterOptions,
  t,
  tPriority,
  tSeverity,
  tStatus,
  value,
}: {
  dimension: BugDimensionKey;
  getMember: (id: string) => SpaceMemberWithUser | undefined;
  getVersion: (id: string) => Version | undefined;
  relatedTasks: readonly WorkItem[];
  requirements: readonly Requirement[];
  tagFilterOptions: readonly TagDto[];
  t: (key: string) => string;
  tPriority: (key: Priority) => string;
  tSeverity: (key: BugSeverity) => string;
  tStatus: (key: StatusCategory) => string;
  value: string | null;
}): string {
  if (value === null) {
    switch (dimension) {
      case "assigneeId":
        return t("dimensionFilter.buckets.unassigned");
      case "createdById":
        return t("dimensionFilter.buckets.unknownCreator");
      case "relatedTaskId":
        return t("dimensionFilter.buckets.noRelatedTask");
      case "versionId":
        return t("dimensionFilter.buckets.noVersion");
      case "requirementId":
        return t("dimensionFilter.buckets.noRequirement");
      case "tagId":
        return t("dimensionFilter.buckets.noTag");
      case "priority":
      case "severity":
      case "statusCategory":
        return "";
    }
  }

  switch (dimension) {
    case "assigneeId":
    case "createdById": {
      const member = getMember(value);
      return member?.user.name || member?.user.username || value;
    }
    case "priority":
      return tPriority(value as Priority);
    case "relatedTaskId":
      return relatedTasks.find((task) => task.id === value)?.title || value;
    case "requirementId":
      return (
        requirements.find((requirement) => requirement.id === value)?.title ||
        value
      );
    case "severity":
      return tSeverity(value as BugSeverity);
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

function applyBugDimensionFilter(
  current: BugListFilterState,
  dimension: keyof BugListFilterState | "tagId",
  value: string | null | undefined,
): BugListFilterState {
  const next: BugListFilterState = { ...current };

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
    case "relatedTaskId":
      next.relatedTaskId = typeof value === "string" ? value : undefined;
      next.noRelatedTask = value === null ? true : undefined;
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

function buildBugListFilters(
  filters: BugListFilterState,
  selection: BugDimensionSelection,
): BugListFilterState {
  const cleared = clearBugDimensionFilter(filters, selection.dimension);

  if (selection.value === undefined) {
    return cleared;
  }

  return applyBugDimensionFilter(
    cleared,
    selection.dimension,
    selection.value,
  );
}

function buildBugTagFilter(
  tagFilter: { tagIds: string[]; tagMatch: TagMatch },
  selection: BugDimensionSelection,
) {
  if (selection.dimension !== "tagId") {
    return tagFilter;
  }

  return {
    tagIds: typeof selection.value === "string" ? [selection.value] : [],
    tagMatch: tagFilter.tagMatch,
  };
}

function clearBugDimensionFilter(
  current: BugListFilterState,
  dimension: BugDimensionKey,
): BugListFilterState {
  const next: BugListFilterState = { ...current };
  let changed = false;
  const clear = (key: keyof BugListFilterState) => {
    if (next[key] !== undefined) {
      changed = true;
    }
    next[key] = undefined as never;
  };

  switch (dimension) {
    case "assigneeId":
      clear("assigneeId");
      clear("unassigned");
      break;
    case "createdById":
      clear("createdById");
      break;
    case "priority":
      clear("priority");
      break;
    case "relatedTaskId":
      clear("relatedTaskId");
      clear("noRelatedTask");
      break;
    case "requirementId":
      clear("requirementId");
      clear("noRequirement");
      break;
    case "severity":
      clear("severity");
      break;
    case "statusCategory":
      clear("statusCategory");
      break;
    case "tagId":
      clear("noTags");
      break;
    case "versionId":
      clear("versionId");
      clear("noVersion");
      break;
  }

  return changed ? next : current;
}

function hasActiveBugFilterState(filters: BugListFilterState): boolean {
  return Object.values(filters).some(Boolean);
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

function AuxiliaryErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive sm:px-6"
    >
      {message}
    </div>
  );
}

function formatApiErrorMessage(message: string, details: string[]): string {
  return [message, ...details].join(" ");
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
    filters.createdById ?? "",
    filters.noRelatedTask ? "noRelatedTask" : "",
    filters.noRequirement ? "noRequirement" : "",
    filters.noTags ? "noTags" : "",
    filters.noVersion ? "noVersion" : "",
    filters.priority ?? "",
    filters.relatedTaskId ?? "",
    filters.reporterId ?? "",
    filters.requirementId ?? "",
    filters.severity ?? "",
    filters.statusCategory ?? "",
    filters.unassigned ? "unassigned" : "",
    filters.versionId ?? "",
    tagIds.join(","),
    tagIds.length > 0 ? tagMatch : "",
  ].join("\u001f");
}
