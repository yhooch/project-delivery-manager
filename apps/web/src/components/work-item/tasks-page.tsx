"use client";

import type {
  Priority,
  Requirement,
  StatusCategory,
  WorkItem,
  WorkItemStatusCategoryCount,
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
  type ReactNode,
} from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  useFocusReturn,
  useListKeyboardNav,
} from "../../lib/hooks/use-list-keyboard-nav";
import { canCreateTasks } from "../../lib/permission-gates";
import { listRequirements } from "../../lib/requirement-service";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import {
  toWorkItemListViewModel,
  type WorkItemViewModel,
} from "../../lib/v2/work-item-view-model";
import {
  getWorkItem,
  listWorkItems,
  type TaskListFilterState,
} from "../../lib/work-item-service";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SelectMenu } from "../ui/select-menu";
import { useSession } from "../providers/session-provider";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";
import { WorkItemRow } from "../v2/work-item-row";
import { recordRecentOpen } from "../shell/recent-opens";

import { CreateTaskDialog } from "./create-task-dialog";
import { TaskDetailSheet } from "./task-detail-sheet";

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
const LIST_PAGE_SIZE = 100;
const INITIAL_PAGE_INFO = { page: 1, pageSize: LIST_PAGE_SIZE, total: 0 };

export function TasksPage() {
  const tNav = useTranslations("shell.nav");
  const t = useTranslations("tasks");
  const tStatus = useTranslations("workItems.statusCategory");
  const tPriority = useTranslations("workItems.priority");
  const tFilters = useTranslations("workItems.filters");
  const tApiError = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();

  const { currentSpace, status: sessionStatus } = useSession();
  const spaceId = currentSpace?.id;
  const organizationId = currentSpace?.organizationId;
  const requestedNew = normalizeSearchParam(searchParams.get("new"));
  const requestedWorkItemId = normalizeSearchParam(
    searchParams.get("workItemId"),
  );
  const requestedIntakeItemId = normalizeSearchParam(
    searchParams.get("intakeItemId"),
  );
  const requestedVersionId = normalizeSearchParam(
    searchParams.get("versionId"),
  );
  const requestedStatusCategory = normalizeStatusCategory(
    searchParams.get("statusCategory"),
  );
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );
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
  const [statusCategoryCounts, setStatusCategoryCounts] = useState<
    WorkItemStatusCategoryCount[]
  >([]);
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
    () => createTaskListScopeKey({ filters, organizationId, spaceId }),
    [filters, organizationId, spaceId],
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

  const setFilter = useCallback(
    (key: keyof TaskListFilterState, value: string) => {
      setFilters((current) => ({ ...current, [key]: value || undefined }));
    },
    [],
  );

  const fetchTasks = useCallback(
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
        const result = await listWorkItems({
          organizationId,
          page,
          pageSize: LIST_PAGE_SIZE,
          spaceId,
          type: "TASK",
          ...filters,
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
    [filters, listScopeKey, organizationId, spaceId, tApiError],
  );

  useEffect(() => {
    if (spaceId) {
      void fetchTasks(1, "replace");
    } else {
      listRequestIdRef.current += 1;
      setItems([]);
      setPageInfo(INITIAL_PAGE_INFO);
      setStatusCategoryCounts([]);
      setLoading(false);
      setLoadingMore(false);
      setHasLoadedItems(false);
    }
  }, [fetchTasks, spaceId]);

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

  const buckets: { count: number; label: string; key: StatusFilterKey }[] =
    useMemo(
      () => [
        {
          count: getAllStatusCategoryCount(statusCategoryCounts, items.length),
          label: t("buckets.all"),
          key: "all",
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
      [items.length, statusCategoryCounts, t, tStatus],
    );

  const taskViewModels = useMemo(
    () =>
      items.map((item) =>
        toWorkItemListViewModel(item, {
          locale,
          lookups: {
            getMember,
            getVersion,
          },
          statusLabel: (category) => tStatus(category),
        }),
      ),
    [getMember, getVersion, items, locale, tStatus],
  );

  const filtered = useMemo(() => {
    return taskViewModels.filter((task) => {
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          task.title.toLowerCase().includes(q) ||
          task.code.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [query, taskViewModels]);

  const open = useCallback(
    (
      item: WorkItemViewModel,
      options: { focusActions?: boolean } = {},
    ) => {
      captureFocus();
      recordRecentOpen(
        {
          id: item.id,
          type: "TASK",
          code: item.code,
          title: item.title,
          href: `/work-items?workItemId=${encodeURIComponent(item.id)}`,
        },
        recentScope,
      );
      setActiveItem(item);
      setActionFocusRequest((current) =>
        options.focusActions ? current + 1 : 0,
      );
      setSheetOpen(true);
    },
    [captureFocus, recentScope],
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

    const key = `workItem:${spaceId}:${requestedWorkItemId}`;
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
              lookups: { getMember, getVersion },
              statusLabel: (category) => tStatus(category),
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
    requestedWorkItemId,
    spaceId,
    taskViewModels,
    locale,
    tStatus,
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

      <div className="flex min-w-0 flex-col gap-3 border-b border-border px-4 py-3 sm:px-6 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1 md:max-w-md">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-7"
          />
        </div>
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="flex min-w-max items-center gap-1">
            {buckets.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() =>
                  setFilter("statusCategory", b.key === "all" ? "" : b.key)
                }
                className={`h-7 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  (filters.statusCategory ?? "all") === b.key
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
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
        <div
          data-testid="tasks-filter-panel"
          className="grid min-w-0 gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:px-6 md:grid-cols-5"
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
          <FilterField label={tFilters("statusCategory")}>
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
          <FilterField label={tFilters("priority")}>
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
          <FilterField label={tFilters("requirement")}>
            <SelectMenu
              data-testid="tasks-filter-requirement"
              value={filters.requirementId ?? ""}
              onChange={(event) =>
                setFilter("requirementId", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{tFilters("allRequirements")}</option>
              {requirements.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.title || requirement.id}
                </option>
              ))}
            </SelectMenu>
          </FilterField>
        </div>
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
        item={activeItem}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        organizationId={organizationId}
        spaceId={spaceId}
        onChanged={() => {
          void fetchTasks(1, "replace");
        }}
      />

      {spaceId && canCreateTask && (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          spaceId={spaceId}
          onCreated={() => {
            void fetchTasks(1, "replace");
          }}
        />
      )}
    </div>
  );
}

function FilterField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function normalizeSearchParam(value: string | null): string | undefined {
  const normalized = value?.trim();
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

function createTaskListScopeKey({
  filters,
  organizationId,
  spaceId,
}: {
  filters: TaskListFilterState;
  organizationId?: string;
  spaceId?: string;
}): string {
  return [
    organizationId ?? "",
    spaceId ?? "",
    filters.assigneeId ?? "",
    filters.intakeItemId ?? "",
    filters.priority ?? "",
    filters.reporterId ?? "",
    filters.requirementId ?? "",
    filters.statusCategory ?? "",
    filters.versionId ?? "",
  ].join("\u001f");
}
