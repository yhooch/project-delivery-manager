"use client";

import type {
  BugSeverity,
  BugView,
  StatusCategory,
} from "@project-delivery/shared";
import { Bug, Filter, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { listBugs } from "../../lib/bug-service";
import { useListKeyboardNav } from "../../lib/hooks/use-list-keyboard-nav";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { cn } from "../../lib/utils";
import type { SpaceMemberWithUser, Version } from "@project-delivery/shared";

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

const severityColor: Record<BugSeverity, string> = {
  BLOCKER: "bg-destructive text-destructive-foreground",
  CRITICAL: "bg-destructive/15 text-destructive",
  MAJOR: "bg-warning/15 text-warning",
  MINOR: "bg-info/15 text-info",
  TRIVIAL: "bg-muted text-muted-foreground",
};

type FilterKey =
  | "all"
  | "pendingConfirm"
  | "pendingFix"
  | "fixing"
  | "pendingRegression"
  | "regressionPassed"
  | "closed";

const bugBucketStatus: Exclude<FilterKey, "all">[] = [
  "pendingConfirm",
  "pendingFix",
  "fixing",
  "pendingRegression",
  "regressionPassed",
  "closed",
];

const bugBucketCategory: Record<Exclude<FilterKey, "all">, StatusCategory> = {
  pendingConfirm: "NOT_STARTED",
  pendingFix: "WAITING",
  fixing: "IN_PROGRESS",
  pendingRegression: "VERIFYING",
  regressionPassed: "DONE",
  closed: "TERMINATED",
};

type MockBugItem = WorkItemViewModel & { severity: BugSeverity };

export function BugsPage() {
  const tNav = useTranslations("shell.nav");
  const t = useTranslations("bugs");
  const tStatus = useTranslations("bugs.statusCategory");
  const tSeverity = useTranslations("bugs.severity");
  const tApiError = useTranslations();

  const { currentSpace, status: sessionStatus } = useSession();
  const spaceId = currentSpace?.id;
  const organizationId = currentSpace?.organizationId;
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );
  const { getMember } = useSpaceMembers(spaceId, organizationId);
  const { getVersion } = useVersions(spaceId, organizationId);

  const [items, setItems] = useState<BugView[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const fetchBugs = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const result = await listBugs({ spaceId, type: "BUG" });
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
      void fetchBugs();
    } else {
      setItems([]);
    }
  }, [fetchBugs, spaceId]);

  const mockItems = useMemo<MockBugItem[]>(
    () =>
      items.map((bug) =>
        toMockBug(bug, tStatus, {
          getMember,
          getVersion,
        }),
      ),
    [getMember, getVersion, items, tStatus],
  );

  const filtered = useMemo(() => {
    if (filter !== "all") {
      return mockItems.filter(
        (bug) => bug.statusCategory === bugBucketCategory[filter],
      );
    }
    return mockItems;
  }, [filter, mockItems]);

  const openBug = useCallback(
    (bug: MockBugItem) => {
      recordRecentOpen(
        {
          id: bug.id,
          type: "BUG",
          code: bug.code,
          title: bug.title,
          href: "/bugs",
        },
        recentScope,
      );
      setActiveItem(bug);
      setSheetOpen(true);
    },
    [recentScope],
  );

  useListKeyboardNav<MockBugItem>({
    items: filtered,
    activeId: activeItem?.id,
    getId: (item) => item.id,
    onSelect: setActiveItem,
    onOpen: openBug,
    onEdit: openBug,
    onClose: () => setSheetOpen(false),
  });

  const buckets = useMemo(
    () => [
      {
        label: t("buckets.all"),
        key: "all" as FilterKey,
        count: mockItems.length,
      },
      ...bugBucketStatus.map((key) => ({
        label: tStatus(bugBucketCategory[key]),
        key,
        count: mockItems.filter(
          (bug) => bug.statusCategory === bugBucketCategory[key],
        ).length,
      })),
    ],
    [mockItems, t, tStatus],
  );

  const header = (
    <PageHeader
      eyebrow={tNav("group.deliver")}
      title={tNav("bugs")}
      description={t("page.description")}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            data-testid="bugs-filter-button"
          >
            <Filter className="h-3 w-3" />
            {t("actions.filter")}
          </Button>
          <Button
            size="sm"
            className="text-xs"
            data-testid="bugs-create-button"
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
      <div data-testid="bugs-page" className="flex h-full flex-col">
        {header}
        <ListSkeleton />
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div data-testid="bugs-page" className="flex h-full flex-col">
        {header}
        <EmptyState
          title={t("states.noSpace.title")}
          description={t("states.noSpace.description")}
        />
      </div>
    );
  }

  return (
    <div data-testid="bugs-page" className="flex h-full flex-col">
      {header}

      <div className="flex items-center gap-1 border-b border-border px-6 py-3">
        {buckets.map((b) => (
          <button
            key={b.key}
            type="button"
            data-testid={`bugs-filter-${b.key}`}
            onClick={() => setFilter(b.key)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer",
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

      <div className="flex-1 overflow-y-auto">
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
          <ul data-testid="bugs-list" className="divide-y divide-border">
            {filtered.map((bug) => (
              <li key={bug.id} data-testid={`bugs-row-${bug.id}`}>
                <button
                  type="button"
                  onClick={() => openBug(bug)}
                  className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-muted/40 cursor-pointer"
                >
                  <Bug className="h-3.5 w-3.5 shrink-0 text-destructive/80" />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {bug.code}
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium">
                    {bug.title}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      severityColor[bug.severity],
                    )}
                  >
                    {tSeverity(bug.severity)}
                  </span>
                  <StatusBadge
                    category={bug.statusCategory}
                    label={bug.statusLabel}
                    withDot={false}
                  />
                  {bug.versionName && (
                    <Badge variant="outline" className="hidden md:inline-flex">
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
              </li>
            ))}
          </ul>
        )}
      </div>

      <TaskDetailSheet
        item={activeItem}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={() => {
          void fetchBugs();
        }}
      />

      {spaceId && (
        <CreateBugDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          spaceId={spaceId}
          onCreated={() => {
            void fetchBugs();
          }}
        />
      )}
    </div>
  );
}

type BugLookupHelpers = {
  getMember: (userId: string) => SpaceMemberWithUser | undefined;
  getVersion: (versionId: string) => Version | undefined;
};

function toMockBug(
  bug: BugView,
  tStatus: (key: StatusCategory) => string,
  lookups: BugLookupHelpers,
): MockBugItem {
  const code = deriveBugCode(bug.id);
  const member = bug.assigneeId ? lookups.getMember(bug.assigneeId) : undefined;
  const assigneeName =
    member?.user.name ?? member?.user.username ?? bug.assigneeId ?? "";
  const initial = deriveInitial(assigneeName);
  const version = bug.versionId ? lookups.getVersion(bug.versionId) : undefined;
  const dueDate = bug.dueDate ? formatDate(bug.dueDate) : undefined;
  const isOverdue = bug.dueDate
    ? new Date(bug.dueDate).getTime() < Date.now() &&
      bug.statusCategory !== "DONE" &&
      bug.statusCategory !== "TERMINATED"
    : false;
  const isBlocked = bug.statusCategory === "WAITING" || Boolean(bug.blockedAt);

  return {
    id: bug.id,
    code,
    type: "BUG",
    title: bug.title,
    statusCategory: bug.statusCategory,
    statusLabel: tStatus(bug.statusCategory),
    priority: bug.priority,
    assignee: { name: assigneeName, initial },
    versionName: version?.name,
    dueDate,
    isOverdue,
    isBlocked,
    blockedReason: bug.blockedReason,
    updatedAgo: undefined,
    severity: bug.bugDetail.severity,
  };
}

function deriveBugCode(id: string): string {
  const tail = id.slice(-6).toUpperCase();
  return `BUG-${tail}`;
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
