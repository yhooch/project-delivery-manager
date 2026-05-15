"use client";

import type {
  Comment,
  IntakeItem,
  IntakeSourceType,
  IntakeStatus,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  StatusCategory,
  TimelineEvent,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Filter,
  GitBranch,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Target,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { createComment, listComments } from "../../lib/comment-service";
import { formatDisplayCode } from "../../lib/display-code";
import {
  useFocusReturn,
  useListKeyboardNav,
} from "../../lib/hooks/use-list-keyboard-nav";
import {
  acceptIntakeItem,
  deferIntakeItem,
  getIntakeItem,
  listIntakeItems,
  rejectIntakeItem,
  type IntakeListFilterState,
} from "../../lib/intake-service";
import { listRequirements } from "../../lib/requirement-service";
import { listTimeline } from "../../lib/timeline-service";
import { cn } from "../../lib/utils";
import { useSpaceMembers, useVersions } from "../../lib/v2/lookups";
import { listWorkItems } from "../../lib/work-item-service";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { StatusBadge } from "../ui/status-badge";
import { PageHeader } from "../v2/page-header";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
} from "../v2/states";

import { ConvertIntakeDialog } from "./convert-intake-dialog";
import { CreateIntakeDialog } from "./create-intake-dialog";
import { EditIntakeDialog } from "./edit-intake-dialog";

const priorityDot: Record<Priority, string> = {
  LOW: "bg-muted-foreground/40",
  MEDIUM: "bg-info",
  HIGH: "bg-warning",
  URGENT: "bg-destructive",
};

const SOURCE_TYPES: IntakeSourceType[] = [
  "REQUIREMENT_CHANGE",
  "DEFECT_PROBLEM",
  "PROJECT_PLAN",
  "MEETING_DECISION",
  "AD_HOC",
  "IMPLEMENTATION",
  "OPERATIONS",
  "RELEASE",
  "EXTERNAL_COLLABORATION",
];

const PRIORITY_FILTERS: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const LIST_PAGE_SIZE = 100;
const INITIAL_PAGE_INFO = { page: 1, pageSize: LIST_PAGE_SIZE, total: 0 };

const intakeStatusToCategory: Record<IntakeStatus, StatusCategory> = {
  PENDING: "NOT_STARTED",
  ACCEPTED: "IN_PROGRESS",
  DEFERRED: "WAITING",
  REJECTED: "TERMINATED",
  CONVERTED: "DONE",
};

type FilterKey =
  | "all"
  | "PENDING"
  | "ACCEPTED"
  | "DEFERRED"
  | "REJECTED"
  | "CONVERTED";

type StatusActionKind = "accept" | "defer" | "reject";

export function IntakePage() {
  const t = useTranslations("intake");
  const tNav = useTranslations("shell.nav");
  const tIntakeItems = useTranslations("intakeItems");
  const tRoot = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedIntakeItemId = normalizeSearchParam(searchParams.get("id"));
  const { currentSpace, session, status: sessionStatus } = useSession();
  const spaceId = session?.defaultSpaceId;
  const organizationId = session?.defaultOrganizationId;
  const sessionSpace = session?.spaces?.find((space) => space.id === spaceId);
  const currentSpaceRole = currentSpace?.role ?? sessionSpace?.role;
  const currentSpaceStatus = currentSpace?.status ?? sessionSpace?.status;
  const canCreateOrCommentIntake = canCreateOrCommentIntakeItem(
    currentSpaceRole,
    currentSpaceStatus,
  );
  const canManageIntake = canManageIntakeItem(
    currentSpaceRole,
    currentSpaceStatus,
  );
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );
  const { members, getMember } = useSpaceMembers(spaceId, organizationId);
  const { versions, getVersion } = useVersions(spaceId, organizationId);

  const [items, setItems] = useState<IntakeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [listFilters, setListFilters] = useState<IntakeListFilterState>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [active, setActive] = useState<IntakeItem | null>(null);
  const [actionInFlight, setActionInFlight] = useState<StatusActionKind | null>(
    null,
  );
  const [viewTasksInFlight, setViewTasksInFlight] = useState(false);
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pageInfo, setPageInfo] = useState(INITIAL_PAGE_INFO);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<IntakeItem | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [timelineRefreshVersion, setTimelineRefreshVersion] = useState(0);
  const [handledDeepLinkKey, setHandledDeepLinkKey] = useState<string | null>(
    null,
  );
  const { captureFocus, restoreFocus } = useFocusReturn();
  const listScopeKey = useMemo(
    () =>
      createIntakeListScopeKey({
        filter,
        listFilters,
        organizationId,
        spaceId,
      }),
    [filter, listFilters, organizationId, spaceId],
  );
  const contextKey = useMemo(
    () => `${organizationId ?? ""}:${spaceId ?? ""}`,
    [organizationId, spaceId],
  );
  const latestListScopeKeyRef = useRef(listScopeKey);
  const listRequestIdRef = useRef(0);
  const previousContextKeyRef = useRef(contextKey);
  latestListScopeKeyRef.current = listScopeKey;
  const loadedCount = items.length;
  const paginationFrom = loadedCount > 0 ? 1 : 0;
  const paginationTo = Math.min(loadedCount, pageInfo.total);
  const hasMoreItems = loadedCount < pageInfo.total;

  const setListFilter = useCallback(
    (key: keyof IntakeListFilterState, value: string) => {
      setListFilters((current) => ({ ...current, [key]: value || undefined }));
    },
    [],
  );

  const loadItems = useCallback(async (
    page = 1,
    mode: "replace" | "append" = "replace",
  ) => {
    if (!spaceId) {
      return;
    }

    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    const requestScopeKey = listScopeKey;
    const append = mode === "append";

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setHasLoadedItems(false);
    }
    setErrorKey(null);

    try {
      const result = await listIntakeItems({
        organizationId,
        page,
        pageSize: LIST_PAGE_SIZE,
        spaceId,
        status: filter === "all" ? undefined : filter,
        ...listFilters,
      });
      if (
        listRequestIdRef.current !== requestId ||
        latestListScopeKeyRef.current !== requestScopeKey
      ) {
        return;
      }
      setItems((current) =>
        append ? [...current, ...result.items] : result.items,
      );
      setPageInfo({
        page: result.page ?? page,
        pageSize: result.pageSize ?? LIST_PAGE_SIZE,
        total: result.total ?? result.items.length,
      });
    } catch (error) {
      if (
        listRequestIdRef.current === requestId &&
        latestListScopeKeyRef.current === requestScopeKey
      ) {
        setErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (
        listRequestIdRef.current === requestId &&
        latestListScopeKeyRef.current === requestScopeKey
      ) {
        if (append) {
          setIsLoadingMore(false);
        } else {
          setIsLoading(false);
        }
        setHasLoadedItems(true);
      }
    }
  }, [filter, listFilters, listScopeKey, organizationId, spaceId]);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !spaceId) {
      if (sessionStatus !== "loading") {
        listRequestIdRef.current += 1;
        setItems([]);
        setPageInfo(INITIAL_PAGE_INFO);
        setIsLoading(false);
        setIsLoadingMore(false);
        setHasLoadedItems(false);
      }
      return;
    }
    void loadItems(1, "replace");
  }, [loadItems, sessionStatus, spaceId]);

  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) {
      return;
    }
    previousContextKeyRef.current = contextKey;
    setActive(null);
    setActionInFlight(null);
    setActionErrorKey(null);
    setCreateOpen(false);
    setEditOpen(false);
    setConvertOpen(false);
    setConvertTarget(null);
    setFilterOpen(false);
    setRequirements([]);
    setTimelineRefreshVersion(0);
    setHandledDeepLinkKey(null);
  }, [contextKey]);

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

  const filtered = items;

  const buckets: { label: string; key: FilterKey; count: number }[] = useMemo(
    () => [
      { label: t("filters.all"), key: "all", count: items.length },
      {
        label: t("filters.pending"),
        key: "PENDING",
        count: items.filter((it) => it.status === "PENDING").length,
      },
      {
        label: t("filters.accepted"),
        key: "ACCEPTED",
        count: items.filter((it) => it.status === "ACCEPTED").length,
      },
      {
        label: t("filters.deferred"),
        key: "DEFERRED",
        count: items.filter((it) => it.status === "DEFERRED").length,
      },
      {
        label: tIntakeItems("status.REJECTED"),
        key: "REJECTED",
        count: items.filter((it) => it.status === "REJECTED").length,
      },
      {
        label: t("filters.converted"),
        key: "CONVERTED",
        count: items.filter((it) => it.status === "CONVERTED").length,
      },
    ],
    [items, t, tIntakeItems],
  );

  const openItem = useCallback(
    (item: IntakeItem) => {
      captureFocus();
      recordRecentOpen(
        {
          id: item.id,
          type: "INTAKE",
          code: formatItemCode(item.id),
          title: item.title,
          href: `/intake-items?id=${encodeURIComponent(item.id)}`,
        },
        recentScope,
      );
      setActive(item);
    },
    [captureFocus, recentScope],
  );

  useEffect(() => {
    if (!requestedIntakeItemId || !spaceId) {
      return;
    }

    const key = `intake:${spaceId}:${requestedIntakeItemId}`;
    if (handledDeepLinkKey === key) {
      return;
    }

    const listed = items.find((item) => item.id === requestedIntakeItemId);
    if (listed) {
      openItem(listed);
      setHandledDeepLinkKey(key);
      return;
    }

    if (isLoading || !hasLoadedItems) {
      return;
    }

    let cancelled = false;
    void getIntakeItem({
      intakeItemId: requestedIntakeItemId,
      organizationId,
      spaceId,
    })
      .then((item) => {
        if (!cancelled) {
          openItem(item);
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
    handledDeepLinkKey,
    hasLoadedItems,
    isLoading,
    items,
    openItem,
    organizationId,
    requestedIntakeItemId,
    spaceId,
  ]);

  useListKeyboardNav<IntakeItem>({
    items: filtered,
    activeId: active?.id,
    getId: (item) => item.id,
    onSelect: setActive,
    onOpen: openItem,
    onEdit: openItem,
    canAssign: () => canManageIntake,
    onAssign: (item) => {
      captureFocus();
      setActive(item);
      setEditOpen(true);
    },
    canSubmit: (item) => canSubmitIntakeItem(item, canManageIntake),
    onSubmit: (item) => {
      if (!canManageIntake) {
        return;
      }
      if (item.status === "PENDING" || item.status === "DEFERRED") {
        void handleStatusAction("accept", item);
      } else if (item.status === "ACCEPTED") {
        setActive(item);
        setConvertTarget(item);
        setConvertOpen(true);
      }
    },
    onClose: () => {
      setActive(null);
      setActionErrorKey(null);
    },
  });

  function handleCloseDrawer(open: boolean) {
    if (!open) {
      setActive(null);
      setActionErrorKey(null);
      setEditOpen(false);
      restoreFocus();
    }
  }

  async function handleStatusAction(
    action: StatusActionKind,
    target: IntakeItem | null = active,
  ) {
    if (!target || !spaceId || !canManageIntake) {
      return;
    }

    setActionInFlight(action);
    setActionErrorKey(null);

    const original = items;
    const optimisticStatus: IntakeStatus =
      action === "accept"
        ? "ACCEPTED"
        : action === "defer"
          ? "DEFERRED"
          : "REJECTED";
    const optimistic: IntakeItem = { ...target, status: optimisticStatus };

    setItems((current) =>
      current.map((item) => (item.id === target.id ? optimistic : item)),
    );
    setActive(optimistic);

    try {
      const context = { intakeItemId: target.id, organizationId, spaceId };
      const updated =
        action === "accept"
          ? await acceptIntakeItem(context)
          : action === "defer"
            ? await deferIntakeItem(context)
            : await rejectIntakeItem(context);

      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setActive((current) => (current?.id === updated.id ? updated : current));
      void loadItems(1, "replace");
    } catch (error) {
      setItems(original);
      setActive((current) => (current?.id === target.id ? target : current));
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setActionInFlight(null);
    }
  }

  function openConvertDialog() {
    if (!active || !canManageIntake || active.status !== "ACCEPTED") {
      return;
    }
    setConvertTarget(active);
    setConvertOpen(true);
  }

  function handleUpdatedIntakeItem(updated: IntakeItem) {
    setItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setActive((current) => (current?.id === updated.id ? updated : current));
  }

  function handleConvertedIntakeItem(result: {
    intakeItemId: string;
    workItems: WorkItem[];
  }) {
    const target =
      convertTarget?.id === result.intakeItemId
        ? convertTarget
        : active?.id === result.intakeItemId
          ? active
          : items.find((item) => item.id === result.intakeItemId);

    if (target) {
      handleUpdatedIntakeItem({
        ...target,
        convertedAt: new Date().toISOString(),
        status: "CONVERTED",
      });
    }

    void loadItems(1, "replace");
  }

  async function handleViewConvertedTasks(target: IntakeItem | null = active) {
    if (!target || !spaceId || target.status !== "CONVERTED") {
      return;
    }

    setViewTasksInFlight(true);

    try {
      const related = await listWorkItems({
        organizationId,
        intakeItemId: target.id,
        page: 1,
        pageSize: 2,
        spaceId,
      });
      const firstTask = related.items[0];
      const href =
        related.total === 1 && firstTask
          ? buildWorkItemsHref({ workItemId: firstTask.id })
          : buildWorkItemsHref({ intakeItemId: target.id });

      router.push(href);
    } catch {
      router.push(buildWorkItemsHref({ intakeItemId: target.id }));
    } finally {
      setViewTasksInFlight(false);
    }
  }

  const headerActions = spaceId ? (
    <>
      <Button
        size="sm"
        variant={filterOpen ? "secondary" : "outline"}
        className="text-xs"
        data-testid="intake-filter-button"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen((open) => !open)}
        type="button"
      >
        <Filter className="h-3 w-3" />
        {t("actions.filter")}
      </Button>
      {canCreateOrCommentIntake && (
        <Button
          size="sm"
          className="text-xs"
          data-testid="intake-create-button"
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          <Plus className="h-3 w-3" />
          {t("page.create")}
        </Button>
      )}
    </>
  ) : null;
  const paginationFooter =
    pageInfo.total > 0 ? (
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <span data-testid="intake-pagination-summary">
          {t("pagination.summary", {
            from: paginationFrom,
            to: paginationTo,
            total: pageInfo.total,
          })}
        </span>
        {hasMoreItems ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-testid="intake-load-more"
            disabled={isLoadingMore}
            onClick={() => {
              void loadItems(pageInfo.page + 1, "append");
            }}
          >
            {isLoadingMore
              ? t("pagination.loadingMore")
              : t("pagination.loadMore")}
          </Button>
        ) : null}
      </div>
    ) : null;

  let body: React.ReactNode;

  if (sessionStatus === "loading") {
    body = <LoadingState label={t("states.loading")} />;
  } else if (sessionStatus === "unauthenticated" || !session) {
    body = (
      <EmptyState
        title={t("states.unauthenticated.title")}
        description={t("states.unauthenticated.description")}
      />
    );
  } else if (!spaceId) {
    body = (
      <EmptyState
        title={t("states.noSpace.title")}
        description={t("states.noSpace.description")}
      />
    );
  } else if (isLoading && items.length === 0) {
    body = <ListSkeleton rows={6} />;
  } else if (errorKey) {
    body = (
      <ErrorState
        title={t("states.error.title")}
        message={tRoot(errorKey)}
        onRetry={() => void loadItems(1, "replace")}
        retryLabel={t("actions.retry")}
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <>
        <EmptyState
          title={t("states.empty.title")}
          description={t("states.empty.description")}
        />
        {paginationFooter}
      </>
    );
  } else {
    body = (
      <>
        <ul
          data-testid="intake-list"
          role="listbox"
          className="divide-y divide-border"
        >
          {filtered.map((item) => (
            <li
              key={item.id}
              data-testid="intake-row"
              data-id={item.id}
              role="option"
              aria-selected={active?.id === item.id}
            >
              <button
                type="button"
                onClick={() => openItem(item)}
                data-selected={active?.id === item.id}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors cursor-pointer sm:px-6",
                  active?.id === item.id
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    priorityDot[item.priority ?? "MEDIUM"],
                  )}
                />
                <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatItemCode(item.id)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {item.title}
                </span>
                <Badge variant="outline" className="hidden md:inline-flex">
                  {tIntakeItems(`sourceType.${item.sourceType}`)}
                </Badge>
                <span className="shrink-0">
                  <StatusBadge
                    category={intakeStatusToCategory[item.status]}
                    label={tIntakeItems(`status.${item.status}`)}
                    withDot={false}
                  />
                </span>
                {item.versionId && (
                  <span className="hidden gap-1 text-[11px] text-muted-foreground md:inline-flex">
                    <GitBranch className="h-2.5 w-2.5" />
                    {displayVersionName(item.versionId, getVersion)}
                  </span>
                )}
                {item.assigneeId && (
                  <span className="hidden max-w-28 truncate text-[11px] text-muted-foreground lg:inline-block">
                    {displayUserName(item.assigneeId, getMember)}
                  </span>
                )}
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarFallback className="text-[9px]">
                    {initialOf(displayUserName(item.reporterId, getMember))}
                  </AvatarFallback>
                </Avatar>
              </button>
            </li>
          ))}
        </ul>
        {paginationFooter}
      </>
    );
  }

  return (
    <div data-testid="intake-page" className="flex h-full min-w-0 flex-col">
      <PageHeader
        eyebrow={tNav("group.document")}
        title={tNav("intake")}
        description={t("page.description")}
        actions={headerActions}
      />

      {sessionStatus === "authenticated" && spaceId && !errorKey && (
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max items-center gap-1">
              {buckets.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  data-testid="intake-filter-option"
                  data-filter-key={b.key}
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
          </div>
        </div>
      )}

      {sessionStatus === "authenticated" && spaceId && filterOpen && (
        <div
          data-testid="intake-filter-panel"
          className="grid min-w-0 gap-3 border-b border-border bg-muted/20 px-4 py-3 sm:px-6 md:grid-cols-3 xl:grid-cols-5"
        >
          <FilterField label={t("filters.version")}>
            <select
              data-testid="intake-filter-version"
              value={listFilters.versionId ?? ""}
              onChange={(event) =>
                setListFilter("versionId", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allVersions")}</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("filters.requirement")}>
            <select
              data-testid="intake-filter-requirement"
              value={listFilters.requirementId ?? ""}
              onChange={(event) =>
                setListFilter("requirementId", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allRequirements")}</option>
              {requirements.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.title || requirement.id}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("filters.priority")}>
            <select
              data-testid="intake-filter-priority"
              value={listFilters.priority ?? ""}
              onChange={(event) =>
                setListFilter("priority", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allPriorities")}</option>
              {PRIORITY_FILTERS.map((priority) => (
                <option key={priority} value={priority}>
                  {tIntakeItems(`priority.${priority}`)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("filters.sourceType")}>
            <select
              data-testid="intake-filter-source"
              value={listFilters.sourceType ?? ""}
              onChange={(event) =>
                setListFilter("sourceType", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allSourceTypes")}</option>
              {SOURCE_TYPES.map((sourceType) => (
                <option key={sourceType} value={sourceType}>
                  {tIntakeItems(`sourceType.${sourceType}`)}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label={t("filters.assignee")}>
            <select
              data-testid="intake-filter-assignee"
              value={listFilters.assigneeId ?? ""}
              onChange={(event) =>
                setListFilter("assigneeId", event.target.value)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">{t("filters.allAssignees")}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user.name || member.user.username}
                </option>
              ))}
            </select>
          </FilterField>
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto">{body}</div>

      <Sheet open={Boolean(active)} onOpenChange={handleCloseDrawer}>
        <SheetContent
          className="flex flex-col gap-0 p-0"
          data-testid="intake-detail-sheet"
        >
          {active && (
            <>
              <SheetHeader className="px-5 py-4">
                <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                  <Target className="h-3.5 w-3.5" />
                  <span>{formatItemCode(active.id)}</span>
                  <ChevronRight className="h-3 w-3" />
                  <span>{tIntakeItems(`sourceType.${active.sourceType}`)}</span>
                </div>
                <SheetTitle className="mt-1 text-base leading-snug">
                  {active.title}
                </SheetTitle>
                <SheetDescription className="sr-only">
                  {t("detail.sheetDescription")}
                </SheetDescription>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge
                    category={intakeStatusToCategory[active.status]}
                    label={tIntakeItems(`status.${active.status}`)}
                  />
                  <Badge variant="outline">
                    {tIntakeItems(`sourceType.${active.sourceType}`)}
                  </Badge>
                  {active.versionId && (
                    <Badge variant="outline" className="gap-1">
                      <GitBranch className="h-2.5 w-2.5" />
                      {displayVersionName(active.versionId, getVersion)}
                    </Badge>
                  )}
                </div>
              </SheetHeader>

              <div className="flex min-w-0 flex-col gap-2 border-b border-border bg-muted/30 px-5 py-2.5 sm:flex-row sm:items-center">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("detail.actions")}
                </span>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:ml-auto sm:justify-end">
                  {canManageIntake && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      data-testid="intake-edit-button"
                      disabled={actionInFlight !== null}
                      onClick={() => setEditOpen(true)}
                      type="button"
                    >
                      <Pencil className="h-3 w-3" />
                      {t("detail.edit")}
                    </Button>
                  )}
                  {canManageIntake &&
                    (active.status === "PENDING" ||
                      active.status === "DEFERRED") && (
                      <>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          data-testid="intake-accept-button"
                          disabled={actionInFlight !== null}
                          onClick={() => void handleStatusAction("accept")}
                          type="button"
                        >
                          {actionInFlight === "accept"
                            ? tIntakeItems("statusActions.accepting")
                            : tIntakeItems("statusActions.accept")}
                        </Button>
                        {active.status === "PENDING" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs"
                            data-testid="intake-defer-button"
                            disabled={actionInFlight !== null}
                            onClick={() => void handleStatusAction("defer")}
                            type="button"
                          >
                            {actionInFlight === "defer"
                              ? tIntakeItems("statusActions.deferring")
                              : tIntakeItems("statusActions.defer")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          data-testid="intake-reject-button"
                          disabled={actionInFlight !== null}
                          onClick={() => void handleStatusAction("reject")}
                          type="button"
                        >
                          {actionInFlight === "reject"
                            ? tIntakeItems("statusActions.rejecting")
                            : tIntakeItems("statusActions.reject")}
                        </Button>
                      </>
                    )}
                  {canManageIntake && active.status === "ACCEPTED" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      data-testid="intake-convert-button"
                      onClick={openConvertDialog}
                      type="button"
                    >
                      <ArrowRight className="h-3 w-3" />
                      {t("detail.convert")}
                    </Button>
                  )}
                  {active.status === "CONVERTED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      data-testid="intake-view-converted-tasks-button"
                      disabled={viewTasksInFlight}
                      onClick={() => void handleViewConvertedTasks()}
                      type="button"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {t("detail.viewTasks")}
                    </Button>
                  )}
                </div>
              </div>

              {actionErrorKey && (
                <div className="border-b border-border bg-destructive/5 px-5 py-2 text-[12px] text-destructive">
                  {tRoot(actionErrorKey)}
                </div>
              )}

              <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                  <FieldRow
                    icon={Users}
                    label={t("detail.reporter")}
                    value={displayUserName(active.reporterId, getMember)}
                  />
                  <FieldRow
                    icon={Users}
                    label={t("detail.assignee")}
                    value={
                      active.assigneeId
                        ? displayUserName(active.assigneeId, getMember)
                        : t("detail.unassigned")
                    }
                  />
                  <FieldRow
                    icon={Clock}
                    label={t("detail.acceptedAt")}
                    value={active.acceptedAt ?? "—"}
                  />
                  <FieldRow
                    icon={GitBranch}
                    label={t("detail.version")}
                    value={
                      active.versionId
                        ? displayVersionName(active.versionId, getVersion)
                        : t("detail.noVersion")
                    }
                  />
                </div>
                <div className="mt-6">
                  <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t("detail.descriptionTitle")}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                    {active.description ?? t("detail.descriptionEmpty")}
                  </p>
                </div>
                <RelatedTasksSection
                  intakeItem={active}
                  organizationId={organizationId}
                  routerPush={(href) => router.push(href)}
                  spaceId={spaceId}
                  t={t}
                  tIntakeItems={tIntakeItems}
                  tRoot={tRoot}
                />
                <IntakeCommentsSection
                  canComment={canCreateOrCommentIntake}
                  getMember={getMember}
                  intakeItem={active}
                  organizationId={organizationId}
                  spaceId={spaceId}
                  onTimelineRefresh={() =>
                    setTimelineRefreshVersion((version) => version + 1)
                  }
                  t={t}
                  tIntakeItems={tIntakeItems}
                  tRoot={tRoot}
                />
                <IntakeTimelineSection
                  intakeItem={active}
                  organizationId={organizationId}
                  refreshVersion={timelineRefreshVersion}
                  spaceId={spaceId}
                  t={t}
                  tIntakeItems={tIntakeItems}
                  tRoot={tRoot}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {spaceId && canCreateOrCommentIntake && (
        <CreateIntakeDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          spaceId={spaceId}
          onCreated={() => {
            void loadItems(1, "replace");
          }}
        />
      )}

      {spaceId && canManageIntake && (
        <EditIntakeDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          spaceId={spaceId}
          intakeItem={active}
          onUpdated={handleUpdatedIntakeItem}
        />
      )}

      {spaceId && canManageIntake && (
        <ConvertIntakeDialog
          open={convertOpen}
          onOpenChange={(next) => {
            setConvertOpen(next);
            if (!next) {
              setConvertTarget(null);
            }
          }}
          organizationId={organizationId}
          spaceId={spaceId}
          intakeItem={convertTarget}
          onConverted={handleConvertedIntakeItem}
        />
      )}
    </div>
  );
}

function FilterField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function createIntakeListScopeKey({
  filter,
  listFilters,
  organizationId,
  spaceId,
}: {
  filter: FilterKey;
  listFilters: IntakeListFilterState;
  organizationId?: string;
  spaceId?: string;
}): string {
  return [
    organizationId ?? "",
    spaceId ?? "",
    filter,
    listFilters.assigneeId ?? "",
    listFilters.priority ?? "",
    listFilters.reporterId ?? "",
    listFilters.requirementId ?? "",
    listFilters.sourceType ?? "",
    listFilters.status ?? "",
    listFilters.versionId ?? "",
  ].join("\u001f");
}

function RelatedTasksSection({
  intakeItem,
  organizationId,
  routerPush,
  spaceId,
  t,
  tIntakeItems,
  tRoot,
}: {
  intakeItem: IntakeItem;
  organizationId?: string;
  routerPush: (href: string) => void;
  spaceId?: string;
  t: ReturnType<typeof useTranslations<"intake">>;
  tIntakeItems: ReturnType<typeof useTranslations<"intakeItems">>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const [tasks, setTasks] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const taskScopeKey = useMemo(
    () => `${organizationId ?? ""}:${spaceId ?? ""}:${intakeItem.id}`,
    [intakeItem.id, organizationId, spaceId],
  );
  const latestTaskScopeKeyRef = useRef(taskScopeKey);
  const taskRequestIdRef = useRef(0);
  latestTaskScopeKeyRef.current = taskScopeKey;

  const fetchTasks = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    const requestId = taskRequestIdRef.current + 1;
    taskRequestIdRef.current = requestId;
    const requestScopeKey = taskScopeKey;

    setLoading(true);
    setErrorKey(null);

    try {
      const result = await listWorkItems({
        intakeItemId: intakeItem.id,
        organizationId,
        page: 1,
        pageSize: 5,
        spaceId,
      });
      if (
        taskRequestIdRef.current !== requestId ||
        latestTaskScopeKeyRef.current !== requestScopeKey
      ) {
        return;
      }
      setTasks(result.items);
    } catch (error) {
      if (
        taskRequestIdRef.current === requestId &&
        latestTaskScopeKeyRef.current === requestScopeKey
      ) {
        setErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (
        taskRequestIdRef.current === requestId &&
        latestTaskScopeKeyRef.current === requestScopeKey
      ) {
        setLoading(false);
      }
    }
  }, [intakeItem.id, organizationId, spaceId, taskScopeKey]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const openList = () => {
    routerPush(buildWorkItemsHref({ intakeItemId: intakeItem.id }));
  };

  return (
    <section className="mt-6" data-testid="intake-related-tasks-section">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {tIntakeItems("relatedTasks.title")}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          data-testid="intake-related-tasks-open-list"
          onClick={openList}
        >
          <Link2 className="h-3 w-3" />
          {tIntakeItems("relatedTasks.openTaskList")}
        </Button>
      </div>
      {loading ? (
        <LoadingState className="h-28" label={tRoot("common.states.loading")} />
      ) : errorKey ? (
        <ErrorState
          className="h-28"
          message={tRoot(errorKey)}
          onRetry={() => {
            void fetchTasks();
          }}
          retryLabel={t("actions.retry")}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          className="h-32"
          icon={<Link2 className="h-4 w-4" />}
          title={tIntakeItems("relatedTasks.empty.title")}
          description={tIntakeItems("relatedTasks.empty.description")}
        />
      ) : (
        <ul
          className="divide-y divide-border rounded-md border border-border"
          data-testid="intake-related-tasks-list"
        >
          {tasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                data-testid="intake-related-task-item"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 cursor-pointer"
                onClick={() =>
                  routerPush(buildWorkItemsHref({ workItemId: task.id }))
                }
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {task.title}
                </span>
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                  {tIntakeItems("relatedTasks.meta", {
                    dueDate: task.dueDate ?? tIntakeItems("noDueDate"),
                    priority: tRoot(`workItems.priority.${task.priority}`),
                    status: tRoot(
                      `workItems.statusCategory.${task.statusCategory}`,
                    ),
                  })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IntakeCommentsSection({
  canComment,
  getMember,
  intakeItem,
  onTimelineRefresh,
  organizationId,
  spaceId,
  t,
  tIntakeItems,
  tRoot,
}: {
  canComment: boolean;
  getMember: (userId: string) => SpaceMemberWithUser | undefined;
  intakeItem: IntakeItem;
  onTimelineRefresh?: () => void;
  organizationId?: string;
  spaceId?: string;
  t: ReturnType<typeof useTranslations<"intake">>;
  tIntakeItems: ReturnType<typeof useTranslations<"intakeItems">>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErrorKey, setSubmitErrorKey] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setErrorKey(null);

    try {
      const result = await listComments({
        organizationId,
        spaceId,
        targetId: intakeItem.id,
        targetType: "INTAKE_ITEM",
      });
      setComments(result.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setLoading(false);
    }
  }, [intakeItem.id, organizationId, spaceId]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  const handleSubmit = async () => {
    const body = draft.trim();
    if (!body || !spaceId || !canComment) {
      return;
    }

    setSubmitting(true);
    setSubmitErrorKey(null);

    try {
      const created = await createComment({
        body,
        organizationId,
        spaceId,
        targetId: intakeItem.id,
        targetType: "INTAKE_ITEM",
      });
      setComments((current) => [...current, created]);
      setDraft("");
      onTimelineRefresh?.();
    } catch (error) {
      setSubmitErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-6" data-testid="intake-comments-section">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {tIntakeItems("comments.title")}
      </h3>
      <div className="mt-2 rounded-md border border-border">
        {loading ? (
          <LoadingState
            className="h-28"
            label={tRoot("common.states.loading")}
          />
        ) : errorKey ? (
          <ErrorState
            className="h-28"
            message={tRoot(errorKey)}
            onRetry={() => {
              void fetchComments();
            }}
            retryLabel={t("actions.retry")}
          />
        ) : comments.length === 0 ? (
          <EmptyState
            className="h-28"
            icon={<MessageSquare className="h-4 w-4" />}
            title={tIntakeItems("comments.empty.title")}
            description={tIntakeItems("comments.empty.description")}
          />
        ) : (
          <ul
            className="divide-y divide-border"
            data-testid="intake-comments-list"
          >
            {comments.map((comment) => {
              const member = getMember(comment.author.id);
              const name = member?.user.name ?? comment.author.name;
              const initial = initialOf(name);

              return (
                <li
                  key={comment.id}
                  data-testid="intake-comment-item"
                  className="flex gap-3 px-3 py-3"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback>{initial}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDateTime(comment.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      {comment.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {submitErrorKey && (
          <p className="border-t border-border bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {tRoot(submitErrorKey)}
          </p>
        )}
        {canComment ? (
          <div className="flex gap-2 border-t border-border p-3">
            <Input
              data-testid="intake-comment-input"
              value={draft}
              placeholder={tIntakeItems("comments.body")}
              disabled={submitting}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              data-testid="intake-comment-submit"
              disabled={submitting || draft.trim().length === 0}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {submitting
                ? tIntakeItems("comments.submitting")
                : tIntakeItems("comments.submit")}
            </Button>
          </div>
        ) : (
          <p
            data-testid="intake-comments-readonly"
            className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground"
          >
            {tRoot("intakeItems.permissions.commentReadonly")}
          </p>
        )}
      </div>
    </section>
  );
}

function IntakeTimelineSection({
  intakeItem,
  organizationId,
  refreshVersion,
  spaceId,
  t,
  tIntakeItems,
  tRoot,
}: {
  intakeItem: IntakeItem;
  organizationId?: string;
  refreshVersion: number;
  spaceId?: string;
  t: ReturnType<typeof useTranslations<"intake">>;
  tIntakeItems: ReturnType<typeof useTranslations<"intakeItems">>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setLoading(true);
    setErrorKey(null);

    try {
      const result = await listTimeline({
        organizationId,
        spaceId,
        targetId: intakeItem.id,
        targetType: "INTAKE_ITEM",
      });
      setEvents(result.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setLoading(false);
    }
  }, [intakeItem.id, organizationId, spaceId]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents, refreshVersion]);

  return (
    <section className="mt-6" data-testid="intake-timeline-section">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {tIntakeItems("timeline.title")}
      </h3>
      <div className="mt-2 rounded-md border border-border">
        {loading ? (
          <LoadingState
            className="h-28"
            label={tRoot("common.states.loading")}
          />
        ) : errorKey ? (
          <ErrorState
            className="h-28"
            message={tRoot(errorKey)}
            onRetry={() => {
              void fetchEvents();
            }}
            retryLabel={t("actions.retry")}
          />
        ) : events.length === 0 ? (
          <EmptyState
            className="h-28"
            icon={<Clock className="h-4 w-4" />}
            title={tIntakeItems("timeline.empty.title")}
            description={tIntakeItems("timeline.empty.description")}
          />
        ) : (
          <ul
            className="divide-y divide-border"
            data-testid="intake-timeline-list"
          >
            {events.map((event) => (
              <li
                key={event.id}
                data-testid="intake-timeline-item"
                className="flex gap-3 px-3 py-3"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback>{initialOf(event.actor.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-[13px]">
                  <div>
                    <span className="font-medium">{event.actor.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      {event.title}{" "}
                    </span>
                    {event.detail && (
                      <span className="font-mono text-[12px] text-foreground">
                        {event.detail}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FieldRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="ml-auto truncate font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

function displayUserName(
  userId: string,
  getMember: (userId: string) => SpaceMemberWithUser | undefined,
): string {
  const member = getMember(userId);
  return member?.user.name ?? member?.user.username ?? "—";
}

function displayVersionName(
  versionId: string,
  getVersion: (versionId: string) => Version | undefined,
): string {
  return getVersion(versionId)?.name ?? "—";
}

function formatDateTime(value: string): string {
  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("default", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  } catch {
    return value;
  }
}

function formatItemCode(id: string): string {
  return formatDisplayCode("INTAKE", id);
}

function initialOf(id: string): string {
  return id.trim().charAt(0).toUpperCase() || "?";
}

function canSubmitIntakeItem(
  item: IntakeItem,
  canManageIntake: boolean,
): boolean {
  return (
    canManageIntake &&
    (item.status === "PENDING" ||
      item.status === "DEFERRED" ||
      item.status === "ACCEPTED")
  );
}

function canCreateOrCommentIntakeItem(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return Boolean(role) && role !== "VIEWER" && status === "ACTIVE";
}

function canManageIntakeItem(
  role: string | undefined,
  status: string | undefined,
): boolean {
  return (role === "SPACE_ADMIN" || role === "PM") && status === "ACTIVE";
}

function normalizeSearchParam(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildWorkItemsHref(
  query: { intakeItemId: string } | { workItemId: string },
): string {
  const params = new URLSearchParams();

  if ("intakeItemId" in query) {
    params.set("intakeItemId", query.intakeItemId);
  } else {
    params.set("workItemId", query.workItemId);
  }

  return `/work-items?${params.toString()}`;
}
