"use client";

import type {
  BugSeverity,
  BugView,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  StatusCategory,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import { Bug, Filter, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
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
import { listRequirements } from "../../lib/requirement-service";
import {
  useSpaceMembers,
  useVersions,
  useWorkflowStateLookup,
} from "../../lib/v2/lookups";
import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { cn } from "../../lib/utils";
import { listWorkItems } from "../../lib/work-item-service";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";

import { TaskDetailSheet } from "../work-item/task-detail-sheet";

import { CreateBugDialog } from "./create-bug-dialog";
import { EditBugDialog } from "./edit-bug-dialog";

const severityColor: Record<BugSeverity, string> = {
  BLOCKER: "bg-destructive text-destructive-foreground",
  CRITICAL: "bg-destructive/15 text-destructive",
  MAJOR: "bg-warning/15 text-warning",
  MINOR: "bg-info/15 text-info",
  TRIVIAL: "bg-muted text-muted-foreground",
};

type BugLifecycleBucket =
  | "all"
  | "pendingConfirm"
  | "pendingFix"
  | "fixing"
  | "pendingRegression"
  | "regressionPassed"
  | "closed";

const bugBucketStatus: Exclude<BugLifecycleBucket, "all">[] = [
  "pendingConfirm",
  "pendingFix",
  "fixing",
  "pendingRegression",
  "regressionPassed",
  "closed",
];

const bugBucketCategory: Record<
  Exclude<BugLifecycleBucket, "all">,
  StatusCategory
> = {
  pendingConfirm: "NOT_STARTED",
  pendingFix: "WAITING",
  fixing: "IN_PROGRESS",
  pendingRegression: "VERIFYING",
  regressionPassed: "DONE",
  closed: "DONE",
};

const bugBucketByCategory: Partial<
  Record<StatusCategory, Exclude<BugLifecycleBucket, "all">>
> = {
  DONE: "regressionPassed",
  IN_PROGRESS: "fixing",
  NOT_STARTED: "pendingConfirm",
  TERMINATED: "closed",
  VERIFYING: "pendingRegression",
  WAITING: "pendingFix",
};

const bugBucketStateCodes: Record<
  Exclude<BugLifecycleBucket, "all">,
  string[]
> = {
  pendingConfirm: ["PENDING_CONFIRMATION"],
  pendingFix: ["PENDING_FIX"],
  fixing: ["FIXING"],
  pendingRegression: ["PENDING_REGRESSION"],
  regressionPassed: ["REGRESSION_PASSED"],
  closed: ["CLOSED"],
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

type BugItemViewModel = WorkItemViewModel & {
  lifecycleBucket: Exclude<BugLifecycleBucket, "all">;
  severity: BugSeverity;
};

export function BugsPage() {
  const tNav = useTranslations("shell.nav");
  const t = useTranslations("bugs");
  const tStatus = useTranslations("bugs.statusCategory");
  const tPriority = useTranslations("bugs.priority");
  const tSeverity = useTranslations("bugs.severity");
  const tFilters = useTranslations("bugs.filters");
  const tApiError = useTranslations();
  const searchParams = useSearchParams();

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filters, setFilters] = useState<BugListFilterState>(() =>
    createInitialFilters(searchParams),
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [relatedTasks, setRelatedTasks] = useState<WorkItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingBug, setEditingBug] = useState<BugView | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [handledDeepLinkKey, setHandledDeepLinkKey] = useState<string | null>(
    null,
  );
  const [bucketFilter, setBucketFilter] = useState<BugLifecycleBucket>("all");
  const { captureFocus, restoreFocus } = useFocusReturn();
  const canCreateBug = canCreateBugs(
    currentSpace?.role,
    currentSpace?.status,
  );
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
  const activeBucket =
    bucketFilter !== "all"
      ? bucketFilter
      : filters.statusCategory
        ? (bugBucketByCategory[filters.statusCategory] ?? "all")
        : "all";

  const setFilter = useCallback(
    (key: keyof BugListFilterState, value: string) => {
      setFilters((current) => ({ ...current, [key]: value || undefined }));
    },
    [],
  );

  const fetchBugs = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setHasLoadedItems(false);
    setErrorMessage(null);

    try {
      const result = await listBugs({
        organizationId,
        spaceId,
        type: "BUG",
        ...filters,
      });
      setItems(result.items);
    } catch (error) {
      const key = getApiErrorMessageKey(error);
      setErrorMessage(tApiError(key));
    } finally {
      setLoading(false);
      setHasLoadedItems(true);
    }
  }, [filters, organizationId, spaceId, tApiError]);

  useEffect(() => {
    if (spaceId) {
      void fetchBugs();
    } else {
      setItems([]);
      setHasLoadedItems(false);
    }
  }, [fetchBugs, spaceId]);

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
        toBugViewModel(bug, tStatus, {
          getMember,
          getVersion,
          getWorkflowState: workflowStateLookup.getState,
        }),
      ),
    [getMember, getVersion, items, tStatus, workflowStateLookup.getState],
  );

  const filtered = useMemo(() => {
    if (bucketFilter === "all") {
      return bugViewModels;
    }
    return bugViewModels.filter((bug) => bug.lifecycleBucket === bucketFilter);
  }, [bucketFilter, bugViewModels]);

  const openBug = useCallback(
    (bug: BugItemViewModel) => {
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
      setSheetOpen(true);
    },
    [captureFocus, recentScope],
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
        toBugViewModel(updated, tStatus, {
          getMember,
          getVersion,
          getWorkflowState: workflowStateLookup.getState,
        }),
      );
      setDetailRevision((revision) => revision + 1);
      void fetchBugs();
    },
    [fetchBugs, getMember, getVersion, tStatus, workflowStateLookup.getState],
  );

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
    setBucketFilter("all");
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
            toBugViewModel(bug, tStatus, {
              getMember,
              getVersion,
              getWorkflowState: workflowStateLookup.getState,
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
    handledDeepLinkKey,
    hasLoadedItems,
    loading,
    openBug,
    organizationId,
    requestedBugId,
    spaceId,
    tStatus,
    bugViewModels,
    workflowStateLookup.getState,
  ]);

  useListKeyboardNav<BugItemViewModel>({
    items: filtered,
    activeId: activeItem?.id,
    getId: (item) => item.id,
    onSelect: setActiveItem,
    onOpen: openBug,
    onEdit: openEditBugFromViewModel,
    canAssign: (bug) =>
      canEditBug(
        items.find((item) => item.id === bug.id),
        currentSpace?.role,
        currentSpace?.status,
      ),
    onAssign: openEditBugFromViewModel,
    canSubmit: () => false,
    onClose: () => handleSheetOpenChange(false),
  });

  const buckets = useMemo(
    () => [
      {
        label: t("buckets.all"),
        key: "all" as BugLifecycleBucket,
        count: bugViewModels.length,
      },
      ...bugBucketStatus.map((key) => ({
        label: t(`buckets.${key}`),
        key,
        count: bugViewModels.filter((bug) => bug.lifecycleBucket === key).length,
      })),
    ],
    [bugViewModels, t],
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
                  setBucketFilter(b.key);
                  if (b.key === "all") {
                    setFilter("statusCategory", "");
                  } else {
                    setFilter("statusCategory", bugBucketCategory[b.key]);
                  }
                }}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer",
                  activeBucket === b.key
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
        <div
          data-testid="bugs-filter-panel"
          className="grid min-w-0 gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:px-6 md:grid-cols-3 xl:grid-cols-6"
        >
          <FilterField label={tFilters("version")}>
            <select
              data-testid="bugs-filter-version"
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
            </select>
          </FilterField>
          <FilterField label={tFilters("assignee")}>
            <select
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
            </select>
          </FilterField>
          <FilterField label={tFilters("statusCategory")}>
            <select
              data-testid="bugs-filter-status"
              value={filters.statusCategory ?? ""}
              onChange={(event) => {
                setBucketFilter("all");
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
            </select>
          </FilterField>
          <FilterField label={tFilters("priority")}>
            <select
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
            </select>
          </FilterField>
          <FilterField label={tFilters("severity")}>
            <select
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
            </select>
          </FilterField>
          <FilterField label={tFilters("requirement")}>
            <select
              data-testid="bugs-filter-requirement"
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
            </select>
          </FilterField>
          <FilterField label={tFilters("relatedTask")}>
            <select
              data-testid="bugs-filter-related-task"
              value={filters.relatedTaskId ?? ""}
              onChange={(event) =>
                setFilter("relatedTaskId", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{tFilters("allRelatedTasks")}</option>
              {relatedTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
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
              void fetchBugs();
            }}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t("states.empty.title")}
            description={t("states.empty.description")}
          />
        ) : (
          <ul
            data-testid="bugs-list"
            role="listbox"
            className="divide-y divide-border"
          >
            {filtered.map((bug) => (
              <li
                key={bug.id}
                data-testid="bugs-row"
                data-id={bug.id}
                role="option"
                aria-selected={activeItem?.id === bug.id}
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
                    className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
                  >
                    <Bug className="h-3.5 w-3.5 shrink-0 text-destructive/80" />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {bug.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {bug.title}
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
                      <Badge
                        variant="outline"
                        className="hidden md:inline-flex"
                      >
                        {bug.versionName}
                      </Badge>
                    )}
                    {bug.isOverdue && (
                      <Badge variant="destructive" className="text-[10px]">
                        {t("badges.overdue")}
                      </Badge>
                    )}
                    <Avatar className="h-5 w-5 shrink-0">
                      <AvatarFallback className="text-[9px]">
                        {bug.assignee.initial}
                      </AvatarFallback>
                    </Avatar>
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
        )}
      </div>

      <TaskDetailSheet
        key={`${activeItem?.id ?? "empty"}:${detailRevision}`}
        item={activeItem}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        organizationId={organizationId}
        spaceId={spaceId}
        onChanged={() => {
          setDetailRevision((revision) => revision + 1);
          void fetchBugs();
        }}
      />

      {spaceId && canCreateBug && (
        <CreateBugDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          spaceId={spaceId}
          onCreated={() => {
            void fetchBugs();
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
          onUpdated={handleBugUpdated}
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

function canCreateBugs(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return (
    (role === "SPACE_ADMIN" || role === "PM" || role === "TESTER") &&
    status !== "DISABLED"
  );
}

function canEditBug(
  bug: BugView | undefined,
  role: string | undefined,
  status: string | undefined,
): boolean {
  return canWriteBugs(role, status) && bug?.permissions?.canEdit === true;
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
  lookups: BugLookupHelpers,
): BugItemViewModel {
  const code = formatDisplayCode("BUG", bug.id);
  const member = bug.assigneeId ? lookups.getMember(bug.assigneeId) : undefined;
  const assigneeName = member?.user.name ?? member?.user.username ?? "";
  const initial = deriveInitial(assigneeName);
  const version = bug.versionId ? lookups.getVersion(bug.versionId) : undefined;
  const dueDate = bug.dueDate ? formatDate(bug.dueDate) : undefined;
  const isOverdue = bug.dueDate
    ? new Date(bug.dueDate).getTime() < Date.now() &&
      bug.statusCategory !== "DONE" &&
      bug.statusCategory !== "TERMINATED"
    : false;
  const isBlocked = bug.statusCategory === "WAITING" || Boolean(bug.blockedAt);
  const workflowState = lookups.getWorkflowState(
    bug.workflowVersionId,
    bug.currentStateId,
  );
  const lifecycleBucket = resolveBugLifecycleBucket(bug, workflowState?.code);
  const statusLabel = workflowState?.name ?? tStatus(bug.statusCategory);

  return {
    id: bug.id,
    code,
    type: "BUG",
    title: bug.title,
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
    lifecycleBucket,
    severity: bug.bugDetail.severity,
  };
}

function resolveBugLifecycleBucket(
  bug: Pick<BugView, "statusCategory">,
  stateCode: string | undefined,
): Exclude<BugLifecycleBucket, "all"> {
  if (stateCode) {
    const normalized = stateCode.trim().toUpperCase();
    const match = bugBucketStatus.find((bucket) =>
      bugBucketStateCodes[bucket].includes(normalized),
    );
    if (match) {
      return match;
    }
  }

  return bugBucketByCategory[bug.statusCategory] ?? "pendingConfirm";
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

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return iso;
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
  } catch {
    return iso;
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
