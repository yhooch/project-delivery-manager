"use client";

import type {
  GetSpaceExceptionsViewResponse,
  SpaceExceptionItem,
  StatusCategory,
  TagDto,
  TagMatch,
  ViewExceptionSignal,
  ViewExceptionType,
  WorkItemType,
} from "@project-delivery/shared";
import {
  Bug,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  GitBranch,
  Layers2,
  PauseCircle,
  Settings2,
  Timer,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  useFocusReturn,
  useListKeyboardNav,
} from "../../lib/hooks/use-list-keyboard-nav";
import { useTagFilterOptions } from "../../lib/hooks/use-tag-filter-options";
import { useTagFilterSelection } from "../../lib/hooks/use-tag-filter-selection";
import { useUrlTagFilter } from "../../lib/hooks/use-url-tag-filter";
import { canManageSpace } from "../../lib/permission-gates";
import { usePathname, useRouter } from "../../i18n/routing";
import {
  normalizeTagApiQuery,
  serializeTagFilterQuery,
  type TagFilterState,
} from "../../lib/tag-query";
import { getSpace } from "../../lib/space-service";
import { cn } from "../../lib/utils";
import { translateExceptionReason } from "../../lib/workflow-display";
import {
  createWorkItemViewModelMapper,
  type WorkItemViewModel,
} from "../../lib/v2/work-item-view-model";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import {
  getM4ViewFilterControls,
  type M4ViewFilterControlModel,
} from "../../lib/view-forms";
import { getSpaceExceptionsView } from "../../lib/view-service";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SelectMenu } from "../ui/select-menu";
import { Tip } from "../ui/tooltip";
import { StatusBadge } from "../ui/status-badge";
import { TagFilter } from "../tag";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";
import { FilterField, FilterPanel } from "../v2/filter-controls";
import { ListItemMetaRow } from "../v2/list-item-meta-row";
import { PageHeader } from "../v2/page-header";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";

import { ThresholdEditorDialog } from "./threshold-editor-dialog";

type Tone =
  | "destructive"
  | "warning"
  | "info"
  | "success"
  | "primary"
  | "default";

const tabs: {
  key: ViewExceptionType;
  icon: LucideIcon;
  tone: Tone;
}[] = [
  { key: "overdue", icon: Timer, tone: "destructive" },
  { key: "blocked", icon: PauseCircle, tone: "warning" },
  { key: "pending_confirm", icon: CheckCircle2, tone: "info" },
  { key: "pending_regression", icon: Bug, tone: "info" },
  { key: "stale", icon: Clock, tone: "default" },
];

const exceptionTypeAliases: Record<string, ViewExceptionType> = {
  overdue: "overdue",
  blocked: "blocked",
  pendingConfirm: "pending_confirm",
  pending_confirm: "pending_confirm",
  pendingRegression: "pending_regression",
  pending_regression: "pending_regression",
  stale: "stale",
};

const toneClass: Record<Tone, string> = {
  destructive: "text-destructive",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  primary: "text-primary",
  default: "text-muted-foreground",
};

const exceptionFilterControls: M4ViewFilterControlModel[] =
  getM4ViewFilterControls("space-exceptions").filter(
    (control) => control.id !== "exceptionType",
  );

const EXCEPTIONS_PAGE_SIZE = 200;

type ExceptionFilterValues = {
  assigneeId?: string;
  statusCategory?: StatusCategory;
  versionId?: string;
  workItemType?: WorkItemType;
};

type ExceptionViewRequest = ExceptionFilterValues & {
  exceptionType: ViewExceptionType;
  organizationId?: string;
  page: number;
  spaceId?: string;
  tagIds?: string;
  tagMatch?: TagMatch;
};

export function ExceptionsPage() {
  const t = useTranslations("spaceExceptions");
  const tNav = useTranslations("shell.nav");
  const tTags = useTranslations("tags.field");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { currentSpace, session } = useSession();
  const requestedExceptionType =
    normalizeExceptionType(searchParams.get("exceptionType")) ?? tabs[0].key;
  const requestedFilters = useMemo<ExceptionFilterValues>(
    () => ({
      assigneeId: normalizeSearchParam(searchParams.get("assigneeId")),
      statusCategory: normalizeStatusCategory(
        searchParams.get("statusCategory"),
      ),
      versionId: normalizeSearchParam(searchParams.get("versionId")),
      workItemType: normalizeWorkItemType(searchParams.get("workItemType")),
    }),
    [searchParams],
  );
  const [tagFilter, setTagFilter] = useUrlTagFilter({
    fixedTagMatch: "ANY",
    pathname,
    router,
    searchParams,
  });
  const [view, setView] = useState<GetSpaceExceptionsViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [active, setActive] = useState<WorkItemViewModel | null>(null);
  const [activeContext, setActiveContext] = useState<{
    contextKey: string;
    organizationId?: string;
    spaceId?: string;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [actionFocusRequest, setActionFocusRequest] = useState(0);
  const [tabValue, setTabValue] = useState<ViewExceptionType>(
    requestedExceptionType,
  );
  const [filters, setFilters] =
    useState<ExceptionFilterValues>(requestedFilters);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [thresholdValue, setThresholdValue] = useState<number | null>(null);
  const [thresholdErrorKey, setThresholdErrorKey] = useState<string | null>(
    null,
  );
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const requestSeq = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const { captureFocus, restoreFocus } = useFocusReturn();

  const organizationId = session?.defaultOrganizationId;
  const spaceId = session?.defaultSpaceId;
  const exceptionsContextKey = `${organizationId ?? ""}:${spaceId ?? ""}`;
  const canEditThreshold = canManageSpace(currentSpace?.role, currentSpace?.status);
  const { members, getMember } = useSpaceMembers(spaceId, organizationId);
  const {
    versions,
    getVersion,
    loading: versionsLoading,
  } = useVersions(spaceId, organizationId);
  const { items: tagFilterOptions, reload: reloadTagFilterOptions } =
    useTagFilterOptions({
      organizationId,
      scope: "SPACE_EXCEPTION",
      spaceId,
    });
  const { selectedTags: selectedFilterTags, setSelectedTags } =
    useTagFilterSelection({
      organizationId,
      sourceTags: tagFilterOptions,
      spaceId,
      tagIds: tagFilter.tagIds,
    });

  useEffect(() => {
    setOpen(false);
    setActionFocusRequest(0);
    setActive(null);
    setActiveContext(null);
    setIsFilterPanelOpen(false);
    setThresholdOpen(false);
  }, [organizationId, spaceId]);

  const effectiveFilters = useMemo<ExceptionFilterValues>(() => {
    if (
      filters.versionId &&
      !versions.some((version) => version.id === filters.versionId)
    ) {
      return { ...filters, versionId: undefined };
    }

    return filters;
  }, [filters, versions]);

  useEffect(() => {
    setTabValue(requestedExceptionType);
    setPage(1);
  }, [requestedExceptionType]);

  useEffect(() => {
    setFilters(requestedFilters);
    setPage(1);
  }, [requestedFilters]);

  useEffect(() => {
    if (!filters.versionId || versionsLoading) {
      return;
    }

    if (versions.some((version) => version.id === filters.versionId)) {
      return;
    }

    setFilters((current) =>
      current.versionId === filters.versionId
        ? { ...current, versionId: undefined }
        : current,
    );
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("versionId");
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    router.replace(target as never, { scroll: false });
  }, [
    filters.versionId,
    pathname,
    router,
    searchParams,
    versions,
    versionsLoading,
  ]);

  const fetchView = useCallback(async () => {
    if (!spaceId) {
      requestSeq.current += 1;
      setView(null);
      setIsLoading(false);
      return;
    }

    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setIsLoading(true);
    setErrorKey(null);

    try {
      const next = await getSpaceExceptionsView({
        spaceId,
        organizationId,
        versionId: effectiveFilters.versionId,
        assigneeId: effectiveFilters.assigneeId,
        statusCategory: effectiveFilters.statusCategory,
        workItemType: effectiveFilters.workItemType,
        ...normalizeTagApiQuery(serializeTagFilterQuery(tagFilter)),
        exceptionType: tabValue,
        page,
        pageSize: EXCEPTIONS_PAGE_SIZE,
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
  }, [
    effectiveFilters.assigneeId,
    effectiveFilters.statusCategory,
    effectiveFilters.versionId,
    effectiveFilters.workItemType,
    organizationId,
    page,
    spaceId,
    tabValue,
    tagFilter,
  ]);

  useEffect(() => {
    if (!spaceId) {
      setThresholdValue(null);
      setThresholdErrorKey(null);
      return;
    }

    let isActive = true;
    void (async () => {
      setThresholdErrorKey(null);
      try {
        const nextSpace = await getSpace(spaceId);
        if (isActive) {
          setThresholdValue(nextSpace.settings.staleThresholdDays);
        }
      } catch (error) {
        if (isActive) {
          setThresholdValue(null);
          setThresholdErrorKey(getApiErrorMessageKey(error));
          setThresholdOpen(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [spaceId]);

  useEffect(() => {
    void fetchView();
  }, [fetchView]);

  const viewMatchesRequest = useMemo(
    () =>
      viewMatchesCurrentRequest(view, {
        assigneeId: effectiveFilters.assigneeId,
        exceptionType: tabValue,
        organizationId,
        page,
        spaceId,
        statusCategory: effectiveFilters.statusCategory,
        ...normalizeTagApiQuery(serializeTagFilterQuery(tagFilter)),
        versionId: effectiveFilters.versionId,
        workItemType: effectiveFilters.workItemType,
      }),
    [
      effectiveFilters.assigneeId,
      effectiveFilters.statusCategory,
      effectiveFilters.versionId,
      effectiveFilters.workItemType,
      organizationId,
      page,
      spaceId,
      tabValue,
      tagFilter,
      view,
    ],
  );

  const grouped = useMemo(() => {
    const viewExceptionType = view?.filters?.exceptionType ?? tabValue;
    const items =
      viewMatchesRequest && viewExceptionType === tabValue
        ? (view?.items.items ?? [])
        : [];
    return tabs.map((tab) => {
      const countFromCounts = view?.counts.find(
        (entry) => entry.exceptionType === tab.key,
      )?.count;
      return {
        ...tab,
        items: tab.key === tabValue ? items : [],
        count:
          countFromCounts ??
          (tab.key === tabValue && viewMatchesRequest
            ? (view?.items.total ?? items.length)
            : 0),
      };
    });
  }, [tabValue, view, viewMatchesRequest]);

  const visibleItems = useMemo(
    () => grouped.find((tab) => tab.key === tabValue)?.items ?? [],
    [grouped, tabValue],
  );

  const pagination = useMemo(() => {
    const pageResult = viewMatchesRequest ? view?.items : undefined;
    const total = pageResult?.total ?? 0;
    const pageSize = pageResult?.pageSize ?? EXCEPTIONS_PAGE_SIZE;
    const currentPage = pageResult?.page ?? page;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const to = total === 0 ? 0 : Math.min(currentPage * pageSize, total);

    return {
      from,
      page: currentPage,
      pageCount,
      to,
      total,
    };
  }, [page, view?.items, viewMatchesRequest]);

  const buildExceptionViewModel = useCallback(
    (item: SpaceExceptionItem): WorkItemViewModel => {
      const viewItem = createWorkItemViewModelMapper({
        locale,
        lookups: { getMember, getVersion },
      })(item.workItem);
      const blockedSignal = item.exceptions.find(
        (signal) => signal.type === "blocked",
      );
      return {
        ...viewItem,
        isBlocked: viewItem.isBlocked || Boolean(blockedSignal),
        blockedReason: viewItem.blockedReason ?? blockedSignal?.reason,
      };
    },
    [getMember, getVersion, locale],
  );

  const rememberWorkItem = useCallback(
    (item: WorkItemViewModel) => {
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
          organizationId,
          spaceId,
        },
        { organizationId, spaceId },
      );
    },
    [organizationId, spaceId],
  );

  const openExceptionItem = useCallback(
    (
      item: SpaceExceptionItem,
      options: { focusActions?: boolean } = {},
    ) => {
      captureFocus();
      const next = buildExceptionViewModel(item);
      rememberWorkItem(next);
      setActive(next);
      setActiveContext({
        contextKey: exceptionsContextKey,
        organizationId,
        spaceId,
      });
      setActionFocusRequest((current) =>
        options.focusActions ? current + 1 : 0,
      );
      setOpen(true);
    },
    [
      buildExceptionViewModel,
      captureFocus,
      exceptionsContextKey,
      organizationId,
      rememberWorkItem,
      spaceId,
    ],
  );

  const openExceptionActionArea = useCallback(
    (item: SpaceExceptionItem) => {
      openExceptionItem(item, { focusActions: true });
    },
    [openExceptionItem],
  );

  const handleSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        setActionFocusRequest(0);
        restoreFocus();
      }
    },
    [restoreFocus],
  );

  const focusRow = useCallback((workItemId: string) => {
    rowRefs.current
      .get(workItemId)
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, []);
  const detailSheetOpen =
    open && activeContext?.contextKey === exceptionsContextKey;

  useListKeyboardNav<SpaceExceptionItem>({
    items: visibleItems,
    activeId: active?.id,
    getId: (item) => item.workItem.id,
    onSelect: (item) => {
      focusRow(item.workItem.id);
      setActive(buildExceptionViewModel(item));
      setActiveContext({
        contextKey: exceptionsContextKey,
        organizationId,
        spaceId,
      });
    },
    onOpen: openExceptionItem,
    onEdit: openExceptionItem,
    onSubmit: openExceptionActionArea,
    onClose: detailSheetOpen ? () => handleSheetOpenChange(false) : undefined,
  });

  const thresholdButtonDisabled =
    !canEditThreshold || Boolean(thresholdErrorKey);
  const headerActions = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button
        variant={isFilterPanelOpen ? "secondary" : "outline"}
        size="sm"
        className="text-xs"
        data-testid="exceptions-filter-button"
        aria-expanded={isFilterPanelOpen}
        onClick={() => setIsFilterPanelOpen((current) => !current)}
        type="button"
      >
        <Filter className="h-3 w-3" />
        {t("actions.filter")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        data-testid="exceptions-threshold-button"
        disabled={thresholdButtonDisabled}
        aria-disabled={thresholdButtonDisabled}
        title={
          thresholdErrorKey
            ? tRoot(thresholdErrorKey)
            : canEditThreshold
              ? undefined
              : t("threshold.readonly")
        }
        onClick={() => setThresholdOpen(true)}
      >
        <Settings2 className="h-3 w-3" />
        {t("threshold.title")}
        {thresholdValue !== null && (
          <span className="ml-1 text-[10px] text-muted-foreground">
            {t("threshold.readonlyValue", { count: thresholdValue })}
          </span>
        )}
      </Button>
      {thresholdErrorKey ? (
        <span
          data-testid="exceptions-threshold-error"
          className="max-w-[220px] truncate text-[11px] text-destructive"
        >
          {tRoot(thresholdErrorKey)}
        </span>
      ) : null}
    </div>
  );

  const pageDescription = t("page.description");
  const hasActiveFilters = Boolean(
    filters.versionId ||
    filters.assigneeId ||
    filters.statusCategory ||
    filters.workItemType ||
    tagFilter.tagIds.length > 0,
  );
  const replaceQueryParam = useCallback(
    (key: keyof ExceptionFilterValues | "exceptionType", value?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      const query = params.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      router.replace(target as never, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const handleFilterChange = useCallback(
    (key: keyof ExceptionFilterValues, value?: string) => {
      const nextFilters = {
        ...filters,
        [key]:
          key === "statusCategory"
            ? normalizeStatusCategory(value ?? null)
            : key === "workItemType"
              ? normalizeWorkItemType(value ?? null)
              : normalizeSearchParam(value ?? null),
      };
      setPage(1);
      setFilters(nextFilters);
      const params = new URLSearchParams(searchParams.toString());
      for (const control of exceptionFilterControls) {
        const nextValue = getExceptionFilterValue(nextFilters, control.id);
        if (nextValue) {
          params.set(control.id, nextValue);
        } else {
          params.delete(control.id);
        }
      }
      const query = params.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      router.replace(target as never, { scroll: false });
    },
    [filters, pathname, router, searchParams],
  );
  const handleTagFilterChange = useCallback(
    (value: TagFilterState, selectedTags: TagDto[]) => {
      setSelectedTags(selectedTags);
      setPage(1);
      setTagFilter(value);
    },
    [setSelectedTags, setTagFilter],
  );
  const clearFilters = useCallback(() => {
    setPage(1);
    setFilters({});
    setSelectedTags([]);
    setTagFilter({ tagIds: [], tagMatch: "ANY" });
    const params = new URLSearchParams(searchParams.toString());
    for (const control of exceptionFilterControls) {
      params.delete(control.id);
    }
    params.delete("tagIds");
    params.delete("tagMatch");
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    router.replace(target as never, { scroll: false });
  }, [pathname, router, searchParams, setSelectedTags, setTagFilter]);
  const handleTabChange = useCallback(
    (next: string) => {
      const nextType = normalizeExceptionType(next) ?? tabs[0].key;
      setPage(1);
      setTabValue(nextType);
      replaceQueryParam("exceptionType", nextType);
    },
    [replaceQueryParam],
  );

  if (!session) {
    return (
      <div
        data-testid="exceptions-page"
        className="flex h-full min-w-0 flex-col"
      >
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("exceptions")}
          description={pageDescription}
        />
        <div className="flex-1 px-6 py-6">
          <EmptyState
            title={t("states.unauthenticated.title")}
            description={t("states.unauthenticated.description")}
          />
        </div>
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div
        data-testid="exceptions-page"
        className="flex h-full min-w-0 flex-col"
      >
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("exceptions")}
          description={pageDescription}
        />
        <div className="flex-1 px-6 py-6">
          <EmptyState
            title={t("states.noSpaceSelected.title")}
            description={t("states.noSpaceSelected.description")}
          />
        </div>
      </div>
    );
  }

  if (errorKey && !view) {
    return (
      <div
        data-testid="exceptions-page"
        className="flex h-full min-w-0 flex-col"
      >
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("exceptions")}
          description={pageDescription}
          actions={headerActions}
        />
        <div className="flex-1 px-6 py-6">
          <ErrorState
            title={t("errorTitle")}
            message={tRoot(errorKey)}
            onRetry={() => void fetchView()}
          />
        </div>
      </div>
    );
  }

  const handleSelect = (item: SpaceExceptionItem) => {
    openExceptionItem(item);
  };
  const detailSheetItem = detailSheetOpen ? active : null;

  return (
    <div data-testid="exceptions-page" className="flex h-full min-w-0 flex-col">
      <PageHeader
        eyebrow={tNav("group.deliver")}
        title={tNav("exceptions")}
        description={pageDescription}
        actions={headerActions}
      />

      <Tabs
        value={tabValue}
        onValueChange={handleTabChange}
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex min-w-0 border-b border-border px-4 py-3 sm:px-6">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="h-auto min-w-max border-0">
              {grouped.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.key}
                    value={tab.key}
                    className={cn(
                      "h-7 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer",
                      "data-[state=active]:bg-muted data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:after:hidden",
                      "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-muted/50 data-[state=inactive]:hover:text-foreground",
                    )}
                    data-testid={`exceptions-tab-${tab.key}`}
                  >
                    <Icon className={cn("h-3 w-3", toneClass[tab.tone])} />
                    {tRoot(`m4Views.exceptionType.${tab.key}`)}
                    <span className="rounded bg-background px-1 font-mono text-[10px] text-muted-foreground">
                      {tab.count}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        </div>

        {isFilterPanelOpen ? (
          <FilterPanel data-testid="exceptions-filter-panel">
            <ExceptionFilterToolbar
              filters={filters}
              members={members}
              selectedTags={selectedFilterTags}
              tagFilter={tagFilter}
              tagOptions={tagFilterOptions}
              versions={versions}
              hasActiveFilters={hasActiveFilters}
              onChange={handleFilterChange}
              onClear={clearFilters}
              onTagChange={handleTagFilterChange}
              tTags={tTags}
              tRoot={tRoot}
            />
          </FilterPanel>
        ) : null}

        {grouped.map((tab) => (
          <TabsContent
            key={tab.key}
            value={tab.key}
            data-testid={`exceptions-panel-${tab.key}`}
            className="mt-0 min-w-0 flex-1 overflow-y-auto"
          >
            {tab.key === tabValue && isLoading && !viewMatchesRequest ? (
              <LoadingState label={t("states.loadingList")} />
            ) : tab.key === tabValue && errorKey ? (
              <ErrorState
                title={t("errorTitle")}
                message={tRoot(errorKey)}
                onRetry={() => void fetchView()}
              />
            ) : tab.items.length === 0 ? (
              <EmptyState
                title={t("states.empty.title")}
                description={t("states.empty.description")}
              />
            ) : (
              <ul
                data-testid={`exceptions-list-${tab.key}`}
                role="list"
                aria-label={t("list.title")}
                className="divide-y divide-border"
              >
                {tab.items.map((item) => {
                  const viewItem = buildExceptionViewModel(item);
                  const matchedSignal = item.exceptions.find(
                    (signal) => signal.type === tab.key,
                  );
                  const exceptionDetail = matchedSignal?.reason
                    ? translateExceptionReason(tRoot, matchedSignal.reason)
                    : undefined;
                  const exceptionMeta = buildExceptionMeta(
                    matchedSignal,
                    locale,
                    t,
                    tRoot,
                  );
                  const isSelected = active?.id === item.workItem.id;

                  return (
                    <li
                      key={item.workItem.id}
                      data-testid={`exceptions-row-${tab.key}-${item.workItem.id}`}
                      ref={(node) => {
                        if (node) {
                          rowRefs.current.set(item.workItem.id, node);
                        } else {
                          rowRefs.current.delete(item.workItem.id);
                        }
                      }}
                      aria-current={isSelected ? "true" : undefined}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect(item)}
                        className={cn(
                          "flex w-full min-w-0 cursor-pointer items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/70 sm:px-6",
                          isSelected &&
                            "bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]",
                        )}
                      >
                        {viewItem.type === "BUG" ? (
                          <Bug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/80" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/80" />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              {tRoot(
                                `versionBoard.filters.type.${viewItem.type}`,
                              )}
                            </span>
                            <span className="truncate text-[13px] font-medium">
                              {viewItem.title}
                            </span>
                          </span>
                          <ListItemMetaRow
                            createdAt={viewItem.createdAt}
                            creatorName={viewItem.creatorName}
                            tagMaxVisible={6}
                            tags={viewItem.tags}
                          />
                        </span>
                        {(exceptionDetail || exceptionMeta.length > 0) && (
                          <span className="hidden min-w-0 max-w-[280px] flex-col items-end gap-0.5 text-right md:flex">
                            {exceptionDetail ? (
                              <span
                                className={cn(
                                  "max-w-full truncate text-[11px]",
                                  toneClass[tab.tone],
                                )}
                              >
                                {exceptionDetail}
                              </span>
                            ) : null}
                            {exceptionMeta.length > 0 ? (
                              <span className="max-w-full truncate text-[10px] text-muted-foreground">
                                {exceptionMeta.join(" · ")}
                              </span>
                            ) : null}
                          </span>
                        )}
                        <span className="shrink-0">
                          <StatusBadge
                            category={viewItem.statusCategory}
                            label={viewItem.statusLabel}
                            withDot={false}
                          />
                        </span>
                        {viewItem.versionName && (
                          <Tip
                            content={`${tRoot("m4Views.filters.version")}: ${
                              viewItem.versionName
                            }`}
                          >
                            <Badge
                              variant="outline"
                              className="hidden gap-1 md:inline-flex"
                            >
                              <GitBranch
                                aria-hidden="true"
                                className="h-2.5 w-2.5"
                              />
                              {viewItem.versionName}
                            </Badge>
                          </Tip>
                        )}
                        <Tip content={viewItem.assignee.name || undefined}>
                          <Avatar className="h-5 w-5 shrink-0">
                            <AvatarFallback className="text-[9px]">
                              {viewItem.assignee.initial}
                            </AvatarFallback>
                          </Avatar>
                        </Tip>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {tab.key === tabValue && viewMatchesRequest ? (
              <ExceptionsPagination
                loading={isLoading}
                onPrevious={() =>
                  setPage((current) => Math.max(1, current - 1))
                }
                onNext={() =>
                  setPage((current) =>
                    Math.min(pagination.pageCount, current + 1),
                  )
                }
                pagination={pagination}
                t={t}
              />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>

      <TaskDetailSheet
        actionFocusRequest={actionFocusRequest}
        item={detailSheetItem}
        open={detailSheetOpen}
        onOpenChange={handleSheetOpenChange}
        spaceId={activeContext?.spaceId}
        organizationId={activeContext?.organizationId}
        onChanged={() => {
          reloadTagFilterOptions();
          void fetchView();
        }}
      />

      {spaceId && !thresholdErrorKey && (
        <ThresholdEditorDialog
          initialValue={thresholdValue ?? 3}
          onClose={() => setThresholdOpen(false)}
          onSaved={(nextValue) => {
            setThresholdValue(nextValue);
            setThresholdOpen(false);
            void fetchView();
          }}
          open={thresholdOpen}
          spaceId={spaceId}
        />
      )}
    </div>
  );
}

function ExceptionsPagination({
  loading,
  onNext,
  onPrevious,
  pagination,
  t,
}: {
  loading: boolean;
  onNext: () => void;
  onPrevious: () => void;
  pagination: {
    from: number;
    page: number;
    pageCount: number;
    to: number;
    total: number;
  };
  t: ReturnType<typeof useTranslations<"spaceExceptions">>;
}) {
  return (
    <div
      data-testid="exceptions-pagination"
      className="flex flex-col gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
      <span data-testid="exceptions-pagination-summary">
        {t("pagination.summary", {
          from: pagination.from,
          page: pagination.page,
          pageCount: pagination.pageCount,
          to: pagination.to,
          total: pagination.total,
        })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          data-testid="exceptions-pagination-previous"
          aria-label={t("pagination.previousAria")}
          disabled={loading || pagination.page <= 1}
          onClick={onPrevious}
        >
          <ChevronLeft className="h-3 w-3" />
          {t("pagination.previous")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          data-testid="exceptions-pagination-next"
          aria-label={t("pagination.nextAria")}
          disabled={loading || pagination.page >= pagination.pageCount}
          onClick={onNext}
        >
          {t("pagination.next")}
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function ExceptionFilterToolbar({
  filters,
  hasActiveFilters,
  members,
  onChange,
  onClear,
  onTagChange,
  selectedTags,
  tagFilter,
  tagOptions,
  tTags,
  tRoot,
  versions,
}: {
  filters: ExceptionFilterValues;
  hasActiveFilters: boolean;
  members: ReturnType<typeof useSpaceMembers>["members"];
  onChange: (key: keyof ExceptionFilterValues, value?: string) => void;
  onClear: () => void;
  onTagChange: (value: TagFilterState, selectedTags: TagDto[]) => void;
  selectedTags: readonly TagDto[];
  tagFilter: TagFilterState;
  tagOptions: readonly TagDto[];
  tTags: ReturnType<typeof useTranslations<"tags.field">>;
  tRoot: ReturnType<typeof useTranslations>;
  versions: ReturnType<typeof useVersions>["versions"];
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {exceptionFilterControls.map((control) => {
        const value = getExceptionFilterValue(filters, control.id);
        const Icon = getExceptionFilterIcon(control.id);
        const options = getExceptionFilterOptions({
          controlId: control.id,
          members,
          tRoot,
          versions,
        });
        const selectedLabel =
          options.find((option) => option.value === value)?.label ??
          tRoot(control.allLabelKey ?? control.labelKey);

        return (
          <FilterField
            key={control.id}
            label={tRoot(control.labelKey)}
            width={getExceptionFilterWidth(control.id)}
          >
            <span className="relative block min-w-0">
              <Icon className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <SelectMenu
                value={value ?? ""}
                onChange={(event) =>
                  onChange(
                    control.id as keyof ExceptionFilterValues,
                    event.target.value || undefined,
                  )
                }
                data-testid={`exceptions-filter-${control.id}`}
                className="h-8 w-full pl-7 text-xs"
                containerClassName="w-full"
                contentClassName="w-56"
                aria-label={selectedLabel}
              >
                <option value="">
                  {tRoot(control.allLabelKey ?? control.labelKey)}
                </option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectMenu>
            </span>
          </FilterField>
        );
      })}
      <FilterField label={tTags("label")} width="tag">
        <TagFilter
          aria-label={tTags("label")}
          availableTags={tagOptions}
          className="w-full"
          onChange={onTagChange}
          selectedTags={selectedTags}
          showMatchMode={false}
          value={tagFilter}
          data-testid="exceptions-filter-tags"
        />
      </FilterField>

      {hasActiveFilters ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          data-testid="exceptions-filter-clear"
          onClick={onClear}
        >
          <XCircle className="h-3 w-3" />
          {tRoot("m4Views.filters.clear")}
        </Button>
      ) : null}
    </div>
  );
}

function getExceptionFilterWidth(
  controlId: string,
): "sm" | "md" | "lg" | "xl" | "tag" {
  if (controlId === "versionId") return "md";
  if (controlId === "assigneeId") return "md";
  return "sm";
}

function getExceptionFilterValue(
  filters: ExceptionFilterValues,
  controlId: string,
): string | undefined {
  if (controlId === "versionId") return filters.versionId;
  if (controlId === "assigneeId") return filters.assigneeId;
  if (controlId === "statusCategory") return filters.statusCategory;
  if (controlId === "workItemType") return filters.workItemType;
  return undefined;
}

function getExceptionFilterIcon(controlId: string): LucideIcon {
  if (controlId === "versionId") return GitBranch;
  if (controlId === "assigneeId") return Users;
  if (controlId === "workItemType") return Layers2;
  return Filter;
}

function getExceptionFilterOptions({
  controlId,
  members,
  tRoot,
  versions,
}: {
  controlId: string;
  members: ReturnType<typeof useSpaceMembers>["members"];
  tRoot: ReturnType<typeof useTranslations>;
  versions: ReturnType<typeof useVersions>["versions"];
}): Array<{ label: string; value: string }> {
  if (controlId === "versionId") {
    return versions.map((version) => ({
      label: version.name,
      value: version.id,
    }));
  }

  if (controlId === "assigneeId") {
    return members.map((member) => ({
      label: member.user.name || member.user.username || "—",
      value: member.userId,
    }));
  }

  const control = exceptionFilterControls.find((item) => item.id === controlId);
  return (control?.options ?? []).map((option) => ({
    label: tRoot(option.labelKey),
    value: option.value,
  }));
}

function buildExceptionMeta(
  signal: ViewExceptionSignal | undefined,
  locale: string,
  t: ReturnType<typeof useTranslations<"spaceExceptions">>,
  tRoot: ReturnType<typeof useTranslations>,
): string[] {
  if (!signal) {
    return [];
  }

  const meta: string[] = [];

  if (
    signal.type === "stale" &&
    typeof signal.staleDays === "number" &&
    typeof signal.staleThresholdDays === "number"
  ) {
    meta.push(
      t("list.staleMeta", {
        count: signal.staleDays,
        threshold: signal.staleThresholdDays,
      }),
    );
  }

  if (signal.dueDate) {
    meta.push(t("list.dueMeta", { date: formatDate(signal.dueDate, locale) }));
  }

  if (signal.lastStatusChangedAt) {
    meta.push(
      t("list.lastChangedMeta", {
        date: formatDate(signal.lastStatusChangedAt, locale),
      }),
    );
  }

  if (signal.blockedReason && signal.blockedReason !== signal.reason) {
    meta.push(translateExceptionReason(tRoot, signal.blockedReason));
  }

  if (signal.evidenceSource) {
    meta.push(
      t("list.sourceMeta", {
        source: tRoot(
          `spaceExceptions.evidenceSource.${signal.evidenceSource}`,
        ),
      }),
    );
  }

  return Array.from(new Set(meta.filter(Boolean)));
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function normalizeExceptionType(
  value: string | null,
): ViewExceptionType | null {
  if (!value) {
    return null;
  }

  return exceptionTypeAliases[value] ?? null;
}

function normalizeStatusCategory(
  value: string | null,
): StatusCategory | undefined {
  const normalized = normalizeSearchParam(value);
  if (
    normalized === "NOT_STARTED" ||
    normalized === "IN_PROGRESS" ||
    normalized === "WAITING" ||
    normalized === "VERIFYING" ||
    normalized === "DONE" ||
    normalized === "TERMINATED"
  ) {
    return normalized;
  }

  return undefined;
}

function normalizeWorkItemType(value: string | null): WorkItemType | undefined {
  const normalized = normalizeSearchParam(value);
  if (normalized === "TASK" || normalized === "BUG") {
    return normalized;
  }

  return undefined;
}

function normalizeSearchParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function viewMatchesCurrentRequest(
  view: GetSpaceExceptionsViewResponse | null,
  request: ExceptionViewRequest,
): boolean {
  if (!view) {
    return false;
  }

  if (
    view.items.page !== request.page ||
    view.items.pageSize !== EXCEPTIONS_PAGE_SIZE
  ) {
    return false;
  }

  if (
    request.organizationId &&
    !sameOptionalValue(view.filters.organizationId, request.organizationId)
  ) {
    return false;
  }

  if (
    request.spaceId &&
    !sameOptionalValue(view.filters.spaceId, request.spaceId)
  ) {
    return false;
  }

  return (
    sameOptionalValue(view.filters.assigneeId, request.assigneeId) &&
    sameOptionalValue(view.filters.exceptionType, request.exceptionType) &&
    sameOptionalValue(view.filters.statusCategory, request.statusCategory) &&
    sameOptionalValue(view.filters.tagIds, request.tagIds) &&
    sameOptionalValue(view.filters.tagMatch, request.tagMatch) &&
    sameOptionalValue(view.filters.versionId, request.versionId) &&
    sameOptionalValue(view.filters.workItemType, request.workItemType)
  );
}

function sameOptionalValue<T extends string>(
  actual: T | undefined,
  expected: T | undefined,
): boolean {
  return actual === expected;
}
