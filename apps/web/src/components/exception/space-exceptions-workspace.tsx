"use client";

import type {
  GetSpaceExceptionsViewResponse,
  Space,
  SpaceExceptionItem,
  SpaceMemberWithUser,
  StatusCategory,
  ViewExceptionType,
  WorkItemType,
} from "@project-delivery/shared";
import {
  ArrowUpRight,
  CircleAlert,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Link } from "../../i18n/routing";
import {
  getApiErrorMessageKey,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";
import { updateSpaceFormSchema } from "../../lib/space-forms";
import {
  canManageSpace,
  getSpace,
  listSpaceMembers,
  updateSpace,
} from "../../lib/space-service";
import {
  createSpaceExceptionsViewCacheKey,
} from "../../lib/view-cache";
import {
  M4_EXCEPTION_TYPE_OPTIONS,
  M4_STATUS_CATEGORY_OPTIONS,
  M4_WORK_ITEM_TYPE_OPTIONS,
  toSpaceExceptionsViewQuery,
} from "../../lib/view-forms";
import { getSpaceExceptionsView } from "../../lib/view-service";
import { useSession } from "../providers/session-provider";
import {
  ExceptionTypeTag,
  ViewEmptyState,
  WorkItemSummaryCard,
} from "../view";

const EXCEPTION_TYPES: ViewExceptionType[] = [
  "overdue",
  "blocked",
  "pending_confirm",
  "pending_regression",
  "stale",
];

type SpaceExceptionsWorkspaceProps = {
  initialAssigneeId?: string;
  initialExceptionType?: ViewExceptionType;
  initialStatusCategory?: StatusCategory;
  initialWorkItemType?: WorkItemType;
  spaceId: string;
};

export function SpaceExceptionsWorkspace({
  initialAssigneeId,
  initialExceptionType,
  initialStatusCategory,
  initialWorkItemType,
  spaceId,
}: SpaceExceptionsWorkspaceProps) {
  const t = useTranslations("spaceExceptions");
  const tRoot = useTranslations();
  const { session, status } = useSession();
  const [view, setView] = useState<GetSpaceExceptionsViewResponse | null>(null);
  const [loadedCacheKey, setLoadedCacheKey] = useState("");
  const [space, setSpace] = useState<Space | null>(null);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [exceptionTypeFilter, setExceptionTypeFilter] = useState<
    ViewExceptionType | "ALL"
  >(initialExceptionType ?? "ALL");
  const [assigneeFilter, setAssigneeFilter] = useState(initialAssigneeId ?? "");
  const [statusCategoryFilter, setStatusCategoryFilter] = useState<
    StatusCategory | "ALL"
  >(initialStatusCategory ?? "ALL");
  const [workItemTypeFilter, setWorkItemTypeFilter] = useState<
    WorkItemType | "ALL"
  >(initialWorkItemType ?? "ALL");
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingThreshold, setIsSavingThreshold] = useState(false);
  const [errorKey, setErrorKey] = useState<ApiErrorMessageKey | null>(null);
  const [thresholdErrorKey, setThresholdErrorKey] =
    useState<ApiErrorMessageKey | null>(null);
  const [thresholdValidationError, setThresholdValidationError] =
    useState(false);
  const [thresholdSaved, setThresholdSaved] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("3");

  const currentSpace = useMemo(
    () => session?.spaces.find((item) => item.id === spaceId),
    [session, spaceId],
  );
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;
  const canEditThreshold = canManageSpace(currentSpace?.role);
  const memberNameByUserId = useMemo(() => {
    const lookup = new Map<string, string>();

    for (const member of members) {
      lookup.set(member.userId, formatMember(member));
    }

    return lookup;
  }, [members]);
  const viewQuery = useMemo(
    () =>
      toSpaceExceptionsViewQuery({
        assigneeId: assigneeFilter,
        exceptionType: exceptionTypeFilter,
        organizationId,
        page: 1,
        pageSize: 100,
        statusCategory: statusCategoryFilter,
        workItemType: workItemTypeFilter,
      }),
    [
      assigneeFilter,
      exceptionTypeFilter,
      organizationId,
      statusCategoryFilter,
      workItemTypeFilter,
    ],
  );
  const cacheKey = useMemo(
    () =>
      createSpaceExceptionsViewCacheKey({
        ...viewQuery,
        spaceId,
      }),
    [spaceId, viewQuery],
  );

  useEffect(() => {
    setView(null);
    setLoadedCacheKey("");
    setSpace(null);
    setMembers([]);
    setExceptionTypeFilter(initialExceptionType ?? "ALL");
    setAssigneeFilter(initialAssigneeId ?? "");
    setStatusCategoryFilter(initialStatusCategory ?? "ALL");
    setWorkItemTypeFilter(initialWorkItemType ?? "ALL");
    setErrorKey(null);
    setThresholdErrorKey(null);
    setThresholdValidationError(false);
    setThresholdSaved(false);
    setIsLoading(false);
    setIsRefreshing(false);
  }, [
    initialAssigneeId,
    initialExceptionType,
    initialStatusCategory,
    initialWorkItemType,
    organizationId,
    spaceId,
  ]);

  useEffect(() => {
    if (space) {
      setThresholdInput(String(space.settings.staleThresholdDays));
    }
  }, [space]);

  useEffect(() => {
    if (status !== "authenticated" || !currentSpace) {
      setView(null);
      setLoadedCacheKey("");
      setSpace(null);
      setMembers([]);
      setIsLoading(false);
      return;
    }

    let isActive = true;

    async function load() {
      setIsLoading(true);
      setErrorKey(null);

      try {
        const [nextView, nextSpace, memberPage] = await Promise.all([
          getSpaceExceptionsView({
            ...viewQuery,
            spaceId,
          }),
          getSpace(spaceId),
          listSpaceMembers(spaceId),
        ]);

        if (!isActive) {
          return;
        }

        setView(nextView);
        setLoadedCacheKey(cacheKey);
        setSpace(nextSpace);
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
  }, [cacheKey, currentSpace, spaceId, status, viewQuery]);

  async function refreshExceptions() {
    if (status !== "authenticated" || !currentSpace) {
      return;
    }

    setIsRefreshing(true);
    setErrorKey(null);

    try {
      const nextView = await getSpaceExceptionsView({
        ...viewQuery,
        spaceId,
      });

      setView(nextView);
      setLoadedCacheKey(cacheKey);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function onThresholdSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canEditThreshold) {
      return;
    }

    setThresholdErrorKey(null);
    setThresholdValidationError(false);
    setThresholdSaved(false);

    const parseResult = updateSpaceFormSchema
      .pick({ staleThresholdDays: true })
      .safeParse({ staleThresholdDays: thresholdInput });

    if (
      !parseResult.success ||
      typeof parseResult.data.staleThresholdDays !== "number"
    ) {
      setThresholdValidationError(true);
      return;
    }

    setIsSavingThreshold(true);

    try {
      const nextSpace = await updateSpace(spaceId, {
        staleThresholdDays: parseResult.data.staleThresholdDays,
      });
      setSpace(nextSpace);
      setThresholdSaved(true);
      await refreshExceptions();
    } catch (error) {
      setThresholdErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSavingThreshold(false);
    }
  }

  if (status === "loading") {
    return (
      <StatePanel
        icon="loading"
        title={t("states.sessionLoading.title")}
        description={t("states.sessionLoading.description")}
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
        icon="locked"
        title={t("states.noAccess.title")}
        description={t("states.noAccess.description")}
      />
    );
  }

  const activeView = loadedCacheKey === cacheKey ? view : null;
  const items = activeView?.items.items ?? [];

  return (
    <div className="workbench-page">
      <section className="page-heading" aria-labelledby="exceptions-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="exceptions-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{formatSpaceScope(currentSpace, t("page.unknownSpace"))}</span>
          <button
            className="button button--secondary"
            disabled={isLoading || isRefreshing}
            onClick={() => void refreshExceptions()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            {isRefreshing ? t("actions.refreshing") : t("actions.refresh")}
          </button>
        </div>
      </section>

      {errorKey ? (
        <div className="form-alert" role="alert">
          {tRoot(errorKey)}
        </div>
      ) : null}

      <section className="compact-metric-grid" aria-label={t("counts.label")}>
        {EXCEPTION_TYPES.map((type) => (
          <div className="compact-metric" key={type}>
            <span>{t(`counts.${type}`)}</span>
            <strong>{getExceptionCount(activeView, type)}</strong>
          </div>
        ))}
      </section>

      <section className="toolbar-panel" aria-label={t("filters.label")}>
        <FilterSelect
          allLabelKey="m4Views.filters.allExceptionTypes"
          labelKey="m4Views.filters.exceptionType"
          onChange={(value) =>
            setExceptionTypeFilter(value as ViewExceptionType | "ALL")
          }
          options={M4_EXCEPTION_TYPE_OPTIONS}
          value={exceptionTypeFilter}
        />
        <label className="field">
          <span>{tRoot("m4Views.filters.assignee")}</span>
          <select
            onChange={(event) => setAssigneeFilter(event.target.value)}
            value={assigneeFilter}
          >
            <option value="">{tRoot("m4Views.filters.allAssignees")}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {formatMember(member)}
              </option>
            ))}
          </select>
        </label>
        <FilterSelect
          allLabelKey="m4Views.filters.allStatusCategories"
          labelKey="m4Views.filters.statusCategory"
          onChange={(value) =>
            setStatusCategoryFilter(value as StatusCategory | "ALL")
          }
          options={M4_STATUS_CATEGORY_OPTIONS}
          value={statusCategoryFilter}
        />
        <FilterSelect
          allLabelKey="m4Views.filters.allWorkItemTypes"
          labelKey="m4Views.filters.workItemType"
          onChange={(value) =>
            setWorkItemTypeFilter(value as WorkItemType | "ALL")
          }
          options={M4_WORK_ITEM_TYPE_OPTIONS}
          value={workItemTypeFilter}
        />
      </section>

      <div className="exception-layout">
        <section className="panel panel--wide" aria-labelledby="exception-list-title">
          <div className="panel__header">
            <div>
              <h3 id="exception-list-title">{t("list.title")}</h3>
              <p>{t("list.subtitle", { count: activeView?.items.total ?? 0 })}</p>
            </div>
            <span className="panel__badge">
              {t("list.pageSize", { count: activeView?.items.items.length ?? 0 })}
            </span>
          </div>

          {isLoading && !view ? (
            <InlineState label={t("states.loadingList")} />
          ) : items.length === 0 ? (
            <ViewEmptyState
              descriptionKey="spaceExceptions.states.empty.description"
              titleKey="spaceExceptions.states.empty.title"
            />
          ) : (
            <div className="exception-list" data-cache-key={cacheKey} role="list">
              {items.map((item) => (
                <ExceptionListItem
                  assigneeName={
                    item.workItem.assigneeId
                      ? memberNameByUserId.get(item.workItem.assigneeId)
                      : undefined
                  }
                  item={item}
                  key={item.workItem.id}
                  reporterName={memberNameByUserId.get(item.workItem.reporterId)}
                  spaceId={spaceId}
                />
              ))}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="stale-threshold-title">
          <div className="panel__header">
            <div>
              <h3 id="stale-threshold-title">{t("threshold.title")}</h3>
              <p>{t("threshold.description")}</p>
            </div>
            <ShieldCheck aria-hidden="true" size={18} strokeWidth={2} />
          </div>

          {thresholdErrorKey ? (
            <div className="form-alert" role="alert">
              {tRoot(thresholdErrorKey)}
            </div>
          ) : null}
          {thresholdSaved ? (
            <div className="readonly-note" role="status">
              <Save aria-hidden="true" size={16} strokeWidth={2} />
              <span>{t("threshold.saved")}</span>
            </div>
          ) : null}

          {canEditThreshold ? (
            <form className="business-form" noValidate onSubmit={onThresholdSubmit}>
              <label className="field" htmlFor="space-exceptions-threshold">
                <span>{t("threshold.field.label")}</span>
                <input
                  aria-invalid={thresholdValidationError}
                  id="space-exceptions-threshold"
                  max={30}
                  min={1}
                  onChange={(event) => {
                    setThresholdInput(event.target.value);
                    setThresholdValidationError(false);
                    setThresholdSaved(false);
                  }}
                  type="number"
                  value={thresholdInput}
                />
                {thresholdValidationError ? (
                  <small role="alert">{t("threshold.field.error")}</small>
                ) : (
                  <small>{t("threshold.field.hint")}</small>
                )}
              </label>
              <button
                className="button button--primary"
                disabled={isSavingThreshold}
                type="submit"
              >
                <Save aria-hidden="true" size={16} strokeWidth={2} />
                {isSavingThreshold
                  ? t("threshold.submitting")
                  : t("threshold.submit")}
              </button>
            </form>
          ) : (
            <>
              <div className="readonly-note">
                <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
                <span>{t("threshold.readonly")}</span>
              </div>
              <dl className="definition-list">
                <div>
                  <dt>{t("threshold.field.label")}</dt>
                  <dd>
                    {t("threshold.readonlyValue", {
                      count: space?.settings.staleThresholdDays ?? 3,
                    })}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

type FilterSelectProps = {
  allLabelKey: string;
  labelKey: string;
  onChange: (value: string) => void;
  options: readonly {
    labelKey: string;
    value: string;
  }[];
  value: string;
};

function FilterSelect({
  allLabelKey,
  labelKey,
  onChange,
  options,
  value,
}: FilterSelectProps) {
  const t = useTranslations();

  return (
    <label className="field">
      <span>{t(labelKey)}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="ALL">{t(allLabelKey)}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.labelKey)}
          </option>
        ))}
      </select>
    </label>
  );
}

type ExceptionListItemProps = {
  assigneeName?: string;
  item: SpaceExceptionItem;
  reporterName?: string;
  spaceId: string;
};

function ExceptionListItem({
  assigneeName,
  item,
  reporterName,
  spaceId,
}: ExceptionListItemProps) {
  const t = useTranslations("spaceExceptions");
  const locale = useLocale();

  return (
    <article className="exception-list__item" role="listitem">
      <WorkItemSummaryCard
        assigneeName={assigneeName}
        item={{
          ...item.workItem,
          exceptionSignals: item.exceptions,
        }}
        reporterName={reporterName}
        trailing={
          <Link
            className="button button--secondary"
            href={createWorkItemHref(spaceId, item.workItem)}
          >
            <ArrowUpRight aria-hidden="true" size={16} strokeWidth={2} />
            {t("list.openDetail")}
          </Link>
        }
      />
      <dl className="exception-evidence-list" aria-label={t("list.evidence")}>
        {item.exceptions.map((exception) => (
          <div
            key={`${exception.type}:${exception.evidenceSource}:${exception.reason}`}
          >
            <dt>
              <ExceptionTypeTag type={exception.type} />
            </dt>
            <dd>
              <span>{exception.reason}</span>
              <small>{formatExceptionMeta(exception, locale, t)}</small>
            </dd>
          </div>
        ))}
      </dl>
    </article>
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
  icon: "loading" | "locked" | "warning";
  title: string;
}) {
  const Icon =
    icon === "loading"
      ? Loader2
      : icon === "locked"
        ? ShieldCheck
        : CircleAlert;

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

function getExceptionCount(
  view: GetSpaceExceptionsViewResponse | null,
  type: ViewExceptionType,
) {
  return view?.counts.find((item) => item.exceptionType === type)?.count ?? 0;
}

function createWorkItemHref(
  spaceId: string,
  workItem: SpaceExceptionItem["workItem"],
) {
  const params = new URLSearchParams();
  params.set(workItem.type === "BUG" ? "bugId" : "workItemId", workItem.id);

  if (workItem.assigneeId) {
    params.set("assigneeId", workItem.assigneeId);
  }

  params.set("statusCategory", workItem.currentStatus.statusCategory);

  return `/spaces/${spaceId}/${workItem.type === "BUG" ? "bugs" : "work-items"}?${params.toString()}`;
}

function formatExceptionMeta(
  exception: SpaceExceptionItem["exceptions"][number],
  locale: string,
  t: ReturnType<typeof useTranslations>,
) {
  if (exception.type === "stale" && exception.staleDays !== undefined) {
    return t("list.staleMeta", {
      count: exception.staleDays,
      threshold: exception.staleThresholdDays ?? 0,
    });
  }

  if (exception.dueDate) {
    return t("list.dueMeta", {
      date: formatDate(exception.dueDate, locale),
    });
  }

  if (exception.lastStatusChangedAt) {
    return t("list.lastChangedMeta", {
      date: formatDate(exception.lastStatusChangedAt, locale),
    });
  }

  return t("list.sourceMeta", {
    source: t(`evidenceSource.${exception.evidenceSource}`),
  });
}

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatMember(member: SpaceMemberWithUser) {
  return `${member.user.name} (${member.user.username})`;
}

function formatSpaceScope(
  space: { code: string; name: string } | undefined,
  fallback: string,
) {
  return space ? `${space.name} / ${space.code}` : fallback;
}
