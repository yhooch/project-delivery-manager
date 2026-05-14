"use client";

import type {
  GetSpaceOverviewViewResponse,
  ViewExceptionType,
} from "@project-delivery/shared";
import {
  AlertTriangle,
  ArrowUpRight,
  Bug,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  PauseCircle,
  Target,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { getSpaceOverviewView } from "../../lib/view-service";
import { useSession } from "../providers/session-provider";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { PageHeader } from "../v2/page-header";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";

type Tone = "primary" | "info" | "warning" | "destructive" | "success";

const toneClass: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  success: "bg-success/10 text-success",
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

export function SpaceOverview() {
  const t = useTranslations("spaceOverview");
  const tNav = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { session, currentSpace } = useSession();
  const [view, setView] = useState<GetSpaceOverviewViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const organizationId = session?.defaultOrganizationId;
  const spaceId = session?.defaultSpaceId;

  const fetchView = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const next = await getSpaceOverviewView({
        spaceId,
        organizationId,
      });
      setView(next);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, spaceId]);

  useEffect(() => {
    if (!spaceId) {
      setView(null);
      return;
    }

    let active = true;

    async function load() {
      setIsLoading(true);
      setErrorKey(null);

      try {
        const next = await getSpaceOverviewView({
          spaceId: spaceId!,
          organizationId,
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

  if (!session) {
    return (
      <div className="flex h-full flex-col">
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
      <div className="flex h-full flex-col">
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

  const taskTotal = stats?.taskCount ?? 0;
  const taskDone = stats?.completedTaskCount ?? 0;
  const taskPct = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0;

  const bugTotal = stats?.bugCount ?? 0;
  const bugOpen = stats?.openBugCount ?? 0;
  const bugClosePct =
    bugTotal > 0 ? Math.round(((bugTotal - bugOpen) / bugTotal) * 100) : 0;

  const totalExceptions =
    exceptionCounts.reduce((sum, item) => sum + item.count, 0) ||
    (stats?.blockedCount ?? 0) + (stats?.overdueCount ?? 0);

  const versionProgress = computeVersionProgress(taskDone, taskTotal);
  const versionName = currentVersion?.name ?? t("currentVersion.empty");
  const versionGoal = currentVersion?.target ?? t("currentVersion.emptyDescription");
  const versionDueDate = currentVersion?.targetDate
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(currentVersion.targetDate),
      )
    : t("currentVersion.noDate");

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow={currentSpace?.name ?? tNav("group.deliver")}
        title={tNav("overview")}
        description={t("page.description")}
        actions={
          <Button variant="ghost" size="sm" className="text-xs">
            {t("links.versionBoard")}
            <ArrowUpRight className="h-3 w-3" />
          </Button>
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
            {/* Active version card */}
            <section className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-primary">
                    <GitBranch className="h-3 w-3" />
                    {t("currentVersion.title")}
                  </div>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">
                    {versionName}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {versionGoal}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {t("currentVersion.targetDate")}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {versionDueDate}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">
                    {t("summary.versionProgress")}
                  </span>
                  <span className="font-mono text-foreground">
                    {Math.round(versionProgress * 100)}%
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

            {/* KPI grid */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard
                icon={FileText}
                tone="info"
                label={t("stats.requirements")}
                value={stats?.requirementCount ?? 0}
              />
              <KpiCard
                icon={CheckCircle2}
                tone="primary"
                label={t("summary.taskProgressWithPct", { pct: taskPct })}
                value={`${taskDone}/${taskTotal}`}
              />
              <KpiCard
                icon={Bug}
                tone="destructive"
                label={t("summary.bugClosedWithPct", { pct: bugClosePct })}
                value={`${bugOpen}/${bugTotal}`}
              />
              <KpiCard
                icon={AlertTriangle}
                tone="warning"
                label={t("stats.exceptionsTotal")}
                value={totalExceptions}
              />
            </section>

            {/* Two-col bottom */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <section className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
                <h3 className="text-sm font-semibold">{t("exceptions.title")}</h3>
                {exceptionCounts.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">
                    {t("exceptions.empty")}
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2 text-[13px]">
                    {exceptionCounts.map((item) => {
                      const Icon = exceptionIcon[item.exceptionType];
                      return (
                        <li
                          key={item.exceptionType}
                          className="flex items-center gap-2"
                        >
                          <Icon
                            className={`h-3.5 w-3.5 ${exceptionToneClass[item.exceptionType]}`}
                          />
                          <span className="flex-1 text-foreground">
                            {tRoot(`m4Views.exceptionType.${item.exceptionType}`)}
                          </span>
                          <span className="font-mono text-foreground">
                            {item.count}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">{t("timeline.title")}</h3>
                {recentEvents.length === 0 ? (
                  <div className="mt-3 text-xs text-muted-foreground">
                    {t("timeline.empty")}
                  </div>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {recentEvents.map((event) => (
                      <li key={event.id} className="flex gap-2.5">
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
                            {formatTimeAgo(event.createdAt, locale)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClass[tone]}`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex flex-col">
        <span className="text-lg font-semibold leading-none">{value}</span>
        <span className="mt-1 text-[11px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function computeVersionProgress(done: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, done / total));
}

function initialOf(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "?";
  }

  return trimmed.slice(0, 1).toUpperCase();
}

function formatTimeAgo(value: string, locale: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);

  if (Math.abs(diffMin) < 1) {
    return locale.startsWith("zh") ? "刚刚" : "just now";
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
