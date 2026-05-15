"use client";

import type {
  Priority,
  Requirement,
  SpaceMemberWithUser,
  StatusCategory,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import { Filter, Plus, Search } from "lucide-react";
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
import { useListKeyboardNav } from "../../lib/hooks/use-list-keyboard-nav";
import { listRequirements } from "../../lib/requirement-service";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import {
  getWorkItem,
  listWorkItems,
  type TaskListFilterState,
} from "../../lib/work-item-service";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
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

export function TasksPage() {
  const tNav = useTranslations("shell.nav");
  const t = useTranslations("tasks");
  const tStatus = useTranslations("workItems.statusCategory");
  const tPriority = useTranslations("workItems.priority");
  const tFilters = useTranslations("workItems.filters");
  const tApiError = useTranslations();
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
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );
  const { members, getMember } = useSpaceMembers(spaceId, organizationId);
  const { versions, getVersion } = useVersions(spaceId, organizationId);

  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TaskListFilterState>(() => ({
    intakeItemId: requestedIntakeItemId,
  }));
  const [filterOpen, setFilterOpen] = useState(false);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [handledDeepLinkKey, setHandledDeepLinkKey] = useState<string | null>(
    null,
  );
  const canCreateTask = canWriteWorkItems(
    currentSpace?.role,
    currentSpace?.status,
  );

  const setFilter = useCallback(
    (key: keyof TaskListFilterState, value: string) => {
      setFilters((current) => ({ ...current, [key]: value || undefined }));
    },
    [],
  );

  const fetchTasks = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setHasLoadedItems(false);
    setErrorMessage(null);

    try {
      const result = await listWorkItems({
        organizationId,
        spaceId,
        type: "TASK",
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
      void fetchTasks();
    } else {
      setItems([]);
      setHasLoadedItems(false);
    }
  }, [fetchTasks, spaceId]);

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

  const buckets: { label: string; key: StatusFilterKey }[] = useMemo(
    () => [
      { label: t("buckets.all"), key: "all" },
      { label: tStatus("NOT_STARTED"), key: "NOT_STARTED" },
      { label: tStatus("IN_PROGRESS"), key: "IN_PROGRESS" },
      { label: tStatus("WAITING"), key: "WAITING" },
      { label: tStatus("VERIFYING"), key: "VERIFYING" },
      { label: tStatus("DONE"), key: "DONE" },
    ],
    [t, tStatus],
  );

  const mockItems = useMemo(
    () =>
      items.map((item) =>
        toMockWorkItem(item, tStatus, {
          getMember,
          getVersion,
        }),
      ),
    [getMember, getVersion, items, tStatus],
  );

  const filtered = useMemo(() => {
    return mockItems.filter((task) => {
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          task.title.toLowerCase().includes(q) ||
          task.code.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [mockItems, query]);

  const open = useCallback(
    (item: WorkItemViewModel) => {
      recordRecentOpen(
        {
          id: item.id,
          type: "TASK",
          code: item.code,
          title: item.title,
          href: "/work-items",
        },
        recentScope,
      );
      setActiveItem(item);
      setSheetOpen(true);
    },
    [recentScope],
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
    if (!requestedWorkItemId || !spaceId) {
      return;
    }

    const key = `workItem:${spaceId}:${requestedWorkItemId}`;
    if (handledDeepLinkKey === key) {
      return;
    }

    const listed = mockItems.find((item) => item.id === requestedWorkItemId);
    if (listed) {
      open(listed);
      setHandledDeepLinkKey(key);
      return;
    }

    if (loading || !hasLoadedItems) {
      return;
    }

    let cancelled = false;
    void getWorkItem({ organizationId, spaceId, workItemId: requestedWorkItemId })
      .then((item) => {
        if (!cancelled) {
          open(toMockWorkItem(item, tStatus, { getMember, getVersion }));
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
    mockItems,
    open,
    organizationId,
    requestedWorkItemId,
    spaceId,
    tStatus,
  ]);

  const select = (item: WorkItemViewModel) => {
    setActiveItem(item);
  };

  useListKeyboardNav<WorkItemViewModel>({
    items: filtered,
    activeId: activeItem?.id,
    getId: (item) => item.id,
    onSelect: select,
    onOpen: open,
    onEdit: open,
    onClose: () => setSheetOpen(false),
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

  if (sessionStatus === "loading") {
    return (
      <div data-testid="tasks-page" className="flex h-full flex-col">
        {header}
        <ListSkeleton />
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div data-testid="tasks-page" className="flex h-full flex-col">
        {header}
        <EmptyState
          title={t("states.noSpace.title")}
          description={t("states.noSpace.description")}
        />
      </div>
    );
  }

  return (
    <div data-testid="tasks-page" className="flex h-full flex-col">
      {header}

      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-7"
          />
        </div>
        <div className="flex items-center gap-1">
          {buckets.map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() =>
                setFilter("statusCategory", b.key === "all" ? "" : b.key)
              }
              className={`h-7 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer ${
                (filters.statusCategory ?? "all") === b.key
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {filterOpen && (
        <div
          data-testid="tasks-filter-panel"
          className="grid gap-3 border-b border-border bg-muted/20 px-6 py-3 md:grid-cols-5"
        >
          <FilterField label={tFilters("version")}>
            <select
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
            </select>
          </FilterField>
          <FilterField label={tFilters("assignee")}>
            <select
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
            </select>
          </FilterField>
          <FilterField label={tFilters("statusCategory")}>
            <select
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
            </select>
          </FilterField>
          <FilterField label={tFilters("priority")}>
            <select
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
            </select>
          </FilterField>
          <FilterField label={tFilters("requirement")}>
            <select
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
            </select>
          </FilterField>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
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
          <EmptyState
            title={t("states.empty.title")}
            description={t("states.empty.description")}
          />
        ) : (
          <ul data-testid="tasks-list" className="divide-y divide-border">
            {filtered.map((item) => (
              <li key={item.id} data-testid={`tasks-row-${item.id}`}>
                <WorkItemRow item={item} onSelect={open} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <TaskDetailSheet
        item={activeItem}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        organizationId={organizationId}
        spaceId={spaceId}
        onChanged={() => {
          void fetchTasks();
        }}
      />

      {spaceId && canCreateTask && (
        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          spaceId={spaceId}
          onCreated={() => {
            void fetchTasks();
          }}
        />
      )}
    </div>
  );
}

function canWriteWorkItems(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(role) && role !== "VIEWER" && status !== "DISABLED";
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

type LookupHelpers = {
  getMember: (userId: string) => SpaceMemberWithUser | undefined;
  getVersion: (versionId: string) => Version | undefined;
};

function toMockWorkItem(
  item: WorkItem,
  tStatus: (key: StatusCategory) => string,
  lookups: LookupHelpers,
): WorkItemViewModel {
  const code = deriveCode(item.id, item.type);
  const member = item.assigneeId
    ? lookups.getMember(item.assigneeId)
    : undefined;
  const assigneeName =
    member?.user.name ?? member?.user.username ?? item.assigneeId ?? "";
  const initial = deriveInitial(assigneeName);
  const version = item.versionId
    ? lookups.getVersion(item.versionId)
    : undefined;
  const dueDate = item.dueDate ? formatDate(item.dueDate) : undefined;
  const isOverdue = item.dueDate
    ? new Date(item.dueDate).getTime() < Date.now() &&
      item.statusCategory !== "DONE" &&
      item.statusCategory !== "TERMINATED"
    : false;
  const isBlocked =
    item.statusCategory === "WAITING" || Boolean(item.blockedAt);

  return {
    id: item.id,
    code,
    type: item.type,
    title: item.title,
    statusCategory: item.statusCategory,
    statusLabel: tStatus(item.statusCategory),
    priority: item.priority,
    assignee: { name: assigneeName, initial },
    versionName: version?.name,
    dueDate,
    isOverdue,
    isBlocked,
    blockedReason: item.blockedReason,
    updatedAgo: undefined,
  };
}

function deriveCode(id: string, type: "TASK" | "BUG"): string {
  const tail = id.slice(-6).toUpperCase();
  return `${type}-${tail}`;
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
