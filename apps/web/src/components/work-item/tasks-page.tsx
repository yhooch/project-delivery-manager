"use client";

import type {
  StatusCategory,
  WorkItem,
} from "@project-delivery/shared";
import { Filter, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import type { WorkItemViewModel } from "../../lib/v2/mock-data";
import { listWorkItems } from "../../lib/work-item-service";
import type {
  SpaceMemberWithUser,
  Version,
} from "@project-delivery/shared";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useSession } from "../providers/session-provider";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";
import { WorkItemRow } from "../v2/work-item-row";

import { CreateTaskDialog } from "./create-task-dialog";
import { TaskDetailSheet } from "./task-detail-sheet";

type StatusFilterKey = "all" | StatusCategory;

export function TasksPage() {
  const tNav = useTranslations("shell.nav");
  const t = useTranslations("tasks");
  const tStatus = useTranslations("workItems.statusCategory");
  const tApiError = useTranslations();

  const { currentSpace, status: sessionStatus } = useSession();
  const spaceId = currentSpace?.id;
  const organizationId = currentSpace?.organizationId;
  const { getMember } = useSpaceMembers(spaceId, organizationId);
  const { getVersion } = useVersions(spaceId, organizationId);

  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await listWorkItems({ spaceId, type: "TASK" });
      setItems(result.items);
    } catch (error) {
      const key = getApiErrorMessageKey(error);
      setErrorMessage(tApiError(key));
    } finally {
      setLoading(false);
    }
  }, [spaceId, tApiError]);

  useEffect(() => {
    if (spaceId) {
      void fetchTasks();
    } else {
      setItems([]);
    }
  }, [fetchTasks, spaceId]);

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
      if (statusFilter !== "all" && task.statusCategory !== statusFilter) {
        return false;
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          task.title.toLowerCase().includes(q) ||
          task.code.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [mockItems, query, statusFilter]);

  const open = (item: WorkItemViewModel) => {
    setActiveItem(item);
    setSheetOpen(true);
  };

  const header = (
    <PageHeader
      eyebrow={tNav("group.deliver")}
      title={tNav("tasks")}
      description={t("page.description")}
      actions={
        <>
          <Button variant="outline" size="sm" className="text-xs">
            <Filter className="h-3 w-3" />
            {t("actions.filter")}
          </Button>
          <Button
            size="sm"
            className="text-xs"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3 w-3" />
            {t("actions.create")}
          </Button>
        </>
      }
    />
  );

  if (sessionStatus === "loading") {
    return (
      <div className="flex h-full flex-col">
        {header}
        <ListSkeleton />
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <EmptyState
          title={t("states.noSpace.title")}
          description={t("states.noSpace.description")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
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
              onClick={() => setStatusFilter(b.key)}
              className={`h-7 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer ${
                statusFilter === b.key
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

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
          <ul className="divide-y divide-border">
            {filtered.map((item) => (
              <li key={item.id}>
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
      />

      {spaceId && (
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
  const member = item.assigneeId ? lookups.getMember(item.assigneeId) : undefined;
  const assigneeName = member?.user.name ?? member?.user.username ?? item.assigneeId ?? "";
  const initial = deriveInitial(assigneeName);
  const version = item.versionId ? lookups.getVersion(item.versionId) : undefined;
  const dueDate = item.dueDate ? formatDate(item.dueDate) : undefined;
  const isOverdue = item.dueDate
    ? new Date(item.dueDate).getTime() < Date.now() &&
      item.statusCategory !== "DONE" &&
      item.statusCategory !== "TERMINATED"
    : false;
  const isBlocked = item.statusCategory === "WAITING" || Boolean(item.blockedAt);

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
