"use client";

import type {
  DocumentStatus,
  Requirement,
  RequirementStatusCount,
  SpaceMemberWithUser,
  Version,
} from "@project-delivery/shared";
import {
  Archive,
  FileText,
  Filter,
  GitBranch,
  Link2,
  Plus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Link, usePathname, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { resolveRequirementDisplayCode } from "../../lib/display-code";
import { useListKeyboardNav } from "../../lib/hooks/use-list-keyboard-nav";
import { useTagFilterOptions } from "../../lib/hooks/use-tag-filter-options";
import { useTagFilterSelection } from "../../lib/hooks/use-tag-filter-selection";
import { useUrlTagFilter } from "../../lib/hooks/use-url-tag-filter";
import { canWriteRequirements } from "../../lib/permission-gates";
import {
  isRealtimeRefreshMode,
  resolveRefreshMode,
  shouldShowBlockingRefreshState,
  shouldSurfaceRefreshError,
  useRealtimeInvalidation,
  type RefreshModeOptions,
} from "../../lib/realtime";
import {
  createRequirementDraftLocalCacheKey,
  isRequirementDraftCacheNewerThanRequirement,
  readRequirementDraftLocalCache,
} from "../../lib/requirement-draft-local-cache";
import {
  createRequirementDraft,
  listRequirementAssignableMembers,
  listRequirementVersions,
  listRequirements,
} from "../../lib/requirement-service";
import { serializeTagFilterQuery } from "../../lib/tag-query";
import { cn } from "../../lib/utils";
import { TagFilter } from "../tag";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge, type BadgeProps } from "../ui/badge";
import { Button } from "../ui/button";
import { Tip } from "../ui/tooltip";
import { SelectMenu } from "../ui/select-menu";
import { FilterField } from "../v2/filter-controls";
import { ListItemMetaRow } from "../v2/list-item-meta-row";
import { PageHeader } from "../v2/page-header";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
} from "../v2/states";

type FilterKey = "active" | "DRAFT" | "ACTIVE" | "ARCHIVED" | "all";
type RequirementListDisplayItem = {
  requirement: Requirement;
  summary: string | undefined;
  title: string;
  usesLocalDraftCache: boolean;
};

const statusVariant: Record<Requirement["status"], BadgeProps["variant"]> = {
  DRAFT: "default",
  ACTIVE: "success",
  ARCHIVED: "default",
};
const LIST_PAGE_SIZE = 100;
const INITIAL_PAGE_INFO = { page: 1, pageSize: LIST_PAGE_SIZE, total: 0 };
const REQUIREMENTS_REALTIME_KEYS = [
  "requirement-list",
  "requirement-detail",
] as const;

export function RequirementsPage() {
  const t = useTranslations("requirements");
  const tTags = useTranslations("tags.field");
  const tNav = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    currentOrganization,
    currentSpace,
    session,
    status: sessionStatus,
  } = useSession();
  const spaceId = session?.defaultSpaceId;
  const organizationId =
    session?.defaultOrganizationId ?? currentOrganization?.id;
  const sessionSpace =
    currentSpace ?? session?.spaces?.find((space) => space.id === spaceId);
  const canCreateRequirement = canWriteRequirements(
    sessionSpace?.role,
    sessionSpace?.status,
  );
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );

  const [items, setItems] = useState<Requirement[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("active");
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [selectedOwnerId, setSelectedOwnerId] = useState("");
  const [pageInfo, setPageInfo] = useState(INITIAL_PAGE_INFO);
  const [statusCounts, setStatusCounts] = useState<RequirementStatusCount[]>(
    [],
  );
  const [isCreating, setIsCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [handledCreateLinkKey, setHandledCreateLinkKey] = useState<
    string | null
  >(null);
  const [createDenied, setCreateDenied] = useState(false);
  const requestedNew = normalizeSearchParam(searchParams.get("new"));
  const [tagFilter, setTagFilter] = useUrlTagFilter({
    fixedTagMatch: "ANY",
    pathname,
    router,
    searchParams,
  });
  const contextKey = useMemo(
    () => `${organizationId ?? ""}:${spaceId ?? ""}`,
    [organizationId, spaceId],
  );
  const previousContextKeyRef = useRef(contextKey);
  const isContextChanging = previousContextKeyRef.current !== contextKey;
  const effectiveSelectedVersionId = isContextChanging ? "" : selectedVersionId;
  const effectiveSelectedOwnerId = isContextChanging ? "" : selectedOwnerId;
  const listScopeKey = useMemo(
    () =>
      createRequirementListScopeKey({
        filter,
        organizationId,
        ownerId: effectiveSelectedOwnerId,
        spaceId,
        tagIds: tagFilter.tagIds,
        tagMatch: tagFilter.tagMatch,
        versionId: effectiveSelectedVersionId,
      }),
    [
      effectiveSelectedOwnerId,
      effectiveSelectedVersionId,
      filter,
      organizationId,
      spaceId,
      tagFilter,
    ],
  );
  const latestListScopeKeyRef = useRef(listScopeKey);
  const listRequestIdRef = useRef(0);
  const pageInfoRef = useRef(pageInfo);
  const latestFilterOptionsScopeKeyRef = useRef(contextKey);
  const filterOptionsRequestIdRef = useRef(0);
  latestListScopeKeyRef.current = listScopeKey;
  pageInfoRef.current = pageInfo;
  latestFilterOptionsScopeKeyRef.current = contextKey;
  const loadedCount = items.length;
  const paginationFrom = loadedCount > 0 ? 1 : 0;
  const paginationTo = Math.min(loadedCount, pageInfo.total);
  const hasMoreItems = loadedCount < pageInfo.total;
  const { items: tagFilterOptions } = useTagFilterOptions({
    organizationId,
    scope: "REQUIREMENT",
    spaceId,
  });
  const { selectedTags: selectedFilterTags, setSelectedTags } =
    useTagFilterSelection({
      organizationId,
      sourceTags: tagFilterOptions,
      spaceId,
      tagIds: tagFilter.tagIds,
    });

  const loadItems = useCallback(
    async (
      page = 1,
      mode: "replace" | "append" = "replace",
      options?: RefreshModeOptions,
    ) => {
      const refreshMode = resolveRefreshMode(options);
      if (!spaceId) {
        return;
      }

      const requestId = listRequestIdRef.current + 1;
      listRequestIdRef.current = requestId;
      const requestScopeKey = listScopeKey;
      const append = mode === "append";
      const realtimeRefresh = isRealtimeRefreshMode(refreshMode);
      const pageSize =
        !append && realtimeRefresh
          ? Math.max(LIST_PAGE_SIZE, pageInfoRef.current.page * LIST_PAGE_SIZE)
          : LIST_PAGE_SIZE;

      if (append) {
        setIsLoadingMore(true);
      } else if (shouldShowBlockingRefreshState(refreshMode)) {
        setIsLoading(true);
      }
      if (shouldSurfaceRefreshError(refreshMode)) {
        setErrorKey(null);
      }

      try {
        const result = await listRequirements({
          organizationId,
          spaceId,
          page,
          pageSize,
          ...serializeTagFilterQuery(tagFilter),
          ...toRequirementListQuery(filter),
          ownerId: optionalFilterValue(effectiveSelectedOwnerId),
          versionId: optionalFilterValue(effectiveSelectedVersionId),
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
          page: realtimeRefresh
            ? pageInfoRef.current.page
            : (result.page ?? page),
          pageSize: result.pageSize ?? pageSize,
          total: result.total ?? result.items.length,
        });
        setStatusCounts(result.statusCounts ?? []);
      } catch (error) {
        if (
          listRequestIdRef.current === requestId &&
          latestListScopeKeyRef.current === requestScopeKey
        ) {
          if (shouldSurfaceRefreshError(refreshMode)) {
            setErrorKey(getApiErrorMessageKey(error));
          }
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
        }
      }
    },
    [
      effectiveSelectedOwnerId,
      effectiveSelectedVersionId,
      filter,
      listScopeKey,
      organizationId,
      spaceId,
      tagFilter,
    ],
  );

  const loadFilterOptions = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    const requestId = filterOptionsRequestIdRef.current + 1;
    filterOptionsRequestIdRef.current = requestId;
    const requestScopeKey = contextKey;

    try {
      const [versionPage, memberPage] = await Promise.all([
        listRequirementVersions({ organizationId, spaceId }),
        listRequirementAssignableMembers({ organizationId, spaceId }),
      ]);
      if (
        filterOptionsRequestIdRef.current !== requestId ||
        latestFilterOptionsScopeKeyRef.current !== requestScopeKey
      ) {
        return;
      }
      setVersions(versionPage.items);
      setMembers(memberPage.items);
    } catch (error) {
      if (
        filterOptionsRequestIdRef.current === requestId &&
        latestFilterOptionsScopeKeyRef.current === requestScopeKey
      ) {
        setErrorKey(getApiErrorMessageKey(error));
      }
    }
  }, [contextKey, organizationId, spaceId]);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !spaceId) {
      if (sessionStatus !== "loading") {
        listRequestIdRef.current += 1;
        setItems([]);
        setPageInfo(INITIAL_PAGE_INFO);
        setStatusCounts([]);
        setIsLoading(false);
        setIsLoadingMore(false);
      }
      return;
    }
    void loadItems(1, "replace", { mode: "initial" });
  }, [loadItems, sessionStatus, spaceId]);

  useRealtimeInvalidation(REQUIREMENTS_REALTIME_KEYS, () => {
    void loadItems(1, "replace", { mode: "realtime" });
  });

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !spaceId) {
      return;
    }
    void loadFilterOptions();
  }, [loadFilterOptions, sessionStatus, spaceId]);

  useEffect(() => {
    if (previousContextKeyRef.current === contextKey) {
      return;
    }
    previousContextKeyRef.current = contextKey;
    setActiveId(undefined);
    setIsFilterPanelOpen(false);
    setCreateDenied(false);
    setVersions([]);
    setMembers([]);
    setSelectedVersionId("");
    setSelectedOwnerId("");
    setHandledCreateLinkKey(null);
  }, [contextKey]);

  useEffect(() => {
    setSelectedVersionId((current) => {
      if (!current || versions.some((version) => version.id === current)) {
        return current;
      }
      return "";
    });
  }, [versions]);

  useEffect(() => {
    setSelectedOwnerId((current) => {
      if (!current || members.some((member) => member.userId === current)) {
        return current;
      }
      return "";
    });
  }, [members]);

  const filtered = useMemo(() => {
    if (filter === "active") {
      return items.filter(
        (r) => r.status !== "ARCHIVED" && r.status !== "DRAFT",
      );
    }
    return items;
  }, [filter, items]);
  const versionNameById = useMemo(
    () => new Map(versions.map((version) => [version.id, version.name])),
    [versions],
  );
  const memberNameByUserId = useMemo(
    () =>
      new Map(members.map((member) => [member.userId, formatMember(member)])),
    [members],
  );
  const displayItems = useMemo(
    () =>
      filtered.map((requirement) =>
        createRequirementListDisplayItem({
          requirement,
          t,
          userId: session?.user.id,
        }),
      ),
    [filtered, session?.user.id, t],
  );

  const buckets: { count: number; label: string; key: FilterKey }[] = [
    {
      count: getActiveRequirementCount(statusCounts, items.length),
      label: t("filters.active"),
      key: "active",
    },
    {
      count: getRequirementStatusCount(statusCounts, "DRAFT"),
      label: t("filters.draft"),
      key: "DRAFT",
    },
    {
      count: getRequirementStatusCount(statusCounts, "ACTIVE"),
      label: t("filters.confirmed"),
      key: "ACTIVE",
    },
    {
      count: getRequirementStatusCount(statusCounts, "ARCHIVED"),
      label: t("filters.archived"),
      key: "ARCHIVED",
    },
    {
      count: getAllRequirementStatusCount(statusCounts, items.length),
      label: t("filters.all"),
      key: "all",
    },
  ];

  const rememberRequirement = useCallback(
    (item: Requirement, titleOverride?: string) => {
      recordRecentOpen(
        {
          id: item.id,
          type: "REQUIREMENT",
          displayCode: formatRequirementCode(item, t("status.DRAFT")),
          title:
            titleOverride ??
            normalizeDisplayText(item.title) ??
            getRequirementFallbackTitle(item, t),
          href: `/requirements/${item.id}`,
          organizationId: item.organizationId,
          spaceId: item.spaceId,
        },
        recentScope,
      );
    },
    [recentScope, t],
  );

  const openRequirement = useCallback(
    (item: RequirementListDisplayItem) => {
      rememberRequirement(item.requirement, item.title);
      router.push(`/requirements/${item.requirement.id}`);
    },
    [rememberRequirement, router],
  );

  const focusRequirementOption = useCallback((id: string) => {
    const schedule =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame
        : (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 0);

    schedule(() => {
      document
        .querySelector<HTMLElement>(
          `[data-requirement-option-id="${toAttributeSelectorValue(id)}"]`,
        )
        ?.focus({ preventScroll: true });
    });
  }, []);

  const selectRequirement = useCallback(
    (item: RequirementListDisplayItem) => {
      setActiveId(item.requirement.id);
      focusRequirementOption(item.requirement.id);
    },
    [focusRequirementOption],
  );

  useListKeyboardNav<RequirementListDisplayItem>({
    items: displayItems,
    activeId,
    getId: (item) => item.requirement.id,
    onSelect: selectRequirement,
    onOpen: openRequirement,
    onEdit: openRequirement,
  });

  const handleCreateDraft = useCallback(
    async () => {
      if (!spaceId || isCreating) {
        return;
      }
      if (!canCreateRequirement) {
        setCreateDenied(true);
        return;
      }
      setIsCreating(true);
      setErrorKey(null);
      setCreateDenied(false);

      try {
        const draft = await createRequirementDraft({ organizationId, spaceId });
        rememberRequirement(draft);
        router.push(`/requirements/${draft.id}`);
      } catch (error) {
        setErrorKey(getApiErrorMessageKey(error));
        setIsCreating(false);
      }
    },
    [
      canCreateRequirement,
      isCreating,
      organizationId,
      rememberRequirement,
      router,
      spaceId,
    ],
  );

  const clearCreateLinkQuery = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;

    router.replace(target as never, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (
      requestedNew !== "requirement" ||
      sessionStatus !== "authenticated" ||
      !spaceId
    ) {
      return;
    }

    const key = `requirement:${spaceId}`;
    if (handledCreateLinkKey === key || isCreating) {
      return;
    }

    setHandledCreateLinkKey(key);
    clearCreateLinkQuery();
    if (!canCreateRequirement) {
      setCreateDenied(true);
      return;
    }
    void handleCreateDraft();
  }, [
    canCreateRequirement,
    clearCreateLinkQuery,
    handledCreateLinkKey,
    handleCreateDraft,
    isCreating,
    requestedNew,
    sessionStatus,
    spaceId,
  ]);

  const headerActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        type="button"
        onClick={() => setIsFilterPanelOpen((current) => !current)}
        aria-pressed={isFilterPanelOpen}
      >
        <Filter className="h-3 w-3" />
        {t("page.filter")}
      </Button>
      <Button
        variant={filter === "DRAFT" ? "secondary" : "outline"}
        size="sm"
        className="text-xs"
        type="button"
        onClick={() => setFilter("DRAFT")}
      >
        <FileText className="h-3 w-3" />
        {t("actions.myDrafts")}
      </Button>
      <Button
        size="sm"
        className="text-xs"
        data-testid="requirements-create-button"
        onClick={() => {
          void handleCreateDraft();
        }}
        type="button"
        disabled={!spaceId || isCreating || !canCreateRequirement}
        aria-disabled={!spaceId || isCreating || !canCreateRequirement}
        title={!canCreateRequirement ? t("page.createReadonly") : undefined}
      >
        <Plus className="h-3 w-3" />
        {isCreating ? t("dialog.create.submitting") : t("page.create")}
      </Button>
    </>
  );
  const paginationFooter =
    pageInfo.total > 0 ? (
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-6">
        <span data-testid="requirements-pagination-summary">
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
            data-testid="requirements-load-more"
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
    body = <LoadingState label={t("states.loadingShort")} />;
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
        title={t("states.errorTitle")}
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
          data-testid="requirements-list"
          className="divide-y divide-border"
          role="listbox"
          aria-label={t("list.title")}
        >
          {displayItems.map((item) => {
            const req = item.requirement;
            const tags = req.tags ?? [];
            const ownerName = req.ownerId
              ? formatOwnerLabel(req.ownerId, memberNameByUserId)
              : "";
            const ownerTip =
              ownerName && ownerName !== "—" ? ownerName : undefined;
            const authorName = req.authorId
              ? formatOwnerLabel(req.authorId, memberNameByUserId)
              : "";
            const versionName = req.versionId
              ? formatVersionLabel(req.versionId, versionNameById)
              : "";
            const versionTip =
              versionName && versionName !== "—"
                ? `${t("list.columns.version")}: ${versionName}`
                : undefined;
            const relatedWorkItemCount =
              req.relatedWorkItems.taskCount + req.relatedWorkItems.bugCount;
            const relatedTip =
              relatedWorkItemCount > 0
                ? `${t("list.columns.related")}: ${t("list.relatedCounts", {
                    bugs: req.relatedWorkItems.bugCount,
                    tasks: req.relatedWorkItems.taskCount,
                  })}`
                : undefined;

            return (
              <li
                key={req.id}
                data-testid={`requirements-row-${req.id}`}
                role="none"
              >
                <Link
                  href={`/requirements/${req.id}`}
                  onClick={() => rememberRequirement(req, item.title)}
                  onFocus={() => setActiveId(req.id)}
                  role="option"
                  aria-selected={activeId === req.id}
                  tabIndex={!activeId || activeId === req.id ? 0 : -1}
                  data-requirement-option-id={req.id}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    activeId === req.id && "bg-muted/40",
                  )}
                >
                  {req.status === "ARCHIVED" ? (
                    <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/80" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {formatRequirementCode(req, t("status.DRAFT"))}
                      </span>
                      <span className="truncate text-[13px] font-medium">
                        {item.title}
                      </span>
                      {item.usesLocalDraftCache ? (
                        <Badge
                          variant="info"
                          className="shrink-0 px-1 py-0 text-[10px] font-normal tracking-normal"
                        >
                          {t("list.localDraftCache")}
                        </Badge>
                      ) : null}
                    </div>
                    <ListItemMetaRow
                      className="mt-1"
                      createdAt={req.createdAt}
                      creatorName={
                        authorName && authorName !== "—"
                          ? authorName
                          : undefined
                      }
                      tags={tags}
                    />
                    {item.summary ? (
                      <p className="mt-1 line-clamp-1 text-[12px] text-muted-foreground">
                        {item.summary}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant={statusVariant[req.status]}>
                    {t(`status.${req.status}`)}
                  </Badge>
                  {req.versionId ? (
                    <Tip content={versionTip}>
                      <Badge
                        variant="outline"
                        className="hidden gap-1 md:inline-flex"
                      >
                        <GitBranch aria-hidden="true" className="h-2.5 w-2.5" />
                        {versionName}
                      </Badge>
                    </Tip>
                  ) : null}
                  {relatedWorkItemCount > 0 ? (
                    <Tip content={relatedTip}>
                      <Badge
                        variant="outline"
                        className="hidden gap-1 md:inline-flex"
                      >
                        <Link2 aria-hidden="true" className="h-2.5 w-2.5" />
                        {relatedWorkItemCount}
                      </Badge>
                    </Tip>
                  ) : null}
                  <Tip content={ownerTip}>
                    <Avatar className="h-5 w-5 shrink-0">
                      <AvatarFallback className="text-[9px]">
                        {ownerName ? initialOf(ownerName) : "·"}
                      </AvatarFallback>
                    </Avatar>
                  </Tip>
                </Link>
              </li>
            );
          })}
        </ul>
        {paginationFooter}
      </>
    );
  }

  return (
    <div
      data-testid="requirements-page"
      className="flex h-full min-w-0 flex-col"
    >
      <PageHeader
        eyebrow={tNav("group.document")}
        title={tNav("requirements")}
        description={t("page.description")}
        actions={headerActions}
      />

      {sessionStatus === "authenticated" && spaceId && createDenied ? (
        <div
          role="alert"
          data-testid="requirements-create-readonly-notice"
          className="border-b border-warning/30 bg-warning/10 px-6 py-2 text-xs text-warning"
        >
          {t("page.createReadonly")}
        </div>
      ) : null}

      {sessionStatus === "authenticated" && spaceId && !errorKey && (
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex min-w-max items-center gap-1">
              {buckets.map((b) => (
                <button
                  key={b.key}
                  type="button"
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

          {isFilterPanelOpen ? (
            <div
              aria-label={t("filters.label")}
              className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
            >
              <FilterField label={t("filters.version")}>
                <SelectMenu
                  aria-label={t("filters.version")}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  data-testid="requirements-filter-version"
                  onChange={(event) => setSelectedVersionId(event.target.value)}
                  value={effectiveSelectedVersionId}
                >
                  <option value="">{t("filters.allVersions")}</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.name}
                    </option>
                  ))}
                </SelectMenu>
              </FilterField>
              <FilterField label={t("filters.owner")}>
                <SelectMenu
                  aria-label={t("filters.owner")}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  data-testid="requirements-filter-owner"
                  onChange={(event) => setSelectedOwnerId(event.target.value)}
                  value={effectiveSelectedOwnerId}
                >
                  <option value="">{t("filters.allOwners")}</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {formatMember(member)}
                    </option>
                  ))}
                </SelectMenu>
              </FilterField>
              <FilterField label={tTags("label")} width="tag">
                <TagFilter
                  availableTags={tagFilterOptions}
                  onChange={(value, selectedTags) => {
                    setSelectedTags(selectedTags);
                    setTagFilter(value);
                  }}
                  selectedTags={selectedFilterTags}
                  showMatchMode={false}
                  value={tagFilter}
                  data-testid="requirements-filter-tags"
                />
              </FilterField>
            </div>
          ) : null}
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}

function formatRequirementCode(
  requirement: Requirement,
  draftLabel: string,
): string {
  return resolveRequirementDisplayCode(requirement, { draftLabel });
}

function createRequirementListDisplayItem({
  requirement,
  t,
  userId,
}: {
  requirement: Requirement;
  t: ReturnType<typeof useTranslations>;
  userId: string | undefined;
}): RequirementListDisplayItem {
  const fallbackTitle = getRequirementFallbackTitle(requirement, t);

  if (!userId || requirement.status !== "DRAFT") {
    return {
      requirement,
      summary: normalizeDisplayText(requirement.summary),
      title: normalizeDisplayText(requirement.title) ?? fallbackTitle,
      usesLocalDraftCache: false,
    };
  }

  const cached = readRequirementDraftLocalCache(
    createRequirementDraftLocalCacheKey({
      organizationId: requirement.organizationId,
      requirementId: requirement.id,
      spaceId: requirement.spaceId,
      userId,
    }),
  );

  if (
    !cached ||
    !isRequirementDraftCacheNewerThanRequirement(cached, requirement)
  ) {
    return {
      requirement,
      summary: normalizeDisplayText(requirement.summary),
      title: normalizeDisplayText(requirement.title) ?? fallbackTitle,
      usesLocalDraftCache: false,
    };
  }

  return {
    requirement,
    summary:
      normalizeDisplayText(cached.form.summary) ??
      normalizeDisplayText(requirement.summary),
    title:
      normalizeDisplayText(cached.form.title) ??
      normalizeDisplayText(requirement.title) ??
      fallbackTitle,
    usesLocalDraftCache: true,
  };
}

function getRequirementFallbackTitle(
  requirement: Requirement,
  t: ReturnType<typeof useTranslations>,
): string {
  return requirement.status === "DRAFT"
    ? t("list.untitledDraft")
    : t("list.untitled");
}

function normalizeDisplayText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function toRequirementListQuery(filter: FilterKey): {
  includeDrafts?: boolean;
  status?: DocumentStatus;
} {
  if (filter === "DRAFT") {
    return {
      includeDrafts: true,
      status: "DRAFT",
    };
  }

  if (filter === "ACTIVE" || filter === "ARCHIVED") {
    return {
      status: filter,
    };
  }

  if (filter === "all") {
    return {
      includeDrafts: true,
    };
  }

  return {
    status: "ACTIVE",
  };
}

function optionalFilterValue(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

function getRequirementStatusCount(
  counts: RequirementStatusCount[],
  status: DocumentStatus,
): number {
  return counts.find((entry) => entry.status === status)?.count ?? 0;
}

function getActiveRequirementCount(
  counts: RequirementStatusCount[],
  fallback: number,
): number {
  if (counts.length === 0) {
    return fallback;
  }

  return getRequirementStatusCount(counts, "ACTIVE");
}

function getAllRequirementStatusCount(
  counts: RequirementStatusCount[],
  fallback: number,
): number {
  if (counts.length === 0) {
    return fallback;
  }

  return counts.reduce((sum, entry) => sum + entry.count, 0);
}

function createRequirementListScopeKey({
  filter,
  organizationId,
  ownerId,
  spaceId,
  tagIds,
  tagMatch,
  versionId,
}: {
  filter: FilterKey;
  organizationId?: string;
  ownerId: string;
  spaceId?: string;
  tagIds: readonly string[];
  tagMatch: string;
  versionId: string;
}): string {
  return [
    organizationId ?? "",
    spaceId ?? "",
    filter,
    optionalFilterValue(ownerId) ?? "",
    optionalFilterValue(versionId) ?? "",
    tagIds.join(","),
    tagIds.length > 0 ? tagMatch : "",
  ].join("\u001f");
}

function normalizeSearchParam(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function toAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatMember(member: SpaceMemberWithUser): string {
  return `${member.user.name} (${member.user.username})`;
}

function formatVersionLabel(
  versionId: string,
  versionNameById: Map<string, string>,
): string {
  return versionNameById.get(versionId) ?? "—";
}

function formatOwnerLabel(
  ownerId: string,
  memberNameByUserId: Map<string, string>,
): string {
  return memberNameByUserId.get(ownerId) ?? "—";
}

function initialOf(value: string): string {
  return value.trim().charAt(0).toUpperCase();
}
