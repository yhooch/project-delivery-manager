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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { useVersions } from "../../lib/v2/lookups";
import { getSpaceOverviewView } from "../../lib/view-service";
import { Link, usePathname, useRouter } from "../../i18n/routing";
import { useSession } from "../providers/session-provider";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { Tip } from "../ui/tooltip";
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
  const versionIdParam = normalizeSearchParam(searchParams.get("versionId"));

  const [view, setView] = useState<GetSpaceOverviewViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const { versions, loading: versionsLoading } = useVersions(
    spaceId,
    organizationId,
  );
  const activeVersionId = useMemo(() => {
    if (!versionIdParam) {
      return undefined;
    }

    return versions.some((version) => version.id === versionIdParam)
      ? versionIdParam
      : undefined;
  }, [versionIdParam, versions]);

  useEffect(() => {
    if (!versionIdParam || versionsLoading) {
      return;
    }

    if (versions.some((version) => version.id === versionIdParam)) {
      return;
    }

    const next = new URLSearchParams(searchParams.toString());
    next.delete("versionId");
    const query = next.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    router.replace(target as never, { scroll: false });
  }, [
    pathname,
    router,
    searchParams,
    versionIdParam,
    versions,
    versionsLoading,
  ]);

  const fetchView = useCallback(async () => {
    if (!spaceId) {
      return;
    }
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setView(null);
    setIsLoading(true);
    setErrorKey(null);
    try {
      const next = await getSpaceOverviewView({
        spaceId,
        organizationId,
        versionId: activeVersionId,
      });
      if (requestSeq.current !== requestId) return;
      setView(next);
    } catch (error) {
      if (requestSeq.current !== requestId) return;
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (requestSeq.current === requestId) setIsLoading(false);
    }
  }, [activeVersionId, organizationId, spaceId]);

  useEffect(() => {
    if (!spaceId) {
      requestSeq.current += 1;
      setView(null);
      setIsLoading(false);
      return;
    }
    void fetchView();
    return () => {
      requestSeq.current += 1;
    };
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

  const selectedVersion = versions.find((v) => v.id === activeVersionId);

  const headerEyebrow = view?.space.code
    ? `${currentSpace?.name ?? view.space.name} · ${view.space.code}`
    : (currentSpace?.name ?? tNav("group.deliver"));

  const taskStatusTotal = taskStatusCounts.reduce((s, c) => s + c.count, 0);
  const bugStatusTotal = bugStatusCounts.reduce((s, c) => s + c.count, 0);

  const buildLink = (base: string, extra?: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (activeVersionId) sp.set("versionId", activeVersionId);
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
    <div
      data-testid="space-overview-page"
      className="flex h-full flex-col bg-background"
    >
      <PageHeader
        eyebrow={headerEyebrow}
        title={tNav("overview")}
        description={t("page.description")}
        actions={
          <>
            <VersionFilter
              t={t}
              versions={versions}
              selectedId={activeVersionId}
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
                className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
              />
              {t("actions.refresh")}
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-8 lg:px-8">
        {isLoading && !view ? (
          <LoadingState label={t("states.loading.title")} />
        ) : errorKey ? (
          <ErrorState
            title={t("errorTitle")}
            message={tRoot(errorKey)}
            onRetry={() => void fetchView()}
          />
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-10">
            {/* Meta Row */}
            {(staleThresholdDays !== undefined || selectedVersion) && (
              <div
                data-testid="space-overview-meta"
                className="flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground"
              >
                {staleThresholdDays !== undefined && (
                  <span
                    data-testid="space-overview-stale"
                    className="flex items-center gap-1.5"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {t("header.staleThreshold", { days: staleThresholdDays })}
                  </span>
                )}
                {selectedVersion && (
                  <span
                    data-testid="space-overview-filtered-by"
                    className="flex items-center gap-1.5"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    {t("header.filteredBy", { version: selectedVersion.name })}
                  </span>
                )}
              </div>
            )}

            {/* KPI Data Row (Borderless) */}
            <div
              data-testid="space-overview-kpi-grid"
              className="grid grid-cols-2 gap-5 lg:grid-cols-4 lg:gap-8"
            >
              <KPIMetric
                href={buildLink("/work-items", { workItemType: "TASK" })}
                testId="space-overview-task-progress"
                icon={<ClipboardList className="h-4 w-4" />}
                iconClassName="bg-primary/10 text-primary"
                title={t("summary.taskProgress")}
                value={
                  <>
                    {taskDone}
                    <span className="text-xl font-light text-muted-foreground">
                      /{taskTotal}
                    </span>
                  </>
                }
                description={t("summary.taskProgressWithPct", { pct: taskPct })}
              />
              <KPIMetric
                href={buildLink("/bugs")}
                testId="space-overview-bug-status"
                icon={<Bug className="h-4 w-4" />}
                iconClassName="bg-destructive/10 text-destructive"
                title={t("summary.bugStatus")}
                value={
                  <>
                    {bugTotal - bugOpen}
                    <span className="text-xl font-light text-muted-foreground">
                      /{bugTotal}
                    </span>
                  </>
                }
                description={t("summary.bugClosedWithPct", {
                  pct: bugClosePct,
                })}
              />
              <KPIMetric
                href={buildLink("/requirements")}
                testId="space-overview-requirements-link"
                icon={<FileText className="h-4 w-4" />}
                iconClassName="bg-info/10 text-info"
                title={t("stats.requirements")}
                value={stats?.requirementCount ?? 0}
              />
              <KPIMetric
                href={buildLink("/versions")}
                testId="space-overview-versions-link"
                icon={<GitBranch className="h-4 w-4" />}
                iconClassName="bg-primary/10 text-primary"
                title={t("stats.versions")}
                value={stats?.versionCount ?? 0}
              />
            </div>

            <div className="h-px w-full bg-border/40" />

            {/* Main Split Layout */}
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_320px] lg:gap-12">
              {/* Left Column: Progress & Status */}
              <div className="flex flex-col gap-10">
                {/* Current Version */}
                <section
                  data-testid="space-overview-current-version"
                  className="flex flex-col gap-4"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("currentVersion.title")}
                    </h3>
                  </div>
                  <div className="flex flex-col justify-between gap-5 border-l-2 border-primary/50 pl-4 md:flex-row md:items-end">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <h2 className="truncate text-2xl font-light tracking-tight text-foreground">
                          {versionName}
                        </h2>
                        {currentVersion?.status && (
                          <StatusBadge
                            category={
                              versionStatusToCategory[currentVersion.status] ??
                              "NOT_STARTED"
                            }
                            label={tRoot(
                              `spaceOverview.versionStatus.${currentVersion.status}`,
                            )}
                          />
                        )}
                      </div>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                        {versionGoal}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-medium">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CalendarClock className="h-4 w-4" />
                          {t("currentVersion.targetDate")}:{" "}
                          <span className="text-foreground">
                            {versionDueDate}
                          </span>
                        </div>
                        <Link
                          href={buildLink(
                            "/versions",
                            currentVersion?.id
                              ? { versionId: currentVersion.id }
                              : undefined,
                          )}
                          data-testid="space-overview-version-board-link"
                          className="flex items-center gap-1 text-primary hover:underline underline-offset-2 transition-colors"
                        >
                          {t("links.versionBoard")}
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>

                    <div className="flex w-full shrink-0 flex-col gap-2 md:w-56">
                      <div className="flex items-center justify-between text-xs font-medium">
                        <span className="text-muted-foreground">
                          {t("summary.versionProgress")}
                        </span>
                        <span className="text-foreground">
                          {Math.round(versionProgress * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${versionProgress * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* Status Distributions */}
                <section className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("statusCounts.description")}
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                    <StatusDistributionList
                      testIdPrefix="space-overview-task-status"
                      title={t("summary.taskProgress")}
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
                    <StatusDistributionList
                      testIdPrefix="space-overview-bug-status-distribution"
                      title={t("summary.bugStatus")}
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
                </section>
              </div>

              {/* Right Column: Exceptions & Timeline */}
              <div className="flex flex-col gap-10 border-t border-border/40 pt-8 lg:border-l lg:border-t-0 lg:pt-0 lg:pl-8">
                {/* Exceptions */}
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      {t("exceptions.title")}
                    </h3>
                    <Link
                      href={buildLink("/exceptions")}
                      className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("actions.viewAll")}
                    </Link>
                  </div>
                  <div>
                    {totalExceptions === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {t("exceptions.empty")}
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-2.5">
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
                                className="group flex items-center justify-between gap-3 transition-colors"
                              >
                                <span className="flex items-center gap-2.5 text-[13px] font-medium text-foreground/80 group-hover:text-foreground">
                                  <Icon
                                    className={`h-4 w-4 ${exceptionToneClass[type]}`}
                                  />
                                  {tRoot(`m4Views.exceptionType.${type}`)}
                                </span>
                                <span className="font-mono text-base font-semibold text-foreground">
                                  {count}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </section>

                {/* Timeline */}
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("timeline.title")}
                    </h3>
                  </div>
                  <div>
                    {recentEvents.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {t("timeline.empty")}
                      </div>
                    ) : (
                      <ul className="relative flex flex-col gap-4 before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-border/50">
                        {recentEvents.map((event) => {
                          const href = buildTimelineHref(event);
                          const inner = (
                            <div className="flex gap-3">
                              <Tip content={event.actor.name}>
                                <Avatar className="h-6 w-6 border-4 border-background z-10 shrink-0 bg-muted">
                                  <AvatarFallback className="text-[9px] bg-transparent text-muted-foreground">
                                    {initialOf(event.actor.name)}
                                  </AvatarFallback>
                                </Avatar>
                              </Tip>
                              <div className="flex-1 text-[13px] min-w-0 pt-0.5">
                                <div className="leading-snug">
                                  <span className="font-medium text-foreground/90">
                                    {event.actor.name}
                                  </span>
                                  <span className="text-muted-foreground px-1.5">
                                    {event.title}
                                  </span>
                                  {event.target.title && (
                                    <span className="font-medium text-foreground inline-block truncate max-w-full align-bottom">
                                      {event.target.title}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 text-[11px] font-medium text-muted-foreground/60">
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
                              <li key={event.id}>
                                <Link
                                  href={href as never}
                                  className="block -mx-3 -my-2 rounded-lg p-2 transition-colors hover:bg-muted/40"
                                >
                                  {inner}
                                </Link>
                              </li>
                            );
                          }
                          return <li key={event.id}>{inner}</li>;
                        })}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KPIMetric({
  title,
  value,
  description,
  href,
  testId,
  icon,
  iconClassName,
}: {
  title: string;
  value: React.ReactNode;
  description?: string;
  href: string;
  testId: string;
  icon: React.ReactNode;
  iconClassName: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group -m-1 flex flex-col gap-1.5 rounded-xl p-1 transition-colors hover:bg-muted/30"
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${iconClassName}`}
        >
          {icon}
        </span>
        <span>{title}</span>
      </div>
      <div className="mt-0.5 text-3xl font-light tracking-tight text-foreground">
        {value}
      </div>
      {description && (
        <div className="mt-0.5 text-[11px] font-medium text-muted-foreground/70">
          {description}
        </div>
      )}
    </Link>
  );
}

function StatusDistributionList({
  testIdPrefix,
  title,
  emptyLabel,
  counts,
  total,
  buildHref,
  categoryLabel,
}: {
  testIdPrefix: string;
  title: string;
  emptyLabel: string;
  counts: ViewStatusCount[];
  total: number;
  buildHref: (category: StatusCategory) => string;
  categoryLabel: (category: StatusCategory) => string;
}) {
  return (
    <div className="flex flex-col">
      <h4 className="mb-2 text-[13px] font-medium text-foreground">{title}</h4>
      {total === 0 ? (
        <div className="text-xs text-muted-foreground">{emptyLabel}</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
            {STATUS_ORDER.map((category) => {
              const item = counts.find((c) => c.statusCategory === category);
              const count = item?.count ?? 0;
              if (count === 0) return null;
              const pct = (count / total) * 100;
              return (
                <span
                  key={category}
                  title={`${categoryLabel(category)} · ${count}`}
                  className={`h-full ${statusBarClass[category]} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>
          <ul className="flex flex-col gap-1.5">
            {STATUS_ORDER.map((category) => {
              const item = counts.find((c) => c.statusCategory === category);
              const count = item?.count ?? 0;
              const pct = Math.round((count / total) * 100);
              return (
                <li key={category}>
                  <Link
                    href={buildHref(category)}
                    data-testid={`${testIdPrefix}-${category}`}
                    className="group flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`h-2 w-2 rounded-full ${statusBarClass[category]}`}
                      />
                      <span className="text-[13px] font-medium text-foreground/80 group-hover:text-foreground">
                        {categoryLabel(category)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {pct}%
                      </span>
                      <span className="font-mono text-sm font-semibold w-6 text-right text-foreground/90">
                        {count}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
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
          className="text-xs bg-transparent border-border/80"
          aria-label={t("filters.label")}
          data-testid="space-overview-version-filter"
        >
          <GitBranch className="h-3 w-3 opacity-70" />
          <span className="max-w-[140px] truncate font-medium">
            {selected?.name ?? t("filters.allVersions")}
          </span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[200px] rounded-xl shadow-md border-border/80"
      >
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {t("filters.version")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border/60" />
        <DropdownMenuItem
          data-testid="space-overview-version-filter-all"
          onSelect={() => onChange(undefined)}
          className="text-[13px]"
        >
          {t("filters.allVersions")}
        </DropdownMenuItem>
        {versions.map((v) => (
          <DropdownMenuItem
            key={v.id}
            data-testid={`space-overview-version-filter-${v.id}`}
            onSelect={() => onChange(v.id)}
            className="text-[13px]"
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

function normalizeSearchParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
