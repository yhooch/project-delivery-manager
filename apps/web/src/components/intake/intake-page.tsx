"use client";

import type {
  IntakeItem,
  IntakeSourceType,
  IntakeStatus,
  IntakeStatusCount,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  StatusCategory,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import {
  ArrowRight,
  Filter,
  GitBranch,
  Pencil,
  Plus,
  Target,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { resolveIntakeDisplayCode } from "../../lib/display-code";
import {
  useFocusReturn,
  useListKeyboardNav,
} from "../../lib/hooks/use-list-keyboard-nav";
import { useTagFilterOptions } from "../../lib/hooks/use-tag-filter-options";
import { useTagFilterSelection } from "../../lib/hooks/use-tag-filter-selection";
import { useUrlTagFilter } from "../../lib/hooks/use-url-tag-filter";
import {
  acceptIntakeItem,
  deferIntakeItem,
  getIntakeItem,
  listIntakeItems,
  rejectIntakeItem,
  type IntakeListFilterState,
} from "../../lib/intake-service";
import { usePathname, useRouter } from "../../i18n/routing";
import { listRequirements } from "../../lib/requirement-service";
import {
  isRealtimeRefreshMode,
  realtimeContextIncludesTarget,
  resolveRefreshMode,
  shouldShowBlockingRefreshState,
  shouldSurfaceRefreshError,
  useRealtimeInvalidation,
  type RefreshModeOptions,
} from "../../lib/realtime";
import { serializeTagFilterQuery } from "../../lib/tag-query";
import { cn } from "../../lib/utils";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import {
  filterTraceOptionsByVersion,
  isTraceOptionCompatibleWithVersion,
} from "../../lib/versioned-trace-linking";
import {
  toWorkItemListViewModel,
  type WorkItemViewModel,
} from "../../lib/v2/work-item-view-model";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";
import { TagFilter } from "../tag";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { SelectMenu } from "../ui/select-menu";
import { Tip } from "../ui/tooltip";
import { PageHeader } from "../v2/page-header";
import { FilterField, FilterPanel } from "../v2/filter-controls";
import { ListItemMetaRow } from "../v2/list-item-meta-row";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
} from "../v2/states";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";

import { ConvertIntakeDialog } from "./convert-intake-dialog";
import { CreateIntakeDialog } from "./create-intake-dialog";
import { EditIntakeDialog } from "./edit-intake-dialog";
import { IntakeDetailSheet } from "./intake-detail-sheet";

const priorityDot: Record<Priority, string> = {
  LOW: "bg-muted-foreground/40",
  MEDIUM: "bg-info",
  HIGH: "bg-warning",
  URGENT: "bg-destructive",
};

const SOURCE_TYPES: IntakeSourceType[] = [
  "REQUIREMENT_CHANGE",
  "DEFECT_PROBLEM",
  "PROJECT_PLAN",
  "MEETING_DECISION",
  "AD_HOC",
  "IMPLEMENTATION",
  "OPERATIONS",
  "RELEASE",
  "EXTERNAL_COLLABORATION",
];

const PRIORITY_FILTERS: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const LIST_PAGE_SIZE = 100;
const INITIAL_PAGE_INFO = { page: 1, pageSize: LIST_PAGE_SIZE, total: 0 };
const INTAKE_REALTIME_KEYS = ["intake-list"] as const;

const intakeStatusToCategory: Record<IntakeStatus, StatusCategory> = {
  PENDING: "NOT_STARTED",
  ACCEPTED: "IN_PROGRESS",
  DEFERRED: "WAITING",
  REJECTED: "TERMINATED",
  CONVERTED: "DONE",
};

type FilterKey =
  | "all"
  | "PENDING"
  | "ACCEPTED"
  | "DEFERRED"
  | "REJECTED"
  | "CONVERTED";

type StatusActionKind = "accept" | "defer" | "reject";

export function IntakePage() {
  const t = useTranslations("intake");
  const tNav = useTranslations("shell.nav");
  const tIntakeItems = useTranslations("intakeItems");
  const tTags = useTranslations("tags.field");
  const tRoot = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requestedIntakeItemId = normalizeSearchParam(searchParams.get("id"));
  const requestedCommentId = normalizeSearchParam(searchParams.get("commentId"));
  const requestedTimelineEventId = normalizeSearchParam(
    searchParams.get("eventId"),
  );
  const [tagFilter, setTagFilter] = useUrlTagFilter({
    fixedTagMatch: "ANY",
    pathname,
    router,
    searchParams,
  });
  const { currentSpace, session, status: sessionStatus } = useSession();
  const spaceId = session?.defaultSpaceId;
  const organizationId = session?.defaultOrganizationId;
  const sessionSpace = session?.spaces?.find((space) => space.id === spaceId);
  const currentSpaceRole = currentSpace?.role ?? sessionSpace?.role;
  const currentSpaceStatus = currentSpace?.status ?? sessionSpace?.status;
  const canCreateOrCommentIntake = canCreateOrCommentIntakeItem(
    currentSpaceRole,
    currentSpaceStatus,
  );
  const canManageIntake = canManageIntakeItem(
    currentSpaceRole,
    currentSpaceStatus,
  );
  const { members, getMember } = useSpaceMembers(spaceId, organizationId);
  const { versions, getVersion } = useVersions(spaceId, organizationId);

  const [items, setItems] = useState<IntakeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [listFilters, setListFilters] = useState<IntakeListFilterState>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [active, setActive] = useState<IntakeItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<IntakeItem | null>(null);
  const [actionInFlight, setActionInFlight] = useState<StatusActionKind | null>(
    null,
  );
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pageInfo, setPageInfo] = useState(INITIAL_PAGE_INFO);
  const [statusCounts, setStatusCounts] = useState<IntakeStatusCount[]>([]);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<IntakeItem | null>(null);
  const [selectedTask, setSelectedTask] = useState<WorkItemViewModel | null>(
    null,
  );
  const activeOrganizationId = active?.organizationId ?? organizationId;
  const activeSpaceId = active?.spaceId ?? spaceId;
  const selectedTaskOrganizationId =
    selectedTask?.organizationId ?? activeOrganizationId;
  const selectedTaskSpaceId = selectedTask?.spaceId ?? activeSpaceId;
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [relatedTasksRefreshVersion, setRelatedTasksRefreshVersion] =
    useState(0);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [handledDeepLinkKey, setHandledDeepLinkKey] = useState<string | null>(
    null,
  );
  const { captureFocus, restoreFocus } = useFocusReturn();
  const listScopeKey = useMemo(
    () =>
      createIntakeListScopeKey({
        filter,
        listFilters,
        organizationId,
        spaceId,
        tagIds: tagFilter.tagIds,
        tagMatch: tagFilter.tagMatch,
      }),
    [filter, listFilters, organizationId, spaceId, tagFilter],
  );
  const contextKey = useMemo(
    () => `${organizationId ?? ""}:${spaceId ?? ""}`,
    [organizationId, spaceId],
  );
  const latestListScopeKeyRef = useRef(listScopeKey);
  const listRequestIdRef = useRef(0);
  const pageInfoRef = useRef(pageInfo);
  const previousContextKeyRef = useRef(contextKey);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const primaryActionButtonRef = useRef<HTMLButtonElement | null>(null);
  latestListScopeKeyRef.current = listScopeKey;
  pageInfoRef.current = pageInfo;
  const loadedCount = items.length;
  const paginationFrom = loadedCount > 0 ? 1 : 0;
  const paginationTo = Math.min(loadedCount, pageInfo.total);
  const hasMoreItems = loadedCount < pageInfo.total;
  const { items: tagFilterOptions, reload: reloadTagFilterOptions } =
    useTagFilterOptions({
      organizationId,
      scope: "INTAKE_ITEM",
      spaceId,
    });
  const { selectedTags: selectedFilterTags, setSelectedTags } =
    useTagFilterSelection({
      organizationId,
      sourceTags: tagFilterOptions,
      spaceId,
      tagIds: tagFilter.tagIds,
    });
  const filteredRequirements = useMemo(
    () =>
      filterTraceOptionsByVersion(requirements, listFilters.versionId ?? ""),
    [listFilters.versionId, requirements],
  );

  const setListFilter = useCallback(
    (key: keyof IntakeListFilterState, value: string) => {
      setListFilters((current) => ({ ...current, [key]: value || undefined }));
    },
    [],
  );
  const setVersionFilter = useCallback(
    (nextVersionId: string) => {
      setListFilters((current) => {
        const selectedRequirement = requirements.find(
          (requirement) => requirement.id === current.requirementId,
        );

        return {
          ...current,
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
    [requirements],
  );
  const setRequirementFilter = useCallback(
    (nextRequirementId: string) => {
      setListFilters((current) => {
        const selectedRequirement = requirements.find(
          (requirement) => requirement.id === nextRequirementId,
        );
        const nextVersionId = selectedRequirement?.versionId;

        return {
          ...current,
          requirementId: nextRequirementId || undefined,
          versionId: nextVersionId || current.versionId,
        };
      });
    },
    [requirements],
  );
  const hasActiveFilters =
    hasActiveIntakeFilterState(listFilters) || tagFilter.tagIds.length > 0;
  const clearFilters = useCallback(() => {
    setListFilters({});
    setSelectedTags([]);
    setTagFilter({ tagIds: [], tagMatch: tagFilter.tagMatch });
  }, [setSelectedTags, setTagFilter, tagFilter.tagMatch]);

  const loadItems = useCallback(
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

      if (append) {
        setIsLoadingMore(true);
      } else if (shouldShowBlockingRefreshState(refreshMode)) {
        setIsLoading(true);
        setHasLoadedItems(false);
      }
      if (shouldSurfaceRefreshError(refreshMode)) {
        setErrorKey(null);
      }

      try {
        const result = await listIntakeItems({
          organizationId,
          page,
          pageSize,
          spaceId,
          status: filter === "all" ? undefined : filter,
          ...listFilters,
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
        setStatusCounts(result.statusCounts ?? []);
      } catch (error) {
        if (
          listRequestIdRef.current === requestId &&
          latestListScopeKeyRef.current === requestScopeKey
        ) {
          if (shouldSurfaceRefreshError(refreshMode)) {
            setErrorKey(getApiErrorMessageKey(error));
          }
        }
      } finally {
        if (
          listRequestIdRef.current === requestId &&
          latestListScopeKeyRef.current === requestScopeKey
        ) {
          if (append) {
            setIsLoadingMore(false);
          } else {
            setIsLoading(false);
          }
          setHasLoadedItems(true);
        }
      }
    },
    [filter, listFilters, listScopeKey, organizationId, spaceId, tagFilter],
  );

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !spaceId) {
      if (sessionStatus !== "loading") {
        listRequestIdRef.current += 1;
        setItems([]);
        setSelectedItem(null);
        setActive(null);
        setPageInfo(INITIAL_PAGE_INFO);
        setStatusCounts([]);
        setIsLoading(false);
        setIsLoadingMore(false);
        setHasLoadedItems(false);
      }
      return;
    }
    void loadItems(1, "replace", { mode: "initial" });
  }, [loadItems, sessionStatus, spaceId]);

  const refreshActiveItem = useCallback(
    async (options?: RefreshModeOptions) => {
      const target = active;
      const targetSpaceId = target?.spaceId ?? spaceId;
      if (!target || !targetSpaceId) {
        return;
      }

      try {
        const updated = await getIntakeItem({
          intakeItemId: target.id,
          organizationId: target.organizationId ?? organizationId,
          spaceId: targetSpaceId,
        });
        setItems((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        setSelectedItem((current) =>
          current?.id === updated.id ? updated : current,
        );
        setActive((current) =>
          current?.id === updated.id ? updated : current,
        );
        reloadTagFilterOptions();
      } catch (error) {
        const refreshMode = resolveRefreshMode(options);
        if (shouldSurfaceRefreshError(refreshMode)) {
          setActionErrorKey(getApiErrorMessageKey(error));
        }
      }
    },
    [active, organizationId, reloadTagFilterOptions, spaceId],
  );

  useRealtimeInvalidation(INTAKE_REALTIME_KEYS, (context) => {
    void loadItems(1, "replace", { mode: "realtime" });

    if (
      active &&
      realtimeContextIncludesTarget(context, {
        id: active.id,
        type: "INTAKE_ITEM",
      })
    ) {
      void refreshActiveItem({ mode: "realtime" });
    }
  });

  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) {
      return;
    }
    previousContextKeyRef.current = contextKey;
    setSelectedItem(null);
    setActive(null);
    setActionInFlight(null);
    setActionErrorKey(null);
    setCreateOpen(false);
    setEditOpen(false);
    setConvertOpen(false);
    setConvertTarget(null);
    setSelectedTask(null);
    setTaskSheetOpen(false);
    setRelatedTasksRefreshVersion(0);
    setFilterOpen(false);
    setRequirements([]);
    setHandledDeepLinkKey(null);
  }, [contextKey]);

  useEffect(() => {
    setSelectedTask(null);
    setTaskSheetOpen(false);
  }, [active?.id, contextKey]);

  useEffect(() => {
    if (!filterOpen || !spaceId) {
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
  }, [filterOpen, organizationId, spaceId]);

  const filtered = items;

  const buckets: { label: string; key: FilterKey; count: number }[] = useMemo(
    () => [
      {
        label: t("filters.all"),
        key: "all",
        count: getAllIntakeStatusCount(statusCounts, items.length),
      },
      {
        label: t("filters.pending"),
        key: "PENDING",
        count: getIntakeStatusCount(statusCounts, "PENDING"),
      },
      {
        label: t("filters.accepted"),
        key: "ACCEPTED",
        count: getIntakeStatusCount(statusCounts, "ACCEPTED"),
      },
      {
        label: t("filters.deferred"),
        key: "DEFERRED",
        count: getIntakeStatusCount(statusCounts, "DEFERRED"),
      },
      {
        label: tIntakeItems("status.REJECTED"),
        key: "REJECTED",
        count: getIntakeStatusCount(statusCounts, "REJECTED"),
      },
      {
        label: t("filters.converted"),
        key: "CONVERTED",
        count: getIntakeStatusCount(statusCounts, "CONVERTED"),
      },
    ],
    [items.length, statusCounts, t, tIntakeItems],
  );

  const openItem = useCallback(
    (item: IntakeItem) => {
      captureFocus();
      const itemOrganizationId = item.organizationId ?? organizationId;
      const itemSpaceId = item.spaceId ?? spaceId;

      recordRecentOpen(
        {
          id: item.id,
          type: "INTAKE",
          displayCode: formatItemCode(item),
          title: item.title,
          href: `/intake-items?id=${encodeURIComponent(item.id)}`,
          organizationId: itemOrganizationId,
          spaceId: itemSpaceId,
        },
        { organizationId: itemOrganizationId, spaceId: itemSpaceId },
      );
      setActive(item);
      setSelectedItem(item);
    },
    [captureFocus, organizationId, spaceId],
  );

  const focusRow = useCallback((itemId: string) => {
    rowRefs.current
      .get(itemId)
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, []);

  const focusPrimaryActionButton = useCallback(() => {
    [0, 16, 50].forEach((delay) => {
      window.setTimeout(() => {
        const target = primaryActionButtonRef.current;
        if (target && document.contains(target) && !target.disabled) {
          target.focus({ preventScroll: true });
        }
      }, delay);
    });
  }, []);

  const focusActionArea = useCallback(
    (item: IntakeItem) => {
      captureFocus();
      setSelectedItem(item);
      setActive(item);
      focusPrimaryActionButton();
    },
    [captureFocus, focusPrimaryActionButton],
  );

  useEffect(() => {
    if (!requestedIntakeItemId || !spaceId) {
      return;
    }

    const key = [
      "intake",
      spaceId,
      requestedIntakeItemId,
      requestedCommentId ?? "",
      requestedTimelineEventId ?? "",
    ].join(":");
    if (handledDeepLinkKey === key) {
      return;
    }

    const listed = items.find((item) => item.id === requestedIntakeItemId);
    if (listed) {
      openItem(listed);
      setHandledDeepLinkKey(key);
      return;
    }

    if (isLoading || !hasLoadedItems) {
      return;
    }

    let cancelled = false;
    void getIntakeItem({
      intakeItemId: requestedIntakeItemId,
      organizationId,
      spaceId,
    })
      .then((item) => {
        if (!cancelled) {
          openItem(item);
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
    handledDeepLinkKey,
    hasLoadedItems,
    isLoading,
    items,
    openItem,
    organizationId,
    requestedCommentId,
    requestedIntakeItemId,
    requestedTimelineEventId,
    spaceId,
  ]);

  useListKeyboardNav<IntakeItem>({
    items: filtered,
    activeId: selectedItem?.id ?? active?.id,
    getId: (item) => item.id,
    onSelect: (item) => {
      setSelectedItem(item);
      focusRow(item.id);
    },
    onOpen: openItem,
    onEdit: openItem,
    canAssign: () => canManageIntake,
    onAssign: (item) => {
      captureFocus();
      setSelectedItem(item);
      setActive(item);
      setEditOpen(true);
    },
    canSubmit: (item) => canSubmitIntakeItem(item, canManageIntake),
    onSubmit: focusActionArea,
    onClose: () => {
      setActive(null);
      setActionErrorKey(null);
    },
  });

  function handleCloseDrawer(open: boolean) {
    if (!open) {
      setActive(null);
      setActionErrorKey(null);
      setEditOpen(false);
      setSelectedTask(null);
      setTaskSheetOpen(false);
      restoreFocus();
    }
  }

  async function handleStatusAction(
    action: StatusActionKind,
    target: IntakeItem | null = active,
  ) {
    const targetOrganizationId = target?.organizationId ?? organizationId;
    const targetSpaceId = target?.spaceId ?? spaceId;

    if (!target || !targetSpaceId || !canManageIntake) {
      return;
    }

    setActionInFlight(action);
    setActionErrorKey(null);

    const original = items;
    const optimisticStatus: IntakeStatus =
      action === "accept"
        ? "ACCEPTED"
        : action === "defer"
          ? "DEFERRED"
          : "REJECTED";
    const optimistic: IntakeItem = { ...target, status: optimisticStatus };

    setItems((current) =>
      current.map((item) => (item.id === target.id ? optimistic : item)),
    );
    setSelectedItem(optimistic);
    setActive(optimistic);

    try {
      const context = {
        intakeItemId: target.id,
        organizationId: targetOrganizationId,
        spaceId: targetSpaceId,
      };
      const updated =
        action === "accept"
          ? await acceptIntakeItem(context)
          : action === "defer"
            ? await deferIntakeItem(context)
            : await rejectIntakeItem(context);

      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedItem((current) =>
        current?.id === updated.id ? updated : current,
      );
      setActive((current) => (current?.id === updated.id ? updated : current));
      void loadItems(1, "replace");
    } catch (error) {
      setItems(original);
      setSelectedItem((current) =>
        current?.id === target.id ? target : current,
      );
      setActive((current) => (current?.id === target.id ? target : current));
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setActionInFlight(null);
    }
  }

  function openConvertDialog() {
    if (!active || !canManageIntake || active.status !== "ACCEPTED") {
      return;
    }
    setConvertTarget(active);
    setConvertOpen(true);
  }

  function handleUpdatedIntakeItem(updated: IntakeItem) {
    setItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelectedItem((current) =>
      current?.id === updated.id ? updated : current,
    );
    setActive((current) => (current?.id === updated.id ? updated : current));
    reloadTagFilterOptions();
  }

  function handleConvertedIntakeItem(result: {
    intakeItemId: string;
    workItems: WorkItem[];
  }) {
    const target =
      convertTarget?.id === result.intakeItemId
        ? convertTarget
        : active?.id === result.intakeItemId
          ? active
          : items.find((item) => item.id === result.intakeItemId);

    if (target) {
      handleUpdatedIntakeItem({
        ...target,
        convertedAt: new Date().toISOString(),
        status: "CONVERTED",
      });
    }

    setRelatedTasksRefreshVersion((version) => version + 1);
    void loadItems(1, "replace");
  }

  function openTaskDetail(task: WorkItem) {
    setSelectedTask(
      toWorkItemListViewModel(task, {
        locale,
        lookups: {
          getMember,
          getVersion,
        },
        statusLabel: (category) =>
          tRoot(`workItems.statusCategory.${category}`),
      }),
    );
    setTaskSheetOpen(true);
  }

  function closeTaskSheet(open: boolean) {
    setTaskSheetOpen(open);
    if (!open) {
      setSelectedTask(null);
    }
  }

  const headerActions = spaceId ? (
    <>
      <Button
        size="sm"
        variant={filterOpen ? "secondary" : "outline"}
        className="text-xs"
        data-testid="intake-filter-button"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen((open) => !open)}
        type="button"
      >
        <Filter className="h-3 w-3" />
        {t("actions.filter")}
      </Button>
      {canCreateOrCommentIntake && (
        <Button
          size="sm"
          className="text-xs"
          data-testid="intake-create-button"
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          <Plus className="h-3 w-3" />
          {t("page.create")}
        </Button>
      )}
    </>
  ) : null;
  const paginationFooter =
    pageInfo.total > 0 ? (
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <span data-testid="intake-pagination-summary">
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
            data-testid="intake-load-more"
            disabled={isLoadingMore}
            onClick={() => {
              void loadItems(pageInfo.page + 1, "append");
            }}
          >
            {isLoadingMore
              ? t("pagination.loadingMore")
              : t("pagination.loadMore")}
          </Button>
        ) : null}
      </div>
    ) : null;

  let body: React.ReactNode;

  if (sessionStatus === "loading") {
    body = <LoadingState label={t("states.loading")} />;
  } else if (sessionStatus === "unauthenticated" || !session) {
    body = (
      <EmptyState
        title={t("states.unauthenticated.title")}
        description={t("states.unauthenticated.description")}
      />
    );
  } else if (!spaceId) {
    body = (
      <EmptyState
        title={t("states.noSpace.title")}
        description={t("states.noSpace.description")}
      />
    );
  } else if (isLoading && items.length === 0) {
    body = <ListSkeleton rows={6} />;
  } else if (errorKey) {
    body = (
      <ErrorState
        title={t("states.error.title")}
        message={tRoot(errorKey)}
        onRetry={() => void loadItems(1, "replace")}
        retryLabel={t("actions.retry")}
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <>
        <EmptyState
          title={t("states.empty.title")}
          description={t("states.empty.description")}
        />
        {paginationFooter}
      </>
    );
  } else {
    body = (
      <>
        <ul
          data-testid="intake-list"
          role="list"
          aria-label={tNav("intake")}
          className="divide-y divide-border"
        >
          {filtered.map((item) => {
            const isSelected = (selectedItem?.id ?? active?.id) === item.id;
            const tags = item.tags ?? [];
            const reporterName = displayUserName(item.reporterId, getMember);
            const reporterTip =
              reporterName && reporterName !== "—" ? reporterName : undefined;
            const versionName = item.versionId
              ? displayVersionName(item.versionId, getVersion)
              : "";
            const versionTip =
              versionName && versionName !== "—"
                ? `${tIntakeItems("filters.version")}: ${versionName}`
                : undefined;

            return (
              <li
                key={item.id}
                data-testid="intake-row"
                data-id={item.id}
                ref={(node) => {
                  if (node) {
                    rowRefs.current.set(item.id, node);
                  } else {
                    rowRefs.current.delete(item.id);
                  }
                }}
                aria-current={isSelected ? "true" : undefined}
              >
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  data-selected={isSelected}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70 sm:px-6",
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 self-start rounded-full",
                      priorityDot[item.priority ?? "MEDIUM"],
                    )}
                  />
                  <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 self-start text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {formatItemCode(item)}
                      </span>
                      <span className="truncate text-[13px] font-medium">
                        {item.title}
                      </span>
                    </span>
                    <ListItemMetaRow
                      createdAt={item.createdAt}
                      creatorName={reporterTip}
                      tags={tags}
                    />
                  </span>
                  <Badge variant="outline" className="hidden md:inline-flex">
                    {tIntakeItems(`sourceType.${item.sourceType}`)}
                  </Badge>
                  <span className="shrink-0">
                    <StatusBadge
                      category={intakeStatusToCategory[item.status]}
                      label={tIntakeItems(`status.${item.status}`)}
                      withDot={false}
                    />
                  </span>
                  {item.versionId && (
                    <Tip content={versionTip}>
                      <Badge
                        variant="outline"
                        className="hidden gap-1 md:inline-flex"
                      >
                        <GitBranch aria-hidden="true" className="h-2.5 w-2.5" />
                        {versionName}
                      </Badge>
                    </Tip>
                  )}
                  {item.assigneeId && (
                    <span className="hidden max-w-28 truncate text-[11px] text-muted-foreground lg:inline-block">
                      {displayUserName(item.assigneeId, getMember)}
                    </span>
                  )}
                  <Tip content={reporterTip}>
                    <Avatar className="h-5 w-5 shrink-0">
                      <AvatarFallback className="text-[9px]">
                        {initialOf(reporterName)}
                      </AvatarFallback>
                    </Avatar>
                  </Tip>
                </button>
              </li>
            );
          })}
        </ul>
        {paginationFooter}
      </>
    );
  }

  return (
    <div data-testid="intake-page" className="flex h-full min-w-0 flex-col">
      <PageHeader
        eyebrow={tNav("group.document")}
        title={tNav("intake")}
        description={t("page.description")}
        actions={headerActions}
      />

      {sessionStatus === "authenticated" && spaceId && !errorKey && (
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max items-center gap-1">
              {buckets.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  data-testid="intake-filter-option"
                  data-filter-key={b.key}
                  onClick={() => setFilter(b.key)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    filter === b.key
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
      )}

      {sessionStatus === "authenticated" && spaceId && filterOpen && (
        <FilterPanel
          data-testid="intake-filter-panel"
        >
          <FilterField label={t("filters.version")}>
            <SelectMenu
              aria-label={t("filters.version")}
              data-testid="intake-filter-version"
              value={listFilters.versionId ?? ""}
              onChange={(event) => setVersionFilter(event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allVersions")}</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={t("filters.requirement")} width="lg">
            <SelectMenu
              aria-label={t("filters.requirement")}
              data-testid="intake-filter-requirement"
              value={listFilters.requirementId ?? ""}
              onChange={(event) => setRequirementFilter(event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              contentClassName="w-72"
            >
              <option value="">{t("filters.allRequirements")}</option>
              {filteredRequirements.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.title || requirement.id}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={t("filters.priority")} width="sm">
            <SelectMenu
              aria-label={t("filters.priority")}
              data-testid="intake-filter-priority"
              value={listFilters.priority ?? ""}
              onChange={(event) =>
                setListFilter("priority", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allPriorities")}</option>
              {PRIORITY_FILTERS.map((priority) => (
                <option key={priority} value={priority}>
                  {tIntakeItems(`priority.${priority}`)}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={t("filters.sourceType")}>
            <SelectMenu
              aria-label={t("filters.sourceType")}
              data-testid="intake-filter-source"
              value={listFilters.sourceType ?? ""}
              onChange={(event) =>
                setListFilter("sourceType", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allSourceTypes")}</option>
              {SOURCE_TYPES.map((sourceType) => (
                <option key={sourceType} value={sourceType}>
                  {tIntakeItems(`sourceType.${sourceType}`)}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
          <FilterField label={t("filters.assignee")}>
            <SelectMenu
              aria-label={t("filters.assignee")}
              data-testid="intake-filter-assignee"
              value={listFilters.assigneeId ?? ""}
              onChange={(event) =>
                setListFilter("assigneeId", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allAssignees")}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user.name || member.user.username}
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
              data-testid="intake-filter-tags"
            />
          </FilterField>
          {hasActiveFilters ? (
            <div className="flex h-8 items-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                data-testid="intake-filter-clear"
                onClick={clearFilters}
                type="button"
              >
                <XCircle className="h-3 w-3" />
                {t("filters.clear")}
              </Button>
            </div>
          ) : null}
        </FilterPanel>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto">{body}</div>

      <IntakeDetailSheet
        actionBar={
          active && canManageIntake ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                data-testid="intake-edit-button"
                disabled={actionInFlight !== null}
                onClick={() => setEditOpen(true)}
                type="button"
              >
                <Pencil className="h-3 w-3" />
                {t("detail.edit")}
              </Button>
              {(active.status === "PENDING" ||
                active.status === "DEFERRED") && (
                <>
                  <Button
                    ref={primaryActionButtonRef}
                    size="sm"
                    className="h-7 text-xs"
                    data-testid="intake-accept-button"
                    disabled={actionInFlight !== null}
                    onClick={() => void handleStatusAction("accept")}
                    type="button"
                  >
                    {actionInFlight === "accept"
                      ? tIntakeItems("statusActions.accepting")
                      : tIntakeItems("statusActions.accept")}
                  </Button>
                  {active.status === "PENDING" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 text-xs"
                      data-testid="intake-defer-button"
                      disabled={actionInFlight !== null}
                      onClick={() => void handleStatusAction("defer")}
                      type="button"
                    >
                      {actionInFlight === "defer"
                        ? tIntakeItems("statusActions.deferring")
                        : tIntakeItems("statusActions.defer")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs"
                    data-testid="intake-reject-button"
                    disabled={actionInFlight !== null}
                    onClick={() => void handleStatusAction("reject")}
                    type="button"
                  >
                    {actionInFlight === "reject"
                      ? tIntakeItems("statusActions.rejecting")
                      : tIntakeItems("statusActions.reject")}
                  </Button>
                </>
              )}
              {active.status === "ACCEPTED" && (
                <Button
                  ref={primaryActionButtonRef}
                  size="sm"
                  className="h-7 text-xs"
                  data-testid="intake-convert-button"
                  onClick={openConvertDialog}
                  type="button"
                >
                  <ArrowRight className="h-3 w-3" />
                  {t("detail.convert")}
                </Button>
              )}
            </>
          ) : null
        }
        actionErrorMessage={actionErrorKey ? tRoot(actionErrorKey) : null}
        canComment={canCreateOrCommentIntake}
        canEditTags={canManageIntake}
        focusedCommentId={
          active?.id === requestedIntakeItemId ? requestedCommentId : undefined
        }
        focusedTimelineEventId={
          active?.id === requestedIntakeItemId
            ? requestedTimelineEventId
            : undefined
        }
        intakeItem={active}
        onItemChange={handleUpdatedIntakeItem}
        onOpenChange={handleCloseDrawer}
        onOpenWorkItem={openTaskDetail}
        open={Boolean(active)}
        organizationId={activeOrganizationId}
        relatedTasksRefreshVersion={relatedTasksRefreshVersion}
        showRelatedTasksListLink
        spaceId={activeSpaceId}
      />

      <TaskDetailSheet
        item={selectedTask}
        open={taskSheetOpen}
        onOpenChange={closeTaskSheet}
        organizationId={selectedTaskOrganizationId}
        spaceId={selectedTaskSpaceId}
        onChanged={() => {
          setRelatedTasksRefreshVersion((version) => version + 1);
          reloadTagFilterOptions();
        }}
      />

      {spaceId && canCreateOrCommentIntake && (
        <CreateIntakeDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          spaceId={spaceId}
          onCreated={() => {
            reloadTagFilterOptions();
            void loadItems(1, "replace");
          }}
        />
      )}

      {activeSpaceId && canManageIntake && (
        <EditIntakeDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          organizationId={activeOrganizationId}
          spaceId={activeSpaceId}
          intakeItem={active}
          onUpdated={handleUpdatedIntakeItem}
        />
      )}

      {activeSpaceId && canManageIntake && (
        <ConvertIntakeDialog
          open={convertOpen}
          onOpenChange={(next) => {
            setConvertOpen(next);
            if (!next) {
              setConvertTarget(null);
            }
          }}
          organizationId={activeOrganizationId}
          spaceId={activeSpaceId}
          intakeItem={convertTarget}
          onConverted={handleConvertedIntakeItem}
        />
      )}
    </div>
  );
}

function createIntakeListScopeKey({
  filter,
  listFilters,
  organizationId,
  spaceId,
  tagIds,
  tagMatch,
}: {
  filter: FilterKey;
  listFilters: IntakeListFilterState;
  organizationId?: string;
  spaceId?: string;
  tagIds: readonly string[];
  tagMatch: string;
}): string {
  return [
    organizationId ?? "",
    spaceId ?? "",
    filter,
    listFilters.assigneeId ?? "",
    listFilters.priority ?? "",
    listFilters.reporterId ?? "",
    listFilters.requirementId ?? "",
    listFilters.sourceType ?? "",
    listFilters.status ?? "",
    listFilters.versionId ?? "",
    tagIds.join(","),
    tagIds.length > 0 ? tagMatch : "",
  ].join("\u001f");
}

function hasActiveIntakeFilterState(filters: IntakeListFilterState): boolean {
  return Object.values(filters).some(Boolean);
}

function displayUserName(
  userId: string,
  getMember: (userId: string) => SpaceMemberWithUser | undefined,
): string {
  const member = getMember(userId);
  return member?.user.name ?? member?.user.username ?? "—";
}

function displayVersionName(
  versionId: string,
  getVersion: (versionId: string) => Version | undefined,
): string {
  return getVersion(versionId)?.name ?? "—";
}

function formatItemCode(item: IntakeItem): string {
  return resolveIntakeDisplayCode(item);
}

function initialOf(id: string): string {
  return id.trim().charAt(0).toUpperCase() || "?";
}

function canSubmitIntakeItem(
  item: IntakeItem,
  canManageIntake: boolean,
): boolean {
  return (
    canManageIntake &&
    (item.status === "PENDING" ||
      item.status === "DEFERRED" ||
      item.status === "ACCEPTED")
  );
}

function canCreateOrCommentIntakeItem(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(role) && role !== "VIEWER" && status === "ACTIVE";
}

function canManageIntakeItem(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return (role === "SPACE_ADMIN" || role === "PM") && status === "ACTIVE";
}

function normalizeSearchParam(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function getIntakeStatusCount(
  counts: IntakeStatusCount[],
  status: IntakeStatus,
): number {
  return counts.find((entry) => entry.status === status)?.count ?? 0;
}

function getAllIntakeStatusCount(
  counts: IntakeStatusCount[],
  fallback: number,
): number {
  if (counts.length === 0) {
    return fallback;
  }

  return counts.reduce((sum, entry) => sum + entry.count, 0);
}
