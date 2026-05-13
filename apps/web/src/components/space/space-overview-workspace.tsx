"use client";

import type {
  GetSpaceOverviewViewResponse,
  SpaceMemberWithUser,
  TimelineEvent,
  Version,
} from "@project-delivery/shared";
import {
  BarChart3,
  CalendarClock,
  CircleAlert,
  GitBranch,
  Loader2,
  RefreshCw,
  TimerReset,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { createSpaceOverviewViewCacheKey } from "../../lib/view-cache";
import { toSpaceOverviewViewQuery } from "../../lib/view-forms";
import { getSpaceOverviewView } from "../../lib/view-service";
import {
  listVersionAssignableMembers,
  listVersions,
} from "../../lib/version-service";
import { useSession } from "../providers/session-provider";
import { ExceptionTypeTag, ViewEmptyState } from "../view/m4-view-foundation";

type SpaceOverviewWorkspaceProps = {
  initialVersionId?: string;
  spaceId: string;
};

export function SpaceOverviewWorkspace({
  initialVersionId,
  spaceId,
}: SpaceOverviewWorkspaceProps) {
  const t = useTranslations("spaceOverview");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { session, status } = useSession();
  const [overview, setOverview] =
    useState<GetSpaceOverviewViewResponse | null>(null);
  const [loadedCacheKey, setLoadedCacheKey] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [versionFilter, setVersionFilter] = useState(initialVersionId ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const currentSpace = useMemo(
    () => session?.spaces.find((space) => space.id === spaceId),
    [session, spaceId],
  );
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;
  const cacheKey = useMemo(
    () =>
      createSpaceOverviewViewCacheKey({
        organizationId,
        spaceId,
        versionId: versionFilter,
      }),
    [organizationId, spaceId, versionFilter],
  );

  useEffect(() => {
    setOverview(null);
    setLoadedCacheKey("");
    setVersions([]);
    setMembers([]);
    setVersionFilter(initialVersionId ?? "");
    setErrorKey(null);
    setIsLoading(false);
  }, [initialVersionId, organizationId, spaceId]);

  useEffect(() => {
    if (status !== "authenticated" || !currentSpace) {
      setOverview(null);
      setLoadedCacheKey("");
      setVersions([]);
      setMembers([]);
      setIsLoading(false);
      return;
    }

    let isActive = true;

    async function load() {
      setIsLoading(true);
      setErrorKey(null);

      try {
        const query = toSpaceOverviewViewQuery({
          organizationId,
          versionId: versionFilter,
        });
        const [nextOverview, versionPage, memberPage] = await Promise.all([
          getSpaceOverviewView({
            ...query,
            spaceId,
          }),
          listVersions({
            organizationId,
            page: 1,
            pageSize: 100,
            spaceId,
          }),
          listVersionAssignableMembers({
            organizationId,
            spaceId,
          }),
        ]);

        if (!isActive) {
          return;
        }

        setOverview(nextOverview);
        setLoadedCacheKey(cacheKey);
        setVersions(versionPage.items);
        setMembers(memberPage.items);
      } catch (error) {
        if (isActive) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isActive = false;
    };
  }, [cacheKey, currentSpace, organizationId, spaceId, status, versionFilter]);

  async function refreshOverview() {
    if (status !== "authenticated" || !currentSpace) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const query = toSpaceOverviewViewQuery({
        organizationId,
        versionId: versionFilter,
      });
      const nextOverview = await getSpaceOverviewView({
        ...query,
        spaceId,
      });
      setOverview(nextOverview);
      setLoadedCacheKey(cacheKey);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }

  if (status === "loading") {
    return (
      <StatePanel
        icon="loading"
        title={t("states.loading.title")}
        description={t("states.loading.description")}
      />
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.unauthenticated.title")}
        description={t("states.unauthenticated.description")}
      />
    );
  }

  if (!currentSpace) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.noSpace.title")}
        description={t("states.noSpace.description")}
      />
    );
  }

  const activeOverview = loadedCacheKey === cacheKey ? overview : null;
  const stats = activeOverview?.stats;
  const taskProgress = formatProgress(
    stats?.completedTaskCount ?? 0,
    stats?.taskCount ?? 0,
  );
  const openBugProgress = formatProgress(
    stats?.openBugCount ?? 0,
    stats?.bugCount ?? 0,
  );
  const selectedVersion =
    versions.find((version) => version.id === versionFilter) ??
    activeOverview?.currentVersion;
  const memberNameById = createMemberNameMap(members);

  return (
    <div className="workbench-page">
      <section className="page-heading" aria-labelledby="space-overview-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="space-overview-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{currentSpace.name}</span>
          <button
            className="button button--secondary"
            disabled={isLoading}
            onClick={() => void refreshOverview()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            {t("actions.refresh")}
          </button>
        </div>
      </section>

      {errorKey ? <div className="form-alert">{tRoot(errorKey)}</div> : null}

      <section className="toolbar-panel" aria-label={t("filters.label")}>
        <label className="field">
          <span>{t("filters.version")}</span>
          <select
            onChange={(event) => setVersionFilter(event.target.value)}
            value={versionFilter}
          >
            <option value="">{t("filters.allVersions")}</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel space-overview-board" data-cache-key={cacheKey}>
        <div className="panel__header">
          <div>
            <h3>{t("summary.title")}</h3>
            <p>{t("summary.description", { space: currentSpace.name })}</p>
          </div>
          {isLoading ? <Loader2 aria-hidden="true" size={18} /> : null}
        </div>

        <div className="compact-metric-grid">
          <Metric label={t("summary.currentVersion")} value={selectedVersion?.name ?? t("currentVersion.empty")} />
          <Metric
            label={t("summary.requirements")}
            value={String(stats?.requirementCount ?? 0)}
          />
          <Metric label={t("summary.taskProgress")} value={taskProgress} />
          <Metric label={t("summary.bugStatus")} value={openBugProgress} />
          <Metric
            label={t("summary.blockedAndOverdue")}
            value={t("summary.blockedAndOverdueValue", {
              blocked: stats?.blockedCount ?? 0,
              overdue: stats?.overdueCount ?? 0,
            })}
          />
        </div>
      </section>

      <div className="space-overview-grid">
        <section className="panel" aria-labelledby="space-current-version-title">
          <div className="panel__header">
            <div>
              <h3 id="space-current-version-title">
                {t("currentVersion.title")}
              </h3>
              <p>{t("currentVersion.description")}</p>
            </div>
            <GitBranch aria-hidden="true" size={18} strokeWidth={2} />
          </div>
          {selectedVersion ? (
            <div className="summary-list summary-list--single">
              <InfoRow label={t("currentVersion.status")} value={t(`versionStatus.${selectedVersion.status}`)} />
              <InfoRow
                label={t("currentVersion.owner")}
                value={
                  selectedVersion.ownerId
                    ? memberNameById.get(selectedVersion.ownerId) ??
                      selectedVersion.ownerId
                    : t("currentVersion.unassigned")
                }
              />
              <InfoRow
                label={t("currentVersion.targetDate")}
                value={formatDate(selectedVersion.targetDate, locale) ?? t("currentVersion.noDate")}
              />
              <InfoRow
                label={t("currentVersion.releaseDate")}
                value={formatDate(selectedVersion.releaseDate, locale) ?? t("currentVersion.noDate")}
              />
            </div>
          ) : (
            <ViewEmptyState
              compact
              descriptionKey="spaceOverview.currentVersion.emptyDescription"
              titleKey="spaceOverview.currentVersion.empty"
            />
          )}
          <div className="form-actions">
            <Link className="button button--secondary" href={`/spaces/${spaceId}/versions`}>
              {t("links.versions")}
            </Link>
          </div>
        </section>

        <section className="panel" aria-labelledby="space-status-counts-title">
          <div className="panel__header">
            <div>
              <h3 id="space-status-counts-title">{t("statusCounts.title")}</h3>
              <p>{t("statusCounts.description")}</p>
            </div>
            <BarChart3 aria-hidden="true" size={18} strokeWidth={2} />
          </div>
          <CountList
            emptyDescriptionKey="spaceOverview.statusCounts.emptyDescription"
            emptyTitleKey="spaceOverview.statusCounts.empty"
            items={(activeOverview?.statusCounts ?? []).map((item) => ({
              count: item.count,
              label: tRoot(`m4Views.statusCategory.${item.statusCategory}`),
            }))}
          />
        </section>

        <section className="panel" aria-labelledby="space-exceptions-title">
          <div className="panel__header">
            <div>
              <h3 id="space-exceptions-title">{t("exceptions.title")}</h3>
              <p>{t("exceptions.description")}</p>
            </div>
            <TimerReset aria-hidden="true" size={18} strokeWidth={2} />
          </div>
          <div className="compact-list">
            {(activeOverview?.exceptionCounts ?? []).map((item) => (
              <div className="compact-list__row" key={item.exceptionType}>
                <ExceptionTypeTag type={item.exceptionType} />
                <strong>{item.count}</strong>
              </div>
            ))}
            {!isLoading && (activeOverview?.exceptionCounts?.length ?? 0) === 0 ? (
              <ViewEmptyState
                compact
                descriptionKey="spaceOverview.exceptions.emptyDescription"
                titleKey="spaceOverview.exceptions.empty"
              />
            ) : null}
          </div>
        </section>

        <section className="panel" aria-labelledby="space-timeline-title">
          <div className="panel__header">
            <div>
              <h3 id="space-timeline-title">{t("timeline.title")}</h3>
              <p>{t("timeline.description")}</p>
            </div>
            <CalendarClock aria-hidden="true" size={18} strokeWidth={2} />
          </div>
          <TimelineList
            events={activeOverview?.recentActivities?.items ?? []}
            isLoading={isLoading}
            locale={locale}
            t={t}
          />
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="compact-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-list__row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CountList({
  emptyDescriptionKey,
  emptyTitleKey,
  items,
}: {
  emptyDescriptionKey: string;
  emptyTitleKey: string;
  items: Array<{ count: number; label: string }>;
}) {
  if (items.length === 0) {
    return (
      <ViewEmptyState
        compact
        descriptionKey={emptyDescriptionKey}
        titleKey={emptyTitleKey}
      />
    );
  }

  return (
    <div className="summary-list summary-list--single">
      {items.map((item) => (
        <InfoRow key={item.label} label={item.label} value={String(item.count)} />
      ))}
    </div>
  );
}

function TimelineList({
  events,
  isLoading,
  locale,
  t,
}: {
  events: TimelineEvent[];
  isLoading: boolean;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (isLoading) {
    return <InlineState label={t("timeline.loading")} />;
  }

  if (events.length === 0) {
    return (
      <ViewEmptyState
        compact
        descriptionKey="spaceOverview.timeline.emptyDescription"
        titleKey="spaceOverview.timeline.empty"
      />
    );
  }

  return (
    <ol className="activity-list work-item-timeline">
      {events.map((event) => (
        <li className="activity-list__item" key={event.id}>
          <span className="activity-list__dot" aria-hidden="true" />
          <div>
            <span>{event.title}</span>
            <small>
              {t("timeline.meta", {
                actor: event.actor.name,
                date: formatDateTime(event.createdAt, locale) ?? "",
                target: event.target.title ?? event.target.id,
                type: t(`timeline.type.${event.eventType}`),
              })}
            </small>
            {event.detail ? <p>{event.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function InlineState({ label }: { label: string }) {
  return (
    <div className="inline-state" aria-live="polite">
      <Loader2 aria-hidden="true" size={16} strokeWidth={2} />
      <span>{label}</span>
    </div>
  );
}

function StatePanel({
  description,
  icon,
  title,
}: {
  description: string;
  icon: "loading" | "warning";
  title: string;
}) {
  const Icon = icon === "loading" ? Loader2 : CircleAlert;

  return (
    <section className="state-panel" aria-live="polite">
      <div className="state-panel__icon">
        <Icon aria-hidden="true" size={18} strokeWidth={2} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

function createMemberNameMap(members: SpaceMemberWithUser[]) {
  return new Map(
    members.map((member) => [
      member.userId,
      `${member.user.name} (${member.user.username})`,
    ]),
  );
}

function formatProgress(current: number, total: number) {
  if (total <= 0) {
    return "0/0";
  }

  return `${current}/${total}`;
}

function formatDate(value: string | undefined, locale: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(date);
}

function formatDateTime(value: string | undefined, locale: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
