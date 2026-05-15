"use client";

import type {
  GetMyWorkbenchViewResponse,
  SpaceMemberWithUser,
  StatusCategory,
  Version,
  ViewWorkItemSummary,
} from "@project-delivery/shared";
import {
  AlertCircle,
  ArrowUpRight,
  Bug,
  CheckCircle2,
  Clock,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { cn } from "../../lib/utils";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { getMyWorkbenchView } from "../../lib/view-service";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";

import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";

const priorityDotColor: Record<WorkItemViewModel["priority"], string> = {
  LOW: "bg-muted-foreground/40",
  MEDIUM: "bg-info",
  HIGH: "bg-warning",
  URGENT: "bg-destructive",
};

export function MyWorkbench() {
  const t = useTranslations("workbench");
  const tStatusCategory = useTranslations("workItems.statusCategory");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { session, currentSpace } = useSession();
  const [view, setView] = useState<GetMyWorkbenchViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const organizationId = session?.defaultOrganizationId;
  const spaceId = session?.defaultSpaceId;
  // Lookups: hooks return empty results gracefully when spaceId is undefined.
  const { getMember } = useSpaceMembers(spaceId, organizationId);
  const { getVersion } = useVersions(spaceId, organizationId);

  const fetchView = useCallback(async () => {
    if (!organizationId) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const next = await getMyWorkbenchView({
        organizationId,
        spaceId: spaceId ?? undefined,
      });
      setView(next);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, spaceId]);

  useEffect(() => {
    if (!organizationId) {
      setView(null);
      return;
    }

    let active = true;

    async function load() {
      setIsLoading(true);
      setErrorKey(null);

      try {
        const next = await getMyWorkbenchView({
          organizationId: organizationId!,
          spaceId: spaceId ?? undefined,
        });

        if (active) {
          setView(next);
        }
      } catch (error) {
        if (active) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [organizationId, spaceId]);

  const openItem = (item: WorkItemViewModel) => {
    recordRecentOpen(
      {
        id: item.id,
        type: item.type,
        code: item.code,
        title: item.title,
        href: item.type === "BUG" ? "/bugs" : "/work-items",
      },
      { organizationId, spaceId },
    );
    setActiveItem(item);
    setSheetOpen(true);
  };

  const greetingName = session?.user.name ?? t("title");

  const todoItems = useMemo(
    () =>
      (view?.sections.myTodos.items.items ?? []).map(
        toMockWorkItem(locale, { getMember, getVersion }, tStatusCategory),
      ),
    [view, locale, getMember, getVersion, tStatusCategory],
  );
  const assignedTaskItems = useMemo(
    () =>
      (view?.sections.assignedTasks.items.items ?? []).map(
        toMockWorkItem(locale, { getMember, getVersion }, tStatusCategory),
      ),
    [view, locale, getMember, getVersion, tStatusCategory],
  );
  const assignedBugItems = useMemo(
    () =>
      (view?.sections.assignedBugs.items.items ?? []).map(
        toMockWorkItem(locale, { getMember, getVersion }, tStatusCategory),
      ),
    [view, locale, getMember, getVersion, tStatusCategory],
  );
  const actionItems = useMemo(() => {
    const toWorkItem = toMockWorkItem(
      locale,
      { getMember, getVersion },
      tStatusCategory,
    );

    return (view?.sections.actionTodos.items.items ?? []).map((todo) => ({
      ...toWorkItem(todo.workItem),
      contextLabel: todo.availableAction.name,
      listKey: todo.id,
    }));
  }, [view, locale, getMember, getVersion, tStatusCategory]);
  const pendingConfirmItems = useMemo(
    () =>
      (view?.sections.pendingConfirm.items.items ?? []).map(
        toMockWorkItem(locale, { getMember, getVersion }, tStatusCategory),
      ),
    [view, locale, getMember, getVersion, tStatusCategory],
  );
  const dueSoonItems = useMemo(
    () =>
      (view?.sections.dueSoon.items.items ?? []).map(
        toMockWorkItem(locale, { getMember, getVersion }, tStatusCategory),
      ),
    [view, locale, getMember, getVersion, tStatusCategory],
  );
  const blockedItems = useMemo(
    () =>
      (view?.sections.blocked?.items.items ?? []).map(
        toMockWorkItem(locale, { getMember, getVersion }, tStatusCategory),
      ),
    [view, locale, getMember, getVersion, tStatusCategory],
  );
  const recentEvents = view?.sections.recentActivities.items.items ?? [];

  const stats = view?.stats;
  const todoCount = view?.sections.myTodos.total ?? todoItems.length;
  const assignedTaskCount =
    view?.sections.assignedTasks.total ?? assignedTaskItems.length;
  const assignedBugCount =
    view?.sections.assignedBugs.total ?? assignedBugItems.length;
  const actionCount = view?.sections.actionTodos.total ?? actionItems.length;
  const pendingConfirmSectionCount =
    view?.sections.pendingConfirm.total ?? pendingConfirmItems.length;
  const dueSoonCount = view?.sections.dueSoon.total ?? dueSoonItems.length;
  const blockedSectionCount =
    view?.sections.blocked?.total ?? blockedItems.length;
  // Show "—" if backend view did not include stats (graceful degradation).
  const blockedCount: number | undefined = stats?.blockedCount;
  const pendingConfirmCount: number | undefined = stats?.pendingConfirmCount;

  if (!session) {
    return (
      <div
        data-testid="workbench-page"
        className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6"
      >
        <EmptyState
          title={t("empty.signIn.title")}
          description={t("empty.signIn.description")}
        />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div
        data-testid="workbench-page"
        className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6"
      >
        <EmptyState
          title={t("empty.noOrganization.title")}
          description={t("empty.noOrganization.description")}
        />
      </div>
    );
  }

  if (errorKey) {
    return (
      <div
        data-testid="workbench-page"
        className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6"
      >
        <ErrorState
          title={t("errorTitle")}
          message={tRoot(errorKey)}
          onRetry={() => void fetchView()}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="workbench-page"
      className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6"
    >
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-primary">
            {currentSpace?.name ?? t("title")}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            {greetingName} · {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="ghost" size="sm" className="text-xs">
          {t("viewAll")}
          <ArrowUpRight className="h-3 w-3" />
        </Button>
      </div>

      {/* Summary chips */}
      <div
        data-testid="workbench-summary"
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
      >
        <SummaryChip
          icon={Inbox}
          tone="primary"
          value={todoCount}
          label={t("summary.todo")}
        />
        <SummaryChip
          icon={Clock}
          tone="info"
          value={dueSoonCount}
          label={t("summary.dueSoon")}
        />
        <SummaryChip
          icon={AlertCircle}
          tone="warning"
          value={blockedCount}
          label={t("summary.blocked")}
        />
        <SummaryChip
          icon={CheckCircle2}
          tone="success"
          value={pendingConfirmCount}
          label={t("summary.pendingConfirm")}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Section
            title={t("sections.todo")}
            count={todoCount}
            empty={t("empty.todo")}
            isLoading={isLoading && !view}
          >
            <ItemList items={todoItems} onSelect={openItem} />
          </Section>

          <Section
            title={t("sections.assignedTasks")}
            count={assignedTaskCount}
            empty={t("empty.assignedTasks")}
            isLoading={isLoading && !view}
          >
            <ItemList items={assignedTaskItems} onSelect={openItem} />
          </Section>

          <Section
            title={t("sections.assignedBugs")}
            count={assignedBugCount}
            empty={t("empty.assignedBugs")}
            isLoading={isLoading && !view}
          >
            <ItemList items={assignedBugItems} onSelect={openItem} />
          </Section>

          <Section
            title={t("sections.actions")}
            count={actionCount}
            empty={t("empty.actions")}
            isLoading={isLoading && !view}
          >
            <ItemList items={actionItems} onSelect={openItem} />
          </Section>

          <Section
            title={t("sections.pendingConfirm")}
            count={pendingConfirmSectionCount}
            empty={t("empty.pendingConfirm")}
            isLoading={isLoading && !view}
          >
            <ItemList items={pendingConfirmItems} onSelect={openItem} />
          </Section>

          <Section
            title={t("sections.dueSoon")}
            count={dueSoonCount}
            empty={t("empty.dueSoon")}
            isLoading={isLoading && !view}
          >
            <ItemList items={dueSoonItems} onSelect={openItem} />
          </Section>

          <Section
            title={t("sections.blocked")}
            count={blockedSectionCount}
            empty={t("empty.blocked")}
            isLoading={isLoading && !view}
          >
            <ItemList items={blockedItems} onSelect={openItem} />
          </Section>
        </div>

        <aside className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("sections.recent")}</h3>
            <Button variant="ghost" size="icon-sm">
              <ArrowUpRight className="h-3 w-3" />
            </Button>
          </div>
          {isLoading && !view ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-10 animate-pulse rounded-md bg-muted/60"
                />
              ))}
            </div>
          ) : recentEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("empty.recent")}
            </p>
          ) : (
            <ul className="space-y-3">
              {recentEvents.map((event) => (
                <li key={event.id} className="flex gap-2.5">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px]">
                      {initialOf(event.actor.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-[12px]">
                    <div className="leading-snug">
                      <span className="font-medium">{event.actor.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        {event.title}{" "}
                      </span>
                      {event.target.title && (
                        <span className="font-mono text-[11px]">
                          {event.target.title}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatTimeAgo(event.createdAt, locale, t("time.justNow"))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <TaskDetailSheet
        item={activeItem}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={() => {
          void fetchView();
        }}
      />
    </div>
  );
}

type SummaryTone = "primary" | "info" | "warning" | "success";

const toneClass: Record<SummaryTone, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
};

function SummaryChip({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: LucideIcon;
  tone: SummaryTone;
  value: number | undefined;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-4 py-3">
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", toneClass[tone])}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex flex-col">
        <span className="text-lg font-semibold leading-none">
          {typeof value === "number" ? value : "—"}
        </span>
        <span className="mt-1 text-[11px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  empty,
  isLoading,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card/40">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {count}
          </span>
        </div>
      </header>
      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : count === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-muted-foreground">
          {empty}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function ItemList({
  items,
  onSelect,
}: {
  items: WorkItemViewModel[];
  onSelect: (item: WorkItemViewModel) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.listKey ?? item.id}>
          <button
            type="button"
            onClick={() => onSelect(item)}
            className="group flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/40 cursor-pointer"
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityDotColor[item.priority])} />
            {item.type === "BUG" ? (
              <Bug className="h-3.5 w-3.5 shrink-0 text-destructive/80" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            )}
            <span className="font-mono text-[11px] text-muted-foreground">
              {item.code}
            </span>
            <span className="flex-1 truncate text-[13px] font-medium">
              {item.title}
            </span>
            {item.contextLabel ? (
              <Badge
                variant="outline"
                className="hidden max-w-36 truncate md:inline-flex"
              >
                {item.contextLabel}
              </Badge>
            ) : null}
            <StatusBadge category={item.statusCategory} label={item.statusLabel} withDot={false} />
            {item.versionName && (
              <Badge variant="outline" className="hidden md:inline-flex">
                {item.versionName}
              </Badge>
            )}
            {item.dueDate && (
              <span
                className={cn(
                  "hidden text-[11px] md:inline-block",
                  item.isOverdue ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {item.dueDate}
              </span>
            )}
            <Avatar className="h-5 w-5 shrink-0">
              <AvatarFallback className="text-[9px]">
                {item.assignee.initial}
              </AvatarFallback>
            </Avatar>
          </button>
        </li>
      ))}
    </ul>
  );
}

const STATUS_LABEL_ZH: Record<StatusCategory, string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "进行中",
  WAITING: "等待中",
  VERIFYING: "验证中",
  DONE: "已完成",
  TERMINATED: "已终止",
};

const STATUS_LABEL_EN: Record<StatusCategory, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
  VERIFYING: "Verifying",
  DONE: "Done",
  TERMINATED: "Terminated",
};

export type WorkbenchLookupHelpers = {
  getMember: (userId: string) => SpaceMemberWithUser | undefined;
  getVersion: (versionId: string) => Version | undefined;
};

export function toMockWorkItem(
  locale: string,
  lookups?: WorkbenchLookupHelpers,
  statusLabel?: (category: StatusCategory) => string,
) {
  const labels = locale.startsWith("zh") ? STATUS_LABEL_ZH : STATUS_LABEL_EN;

  return (item: ViewWorkItemSummary): WorkItemViewModel => {
    const code = `${item.type === "BUG" ? "BUG" : "TASK"}-${item.id.slice(-6).toUpperCase()}`;
    const isOverdue = item.exceptionSignals.some(
      (signal) => signal.type === "overdue",
    );
    const blockedSignal = item.exceptionSignals.find(
      (signal) => signal.type === "blocked",
    );
    const dueDate = item.dueDate
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
          new Date(item.dueDate),
        )
      : undefined;
    const updatedAgo = item.lastActionAt
      ? formatTimeAgo(item.lastActionAt, locale)
      : undefined;

    const member = item.assigneeId
      ? lookups?.getMember(item.assigneeId)
      : undefined;
    const assigneeName =
      member?.user.name ?? member?.user.username ?? item.assigneeId ?? "—";
    const version = item.versionId
      ? lookups?.getVersion(item.versionId)
      : undefined;
    // Fall back to the legacy short-id form when lookups are cold so the badge
    // still shows _something_ for the user instead of disappearing entirely.
    const versionName = item.versionId
      ? version?.name ?? item.versionId.slice(-4)
      : undefined;

    return {
      id: item.id,
      code,
      type: item.type,
      title: item.title,
      statusCategory: item.currentStatus.statusCategory,
      statusLabel:
        statusLabel?.(item.currentStatus.statusCategory) ??
        labels[item.currentStatus.statusCategory] ??
        item.currentStatus.stateName,
      priority: item.priority,
      assignee: {
        name: assigneeName,
        initial: initialOf(assigneeName),
      },
      versionName,
      dueDate,
      isOverdue,
      isBlocked: Boolean(blockedSignal),
      blockedReason: blockedSignal?.reason,
      updatedAgo,
    };
  };
}

function initialOf(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "?";
  }

  return trimmed.slice(0, 1).toUpperCase();
}

function formatTimeAgo(value: string, locale: string, justNow?: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (Math.abs(diffMin) < 1) {
    return justNow ?? (locale.startsWith("zh") ? "刚刚" : "just now");
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffMin) < 60) {
    return rtf.format(-diffMin, "minute");
  }

  const diffHour = Math.round(diffMin / 60);

  if (Math.abs(diffHour) < 24) {
    return rtf.format(-diffHour, "hour");
  }

  const diffDay = Math.round(diffHour / 24);

  return rtf.format(-diffDay, "day");
}
