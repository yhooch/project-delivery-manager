"use client";

import type {
  GetMyWorkbenchViewResponse,
  SessionSpaceSummary,
  TimelineEvent,
  WorkbenchActionTodo,
  WorkbenchActionTodoSection,
  WorkbenchRecentActivitySection,
  WorkbenchWorkItemSection,
  ViewWorkItemSummary,
} from "@project-delivery/shared";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { createMyWorkbenchViewCacheKey } from "../../lib/view-cache";
import { getMyWorkbenchView } from "../../lib/view-service";
import { OrganizationOnboarding } from "../onboarding/organization-onboarding";
import { useSession } from "../providers/session-provider";
import { ViewEmptyState, WorkItemSummaryCard } from "../view/m4-view-foundation";

const WORKBENCH_PAGE_SIZE = 20;

const workItemSectionKeys = [
  "myTodos",
  "assignedTasks",
  "assignedBugs",
  "pendingConfirm",
  "dueSoon",
  "blocked",
] as const;

const statItems = [
  {
    icon: ClipboardList,
    key: "assignedWorkItemCount",
  },
  {
    icon: CheckCircle2,
    key: "actionTodoCount",
  },
  {
    icon: Clock3,
    key: "pendingConfirmCount",
  },
  {
    icon: ShieldAlert,
    key: "blockedCount",
  },
] as const;

type WorkItemSectionKey = (typeof workItemSectionKeys)[number];

type LoadState = {
  cacheKey: string;
  data: GetMyWorkbenchViewResponse | null;
  errorKey: string | null;
  isLoading: boolean;
};

export function DashboardWorkspace() {
  const t = useTranslations("dashboard");
  const rootT = useTranslations();
  const locale = useLocale();
  const {
    currentOrganization,
    session,
    spacesForCurrentOrganization,
    status,
  } = useSession();
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>({
    cacheKey: "",
    data: null,
    errorKey: null,
    isLoading: false,
  });
  const requestTokenRef = useRef(0);

  const organizationId = currentOrganization?.id;
  const selectedSpace = useMemo(
    () =>
      selectedSpaceId
        ? spacesForCurrentOrganization.find((space) => space.id === selectedSpaceId)
        : undefined,
    [selectedSpaceId, spacesForCurrentOrganization],
  );
  const cacheKey = useMemo(() => {
    if (!organizationId) {
      return "";
    }

    return createMyWorkbenchViewCacheKey({
      organizationId,
      page: 1,
      pageSize: WORKBENCH_PAGE_SIZE,
      spaceId: selectedSpaceId || undefined,
    });
  }, [organizationId, selectedSpaceId]);

  useEffect(() => {
    setSelectedSpaceId("");
  }, [organizationId]);

  useEffect(() => {
    if (
      selectedSpaceId &&
      !spacesForCurrentOrganization.some((space) => space.id === selectedSpaceId)
    ) {
      setSelectedSpaceId("");
    }
  }, [selectedSpaceId, spacesForCurrentOrganization]);

  const loadWorkbench = useCallback(async () => {
    if (status !== "authenticated" || !organizationId || !cacheKey) {
      return;
    }

    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    setLoadState((current) => ({
      ...current,
      cacheKey,
      errorKey: null,
      isLoading: true,
    }));

    try {
      const data = await getMyWorkbenchView({
        organizationId,
        page: 1,
        pageSize: WORKBENCH_PAGE_SIZE,
        spaceId: selectedSpaceId || undefined,
      });

      if (requestTokenRef.current !== requestToken) {
        return;
      }

      setLoadState({
        cacheKey,
        data,
        errorKey: null,
        isLoading: false,
      });
    } catch (error) {
      if (requestTokenRef.current !== requestToken) {
        return;
      }

      setLoadState({
        cacheKey,
        data: null,
        errorKey: getApiErrorMessageKey(error),
        isLoading: false,
      });
    }
  }, [cacheKey, organizationId, selectedSpaceId, status]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  if (status === "loading") {
    return (
      <StatePanel
        icon={<Loader2 aria-hidden="true" size={18} strokeWidth={2} />}
        title={t("session.loading.title")}
        description={t("session.loading.description")}
      />
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <StatePanel
        icon={<LogIn aria-hidden="true" size={18} strokeWidth={2} />}
        title={t("session.unauthenticated.title")}
        description={t("session.unauthenticated.description")}
        actions={
          <>
            <Link className="button button--primary" href="/login">
              {t("session.unauthenticated.login")}
            </Link>
            <Link className="button button--secondary" href="/register">
              {t("session.unauthenticated.register")}
            </Link>
          </>
        }
      />
    );
  }

  if (session.organizations.length === 0) {
    return <OrganizationOnboarding session={session} />;
  }

  if (!currentOrganization || !organizationId) {
    return (
      <StatePanel
        icon={<AlertCircle aria-hidden="true" size={18} strokeWidth={2} />}
        title={t("missingOrganization.title")}
        description={t("missingOrganization.description")}
      />
    );
  }

  const data = loadState.cacheKey === cacheKey ? loadState.data : null;
  const errorKey = loadState.cacheKey === cacheKey ? loadState.errorKey : null;
  const isLoading = loadState.cacheKey === cacheKey && loadState.isLoading;

  return (
    <main className="dashboard workbench-page">
      <section className="page-heading" aria-labelledby="dashboard-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="dashboard-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>
            {selectedSpace
              ? t("page.scopeWithSpace", {
                  organization: currentOrganization.name,
                  space: selectedSpace.name,
                })
              : t("page.scopeWithOrganization", {
                  organization: currentOrganization.name,
                })}
          </span>
          <span>{t("page.pageSize", { count: WORKBENCH_PAGE_SIZE })}</span>
        </div>
      </section>

      <section className="toolbar-panel workbench-toolbar" aria-label={t("filters.label")}>
        <label className="field" htmlFor="workbench-space-filter">
          <span>{t("filters.space")}</span>
          <select
            id="workbench-space-filter"
            value={selectedSpaceId}
            onChange={(event) => setSelectedSpaceId(event.target.value)}
          >
            <option value="">{t("filters.allSpaces")}</option>
            {spacesForCurrentOrganization.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
        <div className="workbench-toolbar__summary">
          <SlidersHorizontal aria-hidden="true" size={16} strokeWidth={2} />
          <span>
            {spacesForCurrentOrganization.length > 0
              ? t("filters.spaceCount", {
                  count: spacesForCurrentOrganization.length,
                })
              : t("filters.noSpaces")}
          </span>
        </div>
        <button
          className="button button--secondary"
          disabled={isLoading}
          type="button"
          onClick={() => void loadWorkbench()}
        >
          <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
          {isLoading ? t("actions.refreshing") : t("actions.refresh")}
        </button>
      </section>

      {errorKey ? (
        <div className="alert alert--error" role="alert">
          {rootT(errorKey)}
        </div>
      ) : null}

      {isLoading && !data ? (
        <InlineState label={t("states.loadingView")} />
      ) : data ? (
        <WorkbenchContent
          data={data}
          locale={locale}
          spaces={spacesForCurrentOrganization}
          userId={session.user.id}
          userName={session.user.name}
        />
      ) : (
        <ViewEmptyState
          descriptionKey="dashboard.empty.view.description"
          titleKey="dashboard.empty.view.title"
        />
      )}
    </main>
  );
}

function WorkbenchContent({
  data,
  locale,
  spaces,
  userId,
  userName,
}: {
  data: GetMyWorkbenchViewResponse;
  locale: string;
  spaces: SessionSpaceSummary[];
  userId: string;
  userName: string;
}) {
  const t = useTranslations("dashboard");
  const totalVisible =
    workItemSectionKeys.reduce(
      (total, key) => total + data.sections[key].items.items.length,
      0,
    ) +
    data.sections.actionTodos.items.items.length +
    data.sections.recentActivities.items.items.length;

  return (
    <>
      <section className="compact-metric-grid" aria-label={t("metrics.label")}>
        {statItems.map((item) => {
          const Icon = item.icon;

          return (
            <article className="compact-metric" key={item.key}>
              <span>{t(`metrics.${item.key}`)}</span>
              <strong>{data.stats[item.key]}</strong>
              <Icon aria-hidden="true" size={16} strokeWidth={2} />
            </article>
          );
        })}
      </section>

      {totalVisible === 0 ? (
        <ViewEmptyState
          descriptionKey="dashboard.empty.view.description"
          titleKey="dashboard.empty.view.title"
        />
      ) : null}

      <div className="workbench-grid workbench-grid--dense">
        <ActionTodoSection section={data.sections.actionTodos} />
        {workItemSectionKeys.map((key) => (
          <WorkItemSection
            key={key}
            sectionKey={key}
            section={data.sections[key]}
            userId={userId}
            userName={userName}
          />
        ))}
        <RecentActivitySection
          locale={locale}
          section={data.sections.recentActivities}
          spaces={spaces}
        />
      </div>
    </>
  );
}

function WorkItemSection({
  section,
  sectionKey,
  userId,
  userName,
}: {
  section: WorkbenchWorkItemSection;
  sectionKey: WorkItemSectionKey;
  userId: string;
  userName: string;
}) {
  const t = useTranslations("dashboard");
  const items = section.items.items;

  return (
    <section
      className={sectionKey === "myTodos" ? "panel panel--wide" : "panel"}
      aria-labelledby={`workbench-${sectionKey}`}
    >
      <PanelHeader
        badge={t("section.total", { count: section.total })}
        id={`workbench-${sectionKey}`}
        title={t(`sections.${sectionKey}.title`)}
        description={t(`sections.${sectionKey}.description`)}
      />
      {items.length > 0 ? (
        <div className="workbench-list">
          {items.map((item) => (
            <WorkItemEntry
              item={item}
              key={item.id}
              userId={userId}
              userName={userName}
            />
          ))}
        </div>
      ) : (
        <ViewEmptyState
          compact
          descriptionKey={`dashboard.sections.${sectionKey}.empty.description`}
          titleKey={`dashboard.sections.${sectionKey}.empty.title`}
        />
      )}
    </section>
  );
}

function ActionTodoSection({ section }: { section: WorkbenchActionTodoSection }) {
  const t = useTranslations("dashboard");
  const items = section.items.items;

  return (
    <section className="panel panel--wide" aria-labelledby="workbench-actionTodos">
      <PanelHeader
        badge={t("section.total", { count: section.total })}
        id="workbench-actionTodos"
        title={t("sections.actionTodos.title")}
        description={t("sections.actionTodos.description")}
      />
      {items.length > 0 ? (
        <div className="workbench-action-list">
          {items.map((item) => (
            <ActionTodoEntry item={item} key={item.id} />
          ))}
        </div>
      ) : (
        <ViewEmptyState
          compact
          descriptionKey="dashboard.sections.actionTodos.empty.description"
          titleKey="dashboard.sections.actionTodos.empty.title"
        />
      )}
    </section>
  );
}

function WorkItemEntry({
  item,
  userId,
  userName,
}: {
  item: ViewWorkItemSummary;
  userId: string;
  userName: string;
}) {
  const t = useTranslations("dashboard");

  return (
    <WorkItemSummaryCard
      assigneeName={resolveSessionUserName(item.assigneeId, userId, userName)}
      item={item}
      reporterName={resolveSessionUserName(item.reporterId, userId, userName)}
      trailing={
        <div className="workbench-card-actions">
          <Link className="button button--secondary" href={createWorkItemHref(item)}>
            {t("item.open")}
          </Link>
          {item.requirementId ? (
            <Link
              className="button button--secondary"
              href={`/requirements/${item.requirementId}`}
            >
              {t("item.requirement")}
            </Link>
          ) : null}
        </div>
      }
    />
  );
}

function ActionTodoEntry({ item }: { item: WorkbenchActionTodo }) {
  const t = useTranslations("dashboard");

  return (
    <article className="workbench-action-card">
      <div>
        <div className="workbench-action-card__title">
          <span>{item.availableAction.name}</span>
          <small>{item.currentStatus.stateName}</small>
        </div>
        <p>{item.workItem.title}</p>
        <dl className="workbench-action-card__meta">
          <div>
            <dt>{t("actionsTable.reason")}</dt>
            <dd>{item.reason.description}</dd>
          </div>
          <div>
            <dt>{t("actionsTable.action")}</dt>
            <dd>{item.availableAction.code}</dd>
          </div>
        </dl>
      </div>
      <Link className="button button--primary" href={createWorkItemHref(item.workItem)}>
        {t("item.open")}
      </Link>
    </article>
  );
}

function RecentActivitySection({
  locale,
  section,
  spaces,
}: {
  locale: string;
  section: WorkbenchRecentActivitySection;
  spaces: SessionSpaceSummary[];
}) {
  const t = useTranslations("dashboard");
  const items = section.items.items;

  return (
    <section className="panel panel--wide" aria-labelledby="workbench-recentActivities">
      <PanelHeader
        badge={t("section.total", { count: section.total })}
        id="workbench-recentActivities"
        title={t("sections.recentActivities.title")}
        description={t("sections.recentActivities.description")}
      />
      {items.length > 0 ? (
        <ol className="activity-list workbench-activity-list">
          {items.map((item) => (
            <RecentActivityItem
              item={item}
              key={item.id}
              locale={locale}
              space={spaces.find((space) => space.id === item.spaceId)}
            />
          ))}
        </ol>
      ) : (
        <ViewEmptyState
          compact
          descriptionKey="dashboard.sections.recentActivities.empty.description"
          titleKey="dashboard.sections.recentActivities.empty.title"
        />
      )}
    </section>
  );
}

function RecentActivityItem({
  item,
  locale,
  space,
}: {
  item: TimelineEvent;
  locale: string;
  space: SessionSpaceSummary | undefined;
}) {
  const t = useTranslations("dashboard");
  const href = createTargetHref(item);

  return (
    <li className="activity-list__item">
      <span className="activity-list__dot" aria-hidden="true" />
      <div>
        <span>{item.title}</span>
        <small>
          {t("activity.meta", {
            actor: item.actor.name,
            date: formatDateTime(item.createdAt, locale) ?? "",
            space: space?.name ?? t("activity.unknownSpace"),
            type: t(`activity.type.${item.eventType}`),
          })}
        </small>
        {item.detail ? <p>{item.detail}</p> : null}
      </div>
      {href ? (
        <Link className="button button--secondary" href={href}>
          {t("activity.open")}
        </Link>
      ) : null}
    </li>
  );
}

function PanelHeader({
  badge,
  description,
  id,
  title,
}: {
  badge: string;
  description: string;
  id: string;
  title: string;
}) {
  return (
    <div className="panel__header">
      <div>
        <h3 id={id}>{title}</h3>
        <p>{description}</p>
      </div>
      <span className="panel__badge">{badge}</span>
    </div>
  );
}

function StatePanel({
  actions,
  description,
  icon,
  title,
}: {
  actions?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="state-panel" aria-live="polite">
      <div className="state-panel__icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {actions ? <div className="state-panel__actions">{actions}</div> : null}
    </section>
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

function createWorkItemHref(item: ViewWorkItemSummary) {
  const path =
    item.type === "BUG"
      ? `/spaces/${item.spaceId}/bugs`
      : `/spaces/${item.spaceId}/work-items`;
  const params = new URLSearchParams();

  if (item.assigneeId) {
    params.set("assigneeId", item.assigneeId);
  }

  params.set("statusCategory", item.currentStatus.statusCategory);

  if (item.versionId) {
    params.set("versionId", item.versionId);
  }

  const query = params.toString();

  return query ? `${path}?${query}` : path;
}

function resolveSessionUserName(
  userId: string | undefined,
  currentUserId: string,
  currentUserName: string,
) {
  if (!userId) {
    return undefined;
  }

  return userId === currentUserId ? currentUserName : userId;
}

function createTargetHref(item: TimelineEvent) {
  switch (item.target.type) {
    case "REQUIREMENT":
      return `/requirements/${item.target.id}`;
    case "WORK_ITEM":
      return `/spaces/${item.spaceId}/work-items`;
    case "INTAKE_ITEM":
      return `/spaces/${item.spaceId}/intake-items`;
    case "VERSION":
      return `/spaces/${item.spaceId}/versions`;
    case "SPACE":
      return "/";
    default:
      return undefined;
  }
}

function formatDateTime(value: string | undefined, locale: string) {
  if (!value) {
    return undefined;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}
