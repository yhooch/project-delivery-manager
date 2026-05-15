"use client";

import type {
  GetSpaceOverviewViewResponse,
  StatusCategory,
  TimelineEvent,
  ViewExceptionType,
  ViewStatusCount,
} from "@project-delivery/shared";
import {
  AlertTriangle,
  ArrowUpRight,
  Bug,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  FileText,
  GitBranch,
  PauseCircle,
  RotateCw,
  Target,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { useVersions } from "../../lib/v2/lookups";
import { getSpaceOverviewView } from "../../lib/view-service";
import { Link, usePathname, useRouter } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { StatusBadge } from "../ui/status-badge";
import { PageHeader } from "../v2/page-header";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";

const STATUS_ORDER: StatusCategory[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
];

const EXCEPTION_ORDER: ViewExceptionType[] = [
  "overdue",
  "blocked",
  "pending_confirm",
  "pending_regression",
  "stale",
];

const statusBarClass: Record<StatusCategory, string> = {
  NOT_STARTED: "bg-muted-foreground/40",
  IN_PROGRESS: "bg-primary",
  WAITING: "bg-warning",
  VERIFYING: "bg-info",
  DONE: "bg-success",
  TERMINATED: "bg-muted-foreground/60",
};

const exceptionToneClass: Record<ViewExceptionType, string> = {
  overdue: "text-destructive",
  blocked: "text-warning",
  pending_confirm: "text-info",
  pending_regression: "text-info",
  stale: "text-muted-foreground",
};

const exceptionIcon: Record<ViewExceptionType, LucideIcon> = {
  overdue: Clock,
  blocked: PauseCircle,
  pending_confirm: CheckCircle2,
  pending_regression: Bug,
  stale: Target,
};

const versionStatusToCategory: Record<string, StatusCategory> = {
  PLANNED: "NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  RELEASED: "DONE",
  ARCHIVED: "TERMINATED",
};

export function SpaceOverview() {
  const t = useTranslations("spaceOverview");
  const tNav = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { session, currentSpace } = useSession();

  const organizationId = session?.defaultOrganizationId;
  const spaceId = session?.defaultSpaceId;
  const versionIdParam = searchParams.get("versionId") ?? undefined;

  const [view, setView] = useState<GetSpaceOverviewViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const { versions } = useVersions(spaceId, organizationId);

  const fetchView = useCallback(
    async (signal?: AbortSignal) => {
      if (!spaceId) {
        return;
      }
      setIsLoading(true);
      setErrorKey(null);
      try {
        const next = await getSpaceOverviewView({
          spaceId,
          organizationId,
          versionId: versionIdParam,
        });
        if (signal?.aborted) return;
        setView(next);
      } catch (error) {
        if (signal?.aborted) return;
        setErrorKey(getApiErrorMessageKey(error));
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [organizationId, spaceId, versionIdParam],
  );

  useEffect(() => {
    if (!spaceId) {
      setView(null);
      return;
    }
    const controller = new AbortController();
    void fetchView(controller.signal);
    return () => controller.abort();
  }, [fetchView, spaceId]);

  const setVersionFilter = useCallback(
    (versionId: string | undefined) => {
      const next = new URLSearchParams(searchParams.toString());
      if (versionId) {
        next.set("versionId", versionId);
      } else {
        next.delete("versionId");
      }
      const query = next.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      router.replace(target as never, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  if (!session) {
    return (
      <div data-testid="space-overview-page" className="flex h-full flex-col">
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("overview")}
          description={t("page.description")}
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
      <div data-testid="space-overview-page" className="flex h-full flex-col">
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("overview")}
          description={t("page.description")}
        />
        <div className="flex-1 px-6 py-6">
          <EmptyState
            title={t("noSpace.title")}
            description={t("noSpace.description")}
          />
        </div>
      </div>
    );
  }

  const stats = view?.stats;
  const currentVersion = view?.currentVersion;
  const recentEvents = view?.recentActivities?.items ?? [];
  const exceptionCounts = view?.exceptionCounts ?? [];
  const taskStatusCounts = view?.taskStatusCounts ?? [];
  const bugStatusCounts = view?.bugStatusCounts ?? [];
  const staleThresholdDays =
    view?.staleThresholdDays ?? view?.space.settings.staleThresholdDays;

  const taskTotal = stats?.taskCount ?? 0;
  const taskDone = stats?.completedTaskCount ?? 0;
  const taskPct = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0;

  const bugTotal = stats?.bugCount ?? 0;
  const bugOpen = stats?.openBugCount ?? 0;
  const bugClosePct =
    bugTotal > 0 ? Math.round(((bugTotal - bugOpen) / bugTotal) * 100) : 0;

  const totalExceptions = exceptionCounts.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  const versionProgress =
    taskTotal > 0 ? Math.min(1, Math.max(0, taskDone / taskTotal)) : 0;
  const versionName = currentVersion?.name ?? t("currentVersion.empty");
  const versionGoal =
    currentVersion?.target ?? t("currentVersion.emptyDescription");
  const versionDueDate = currentVersion?.targetDate
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(currentVersion.targetDate),
      )
    : t("currentVersion.noDate");

  const selectedVersion = versions.find((v) => v.id === versionIdParam);

  const headerEyebrow = view?.space.code
    ? `${currentSpace?.name ?? view.space.name} · ${view.space.code}`
    : (currentSpace?.name ?? tNav("group.deliver"));

  const taskStatusTotal = taskStatusCounts.reduce((s, c) => s + c.count, 0);
  const bugStatusTotal = bugStatusCounts.reduce((s, c) => s + c.count, 0);

  const buildLink = (base: string, extra?: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (versionIdParam) sp.set("versionId", versionIdParam);
    for (const [k, v] of Object.entries(extra ?? {})) sp.set(k, v);
    const q = sp.toString();
    return q ? `${base}?${q}` : base;
  };

  const buildTimelineHref = (event: TimelineEvent): string | null => {
    const { type, id } = event.target;
    if (type === "WORK_ITEM") return `/work-items?workItemId=${id}`;
    if (type === "REQUIREMENT") return `/requirements/${id}`;
    if (type === "INTAKE_ITEM") return `/intake-items?id=${id}`;
    if (type === "VERSION") return `/versions?versionId=${id}`;
    return null;
  };

  return (
    <div data-testid="space-overview-page" className="flex h-full flex-col">
      <PageHeader
        eyebrow={headerEyebrow}
        title={tNav("overview")}
        description={t("page.description")}
        actions={
          <>
            <VersionFilter
              t={t}
              versions={versions}
              selectedId={versionIdParam}
              onChange={setVersionFilter}
            />
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => void fetchView()}
              data-testid="space-overview-refresh"
              disabled={isLoading}
              aria-busy={isLoading}
            >
              <RotateCw
                className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`}
              />
              {t("actions.refresh")}
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {isLoading && !view ? (
          <LoadingState label={t("states.loading.title")} />
        ) : errorKey ? (
          <ErrorState
            title={t("errorTitle")}
            message={tRoot(errorKey)}
            onRetry={() => void fetchView()}
          />
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            {/* Meta strip — stale threshold and current filter */}
            {(staleThresholdDays !== undefined || selectedVersion) && (
              <div
                data-testid="space-overview-meta"
                className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground"
              >
                {staleThresholdDays !== undefined ? (
                  <span data-testid="space-overview-stale">
                    {t("header.staleThreshold", { days: staleThresholdDays })}
                  </span>
                ) : (
                  <span />
                )}
                {selectedVersion ? (
                  <span data-testid="space-overview-filtered-by">
                    {t("header.filteredBy", { version: selectedVersion.name })}
                  </span>
                ) : null}
              </div>
            )}

            {/* Current version hero */}
            <section
              data-testid="space-overview-current-version"
              className="rounded-lg border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-primary">
                    <GitBranch className="h-3 w-3" />
                    {t("currentVersion.title")}
                  </div>
                  <h2 className="mt-1 truncate text-lg font-semibold tracking-tight">
                    {versionName}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {versionGoal}
                  </p>
                  {currentVersion?.status ? (
                    <div className="mt-2">
                      <StatusBadge
                        category={
                          versionStatusToCategory[currentVersion.status] ??
                          "NOT_STARTED"
                        }
                        label={tRoot(
                          `spaceOverview.versionStatus.${currentVersion.status}`,
                        )}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t("currentVersion.targetDate")}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-sm font-semibold">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      {versionDueDate}
                    </div>
                  </div>
                  <Link
                    href={buildLink(
                      "/versions",
                      currentVersion?.id
                        ? { versionId: currentVersion.id }
                        : undefined,
                    )}
                    data-testid="space-overview-version-board-link"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                  >
                    {t("links.versionBoard")}
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    {t("summary.versionProgress")}
                  </span>
                  <span className="font-mono text-foreground">
                    {Math.round(versionProgress * 100)}% · {taskDone}/
                    {taskTotal}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${versionProgress * 100}%` }}
                  />
                </div>
              </div>
            </section>

            {/* Exception strip — 阻塞与延期 */}
            <section
              data-testid="space-overview-exception-strip"
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  {t("exceptions.title")}
                </h3>
                <Link
                  href={buildLink("/exceptions")}
                  data-testid="space-overview-exceptions-all-link"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {t("actions.viewAll")}
                </Link>
              </div>
              {totalExceptions === 0 ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  {t("exceptions.empty")}
                </div>
              ) : (
                <ul className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                  {EXCEPTION_ORDER.map((type) => {
                    const item = exceptionCounts.find(
                      (c) => c.exceptionType === type,
                    );
                    const count = item?.count ?? 0;
                    const Icon = exceptionIcon[type];
                    return (
                      <li key={type}>
                        <Link
                          href={buildLink("/exceptions", {
                            exceptionType: type,
                          })}
                          data-testid={`space-overview-exception-${type}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:bg-muted"
                        >
                          <span className="flex items-center gap-2 text-[12px] text-foreground">
                            <Icon
                              className={`h-3.5 w-3.5 ${exceptionToneClass[type]}`}
                            />
                            {tRoot(`m4Views.exceptionType.${type}`)}
                          </span>
                          <span className="font-mono text-sm font-semibold">
                            {count}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Task & bug split */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Link
                href={buildLink("/work-items", { workItemType: "TASK" })}
                data-testid="space-overview-task-progress"
                className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ClipboardList className="h-3.5 w-3.5 text-primary" />
                    {t("summary.taskProgress")}
                  </h3>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-2xl font-semibold leading-none">
                    {taskDone}/{taskTotal}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("summary.taskProgressWithPct", { pct: taskPct })}
                  </span>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${taskPct}%` }}
                  />
                </div>
              </Link>

              <Link
                href={buildLink("/bugs")}
                data-testid="space-overview-bug-status"
                className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-destructive/40"
              >
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Bug className="h-3.5 w-3.5 text-destructive" />
                    {t("summary.bugStatus")}
                  </h3>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <span className="text-2xl font-semibold leading-none">
                    {bugTotal - bugOpen}/{bugTotal}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("summary.bugClosedWithPct", { pct: bugClosePct })}
                  </span>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive"
                    style={{
                      width: `${bugClosePct}%`,
                    }}
                  />
                </div>
              </Link>
            </div>

            {/* Per-type status distribution: tasks + bugs side by side */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <StatusDistributionPanel
                testIdPrefix="space-overview-task-status"
                title={t("summary.taskProgress")}
                description={t("statusCounts.description")}
                emptyLabel={t("statusCounts.empty")}
                counts={taskStatusCounts}
                total={taskStatusTotal}
                buildHref={(category) =>
                  buildLink("/work-items", {
                    statusCategory: category,
                    workItemType: "TASK",
                  })
                }
                categoryLabel={(category) =>
                  tRoot(`m4Views.statusCategory.${category}`)
                }
              />
              <StatusDistributionPanel
                testIdPrefix="space-overview-bug-status-distribution"
                title={t("summary.bugStatus")}
                description={t("statusCounts.description")}
                emptyLabel={t("statusCounts.empty")}
                counts={bugStatusCounts}
                total={bugStatusTotal}
                buildHref={(category) =>
                  buildLink("/bugs", { statusCategory: category })
                }
                categoryLabel={(category) =>
                  tRoot(`m4Views.statusCategory.${category}`)
                }
              />
            </div>

            {/* Requirements / versions inline KPIs */}
            <section
              data-testid="space-overview-kpi-grid"
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
            >
              <Link
                href={buildLink("/requirements")}
                data-testid="space-overview-requirements-link"
                className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-info/40"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-info/10 text-info">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="flex flex-1 flex-col">
                  <span className="text-lg font-semibold leading-none">
                    {stats?.requirementCount ?? 0}
                  </span>
                  <span className="mt-1 text-[11px] text-muted-foreground">
                    {t("stats.requirements")}
                  </span>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
              </Link>
              <Link
                href={buildLink("/versions")}
                data-testid="space-overview-versions-link"
                className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <GitBranch className="h-4 w-4" />
                </div>
                <div className="flex flex-1 flex-col">
                  <span className="text-lg font-semibold leading-none">
                    {stats?.versionCount ?? 0}
                  </span>
                  <span className="mt-1 text-[11px] text-muted-foreground">
                    {t("stats.versions")}
                  </span>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
              </Link>
            </section>

            {/* Recent timeline */}
            <section
              data-testid="space-overview-timeline"
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">{t("timeline.title")}</h3>
              </div>
              {recentEvents.length === 0 ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  {t("timeline.empty")}
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {recentEvents.map((event) => {
                    const href = buildTimelineHref(event);
                    const inner = (
                      <div className="flex gap-2.5 px-1 py-1">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[10px]">
                            {initialOf(event.actor.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 text-[12px]">
                          <div className="leading-snug">
                            <span className="font-medium">
                              {event.actor.name}
                            </span>
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
                            {formatTimeAgo(
                              event.createdAt,
                              locale,
                              t("time.justNow"),
                            )}
                          </div>
                        </div>
                      </div>
                    );
                    if (href) {
                      return (
                        <li
                          key={event.id}
                          data-testid={`space-overview-timeline-${event.id}`}
                        >
                          <Link
                            href={href as never}
                            className="block rounded-md transition-colors hover:bg-muted/50"
                          >
                            {inner}
                          </Link>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={event.id}
                        data-testid={`space-overview-timeline-${event.id}`}
                      >
                        {inner}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDistributionPanel({
  testIdPrefix,
  title,
  description,
  emptyLabel,
  counts,
  total,
  buildHref,
  categoryLabel,
}: {
  testIdPrefix: string;
  title: string;
  description: string;
  emptyLabel: string;
  counts: ViewStatusCount[];
  total: number;
  buildHref: (category: StatusCategory) => string;
  categoryLabel: (category: StatusCategory) => string;
}) {
  return (
    <section
      data-testid={testIdPrefix}
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{description}</span>
      </div>
      {total === 0 ? (
        <div className="mt-3 text-xs text-muted-foreground">{emptyLabel}</div>
      ) : (
        <>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
            {STATUS_ORDER.map((category) => {
              const item = counts.find((c) => c.statusCategory === category);
              const count = item?.count ?? 0;
              if (count === 0) return null;
              const pct = (count / total) * 100;
              return (
                <span
                  key={category}
                  title={`${categoryLabel(category)} · ${count}`}
                  className={`h-full ${statusBarClass[category]}`}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {STATUS_ORDER.map((category) => {
              const item = counts.find((c) => c.statusCategory === category);
              const count = item?.count ?? 0;
              return (
                <li key={category}>
                  <Link
                    href={buildHref(category)}
                    data-testid={`${testIdPrefix}-${category}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${statusBarClass[category]}`}
                    />
                    <span>{categoryLabel(category)}</span>
                    <span className="font-mono text-foreground">{count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function VersionFilter({
  t,
  versions,
  selectedId,
  onChange,
}: {
  t: ReturnType<typeof useTranslations>;
  versions: { id: string; name: string }[];
  selectedId: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const selected = versions.find((v) => v.id === selectedId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          aria-label={t("filters.label")}
          data-testid="space-overview-version-filter"
        >
          <GitBranch className="h-3 w-3" />
          <span className="max-w-[140px] truncate">
            {selected?.name ?? t("filters.allVersions")}
          </span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        <DropdownMenuLabel>{t("filters.version")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="space-overview-version-filter-all"
          onSelect={() => onChange(undefined)}
        >
          {t("filters.allVersions")}
        </DropdownMenuItem>
        {versions.map((v) => (
          <DropdownMenuItem
            key={v.id}
            data-testid={`space-overview-version-filter-${v.id}`}
            onSelect={() => onChange(v.id)}
          >
            {v.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initialOf(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toUpperCase();
}

function formatTimeAgo(value: string, locale: string, justNowLabel: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (Math.abs(diffMin) < 1) {
    return justNowLabel;
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
