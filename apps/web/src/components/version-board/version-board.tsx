"use client";

import type {
  GetVersionBoardViewResponse,
  PageResult,
  RecordStatus,
  Requirement,
  SpaceRole,
  StatusCategory,
  TimelineEvent,
  Version,
  VersionStatus,
  ViewWorkItemSummary,
  WorkItemType,
} from "@project-delivery/shared";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  Clock,
  Filter,
  Pencil,
  Plus,
  Users,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { ApiClientError } from "../../lib/api-client";
import { Link, usePathname, useRouter } from "../../i18n/routing";
import {
  createWorkItemViewModelMapper,
  type WorkItemViewModel,
} from "../../lib/v2/work-item-view-model";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";
import { listRequirements } from "../../lib/requirement-service";
import { listTimeline } from "../../lib/timeline-service";
import { listVersions } from "../../lib/version-service";
import { getVersionBoardView } from "../../lib/view-service";
import { useFocusReturn } from "../../lib/hooks/use-list-keyboard-nav";
import { useSpaceMembers } from "../../lib/v2/lookups";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SelectMenu } from "../ui/select-menu";
import { Tip } from "../ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { CreateTaskDialog } from "../work-item/create-task-dialog";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";
import { PageHeader } from "../v2/page-header";

import { CreateVersionDialog } from "./create-version-dialog";
import { EditVersionDialog } from "./edit-version-dialog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMN_ORDER: StatusCategory[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
];

const COLUMN_DOT: Record<StatusCategory, string> = {
  NOT_STARTED: "bg-muted-foreground/40",
  IN_PROGRESS: "bg-primary",
  WAITING: "bg-warning",
  VERIFYING: "bg-info",
  DONE: "bg-success",
  TERMINATED: "bg-muted-foreground/60",
};

const priorityDotColor: Record<WorkItemViewModel["priority"], string> = {
  LOW: "bg-muted-foreground/40",
  MEDIUM: "bg-info",
  HIGH: "bg-warning",
  URGENT: "bg-destructive",
};

const REQUIREMENT_STATUS_VARIANT: Record<
  Requirement["status"],
  "default" | "info" | "success"
> = {
  DRAFT: "default",
  CONFIRMED: "success",
  ARCHIVED: "info",
};

const VERSION_STATUS_VARIANT: Record<
  VersionStatus,
  "info" | "primary" | "success" | "default"
> = {
  PLANNED: "info",
  IN_PROGRESS: "primary",
  RELEASED: "success",
  ARCHIVED: "default",
};

const BOARD_COLUMN_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Filter state shape — keep all three filters together so the toolbar wiring
// stays in one spot and the query builder is trivial.
// ---------------------------------------------------------------------------

type BoardFilters = {
  assigneeId: string | null; // null = all
  statusCategory: StatusCategory | null;
  workItemType: WorkItemType | null;
};

const EMPTY_FILTERS: BoardFilters = {
  assigneeId: null,
  statusCategory: null,
  workItemType: null,
};

// ---------------------------------------------------------------------------
// Date formatting — kept inline because the version page is the only consumer.
// ---------------------------------------------------------------------------

function formatDateTime(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  } catch {
    return value;
  }
}

function formatDateOnly(value: string | undefined, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date,
    );
  } catch {
    return "—";
  }
}

function initialOf(value: string): string {
  return value.trim().slice(0, 1).toUpperCase() || "?";
}

function normalizeSearchParam(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function emptyBoardColumnPage(
  pageSize: number,
): PageResult<ViewWorkItemSummary> {
  return {
    items: [],
    page: 1,
    pageSize,
    total: 0,
  };
}

function mergeBoardColumnPage(
  current: GetVersionBoardViewResponse,
  next: GetVersionBoardViewResponse,
  category: StatusCategory,
): GetVersionBoardViewResponse {
  const nextColumns = new Map(
    next.columns.map((column) => [column.statusCategory, column]),
  );

  return {
    ...current,
    columns: current.columns.map((column) => {
      const nextColumn = nextColumns.get(column.statusCategory);

      if (!nextColumn) {
        return column;
      }

      if (column.statusCategory !== category) {
        return {
          ...column,
          title: nextColumn.title,
          total: nextColumn.total,
        };
      }

      return {
        ...nextColumn,
        items: {
          ...nextColumn.items,
          items: [...column.items.items, ...nextColumn.items.items],
        },
      };
    }),
  };
}

function canManageVersionEntries(
  role: SpaceRole | undefined,
  status: RecordStatus | undefined,
): boolean {
  return status !== "DISABLED" && (role === "SPACE_ADMIN" || role === "PM");
}

function canCreateVersionWorkItems(
  role: SpaceRole | undefined,
  status: RecordStatus | undefined,
): boolean {
  return status !== "DISABLED" && (role === "SPACE_ADMIN" || role === "PM");
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function VersionPage() {
  const t = useTranslations("versionBoard");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const tRequirementStatus = useTranslations("requirements.status");
  const tTimelineEvent = useTranslations("versionBoard.timeline.event");
  const tVersionStatus = useTranslations("versionBoard.status");
  const tHero = useTranslations("versionBoard.hero");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { session, currentSpace } = useSession();
  const organizationId = session?.defaultOrganizationId;
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;
  const versionContextKey = `${organizationId ?? ""}:${spaceId ?? ""}`;
  const canManageVersions = canManageVersionEntries(
    currentSpace?.role,
    currentSpace?.status,
  );
  const canCreateWorkItem = canCreateVersionWorkItems(
    currentSpace?.role,
    currentSpace?.status,
  );
  const versionIdParam = normalizeSearchParam(searchParams.get("versionId"));

  const { members, getMember } = useSpaceMembers(spaceId, organizationId);

  // ----- versions -----
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // ----- board -----
  const [board, setBoard] = useState<GetVersionBoardViewResponse | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
  const [loadingColumnCategory, setLoadingColumnCategory] =
    useState<StatusCategory | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);

  // ----- requirements tab -----
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [isLoadingRequirements, setIsLoadingRequirements] = useState(false);
  const [requirementsErrorKey, setRequirementsErrorKey] = useState<
    string | null
  >(null);

  // ----- timeline tab -----
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [timelineErrorKey, setTimelineErrorKey] = useState<string | null>(null);
  const versionsRequestSeq = useRef(0);
  const boardRequestSeq = useRef(0);
  const requirementsRequestSeq = useRef(0);
  const timelineRequestSeq = useRef(0);

  // ----- tab + dialog state -----
  const [activeTab, setActiveTab] = useState<
    "board" | "requirements" | "timeline"
  >("board");
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [activeItemContext, setActiveItemContext] = useState<{
    contextKey: string;
    organizationId?: string;
    spaceId?: string;
  } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createWorkItemDialogOpen, setCreateWorkItemDialogOpen] =
    useState(false);
  const [createVersionDialogOpen, setCreateVersionDialogOpen] = useState(false);
  const [editVersionDialogOpen, setEditVersionDialogOpen] = useState(false);
  const { captureFocus, restoreFocus } = useFocusReturn();

  useEffect(() => {
    versionsRequestSeq.current += 1;
    boardRequestSeq.current += 1;
    requirementsRequestSeq.current += 1;
    timelineRequestSeq.current += 1;
    setVersions([]);
    setVersionId(null);
    setBoard(null);
    setLoadingColumnCategory(null);
    setRequirements([]);
    setTimeline([]);
    setErrorKey(null);
    setRequirementsErrorKey(null);
    setTimelineErrorKey(null);
    setActiveItem(null);
    setActiveItemContext(null);
    setSheetOpen(false);
    setCreateWorkItemDialogOpen(false);
    setCreateVersionDialogOpen(false);
    setEditVersionDialogOpen(false);
  }, [organizationId, spaceId]);

  // -------------------------------------------------------------------------
  // Data loaders
  // -------------------------------------------------------------------------

  const replaceVersionParam = useCallback(
    (nextVersionId: string | undefined) => {
      const next = new URLSearchParams(searchParams.toString());
      if (nextVersionId) {
        next.set("versionId", nextVersionId);
      } else {
        next.delete("versionId");
      }
      const query = next.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      router.replace(target as never, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const selectVersion = useCallback(
    (nextVersionId: string, syncUrl = true) => {
      setVersionId(nextVersionId);
      if (syncUrl) {
        replaceVersionParam(nextVersionId);
      }
    },
    [replaceVersionParam],
  );

  const fetchVersions = useCallback(async () => {
    if (!spaceId) {
      versionsRequestSeq.current += 1;
      setVersions([]);
      setVersionId(null);
      setIsLoadingVersions(false);
      return;
    }
    const requestId = versionsRequestSeq.current + 1;
    versionsRequestSeq.current = requestId;
    setIsLoadingVersions(true);
    setErrorKey(null);
    try {
      const page = await listVersions({
        spaceId,
        organizationId,
        page: 1,
        pageSize: 100,
      });
      if (versionsRequestSeq.current !== requestId) return;
      setVersions(page.items);
      if (
        versionIdParam &&
        !page.items.some((version) => version.id === versionIdParam)
      ) {
        replaceVersionParam(page.items[0]?.id);
      }
      setVersionId((current) => {
        if (versionIdParam && page.items.some((v) => v.id === versionIdParam)) {
          return versionIdParam;
        }
        if (current && page.items.some((v) => v.id === current)) return current;
        return page.items[0]?.id ?? null;
      });
    } catch (error) {
      if (versionsRequestSeq.current !== requestId) return;
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (versionsRequestSeq.current === requestId) {
        setIsLoadingVersions(false);
      }
    }
  }, [organizationId, replaceVersionParam, spaceId, versionIdParam]);

  useEffect(() => {
    void fetchVersions();
  }, [fetchVersions]);

  useEffect(() => {
    if (!versionIdParam) {
      return;
    }

    if (versions.some((version) => version.id === versionIdParam)) {
      setVersionId(versionIdParam);
    }
  }, [versionIdParam, versions]);

  const fetchBoard = useCallback(async () => {
    if (!versionId) {
      boardRequestSeq.current += 1;
      setBoard(null);
      setIsLoadingBoard(false);
      return;
    }
    const requestId = boardRequestSeq.current + 1;
    boardRequestSeq.current = requestId;
    setBoard(null);
    setIsLoadingBoard(true);
    setErrorKey(null);
    try {
      const next = await getVersionBoardView({
        versionId,
        organizationId,
        spaceId: spaceId ?? undefined,
        page: 1,
        pageSize: BOARD_COLUMN_PAGE_SIZE,
        assigneeId: filters.assigneeId ?? undefined,
        statusCategory: filters.statusCategory ?? undefined,
        workItemType: filters.workItemType ?? undefined,
      });
      if (boardRequestSeq.current !== requestId) return;
      setBoard(next);
    } catch (error) {
      if (boardRequestSeq.current !== requestId) return;
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (boardRequestSeq.current === requestId) {
        setIsLoadingBoard(false);
      }
    }
  }, [
    filters.assigneeId,
    filters.statusCategory,
    filters.workItemType,
    organizationId,
    spaceId,
    versionId,
  ]);

  useEffect(() => {
    if (versionId) void fetchBoard();
  }, [fetchBoard, versionId]);

  const fetchRequirements = useCallback(async () => {
    if (!versionId || !spaceId) {
      requirementsRequestSeq.current += 1;
      setRequirements([]);
      setIsLoadingRequirements(false);
      return;
    }
    const requestId = requirementsRequestSeq.current + 1;
    requirementsRequestSeq.current = requestId;
    setRequirements([]);
    setIsLoadingRequirements(true);
    setRequirementsErrorKey(null);
    try {
      const page = await listRequirements({
        spaceId,
        organizationId,
        versionId,
        page: 1,
        pageSize: 100,
      });
      if (requirementsRequestSeq.current !== requestId) return;
      setRequirements(page.items);
    } catch (error) {
      if (requirementsRequestSeq.current !== requestId) return;
      setRequirementsErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (requirementsRequestSeq.current === requestId) {
        setIsLoadingRequirements(false);
      }
    }
  }, [organizationId, spaceId, versionId]);

  const fetchTimeline = useCallback(async () => {
    if (!versionId || !spaceId) {
      timelineRequestSeq.current += 1;
      setTimeline([]);
      setIsLoadingTimeline(false);
      return;
    }
    const requestId = timelineRequestSeq.current + 1;
    timelineRequestSeq.current = requestId;
    setTimeline([]);
    setIsLoadingTimeline(true);
    setTimelineErrorKey(null);
    try {
      const page = await listTimeline({
        spaceId,
        organizationId,
        targetType: "VERSION",
        targetId: versionId,
        page: 1,
        pageSize: 50,
      });
      if (timelineRequestSeq.current !== requestId) return;
      setTimeline(page.items);
    } catch (error) {
      if (timelineRequestSeq.current !== requestId) return;
      // Per spec: if the backend reports the version timeline as unavailable
      // (e.g. 404 / NOT_FOUND / NOT_IMPLEMENTED) we fall back to the empty
      // state rather than a hard error, so the page stays usable.
      if (error instanceof ApiClientError && error.status === 404) {
        setTimeline([]);
        setTimelineErrorKey(null);
      } else {
        setTimelineErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (timelineRequestSeq.current === requestId) {
        setIsLoadingTimeline(false);
      }
    }
  }, [organizationId, spaceId, versionId]);

  // Trigger requirement / timeline loads when version changes — board has
  // its own effect via fetchBoard's dep array.
  useEffect(() => {
    if (!versionId) {
      setRequirements([]);
      setTimeline([]);
      return;
    }
    void fetchRequirements();
    void fetchTimeline();
  }, [fetchRequirements, fetchTimeline, versionId]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const currentVersion = useMemo(
    () => versions.find((v) => v.id === versionId) ?? null,
    [versionId, versions],
  );

  const grouped = useMemo(
    () =>
      COLUMN_ORDER.map((category) => {
        const column = board?.columns.find(
          (entry) => entry.statusCategory === category,
        );
        const pageInfo =
          column?.items ?? emptyBoardColumnPage(BOARD_COLUMN_PAGE_SIZE);

        return {
          category,
          items: pageInfo.items,
          pageInfo,
          total: column?.total ?? pageInfo.total,
        };
      }),
    [board],
  );

  const hasActiveFilter =
    filters.assigneeId !== null ||
    filters.statusCategory !== null ||
    filters.workItemType !== null;

  const updateBoardFilters = useCallback(
    (next: BoardFilters | ((prev: BoardFilters) => BoardFilters)) => {
      setFilters(next);
    },
    [],
  );

  const getVersionLookup = useCallback(
    (targetVersionId: string) =>
      versions.find((version) => version.id === targetVersionId),
    [versions],
  );

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const openItem = (summary: ViewWorkItemSummary) => {
    captureFocus();
    const item = createWorkItemViewModelMapper({
      locale,
      lookups: {
        getMember: (userId) => getMember(userId),
        getVersion: (nextVersionId) => getVersionLookup(nextVersionId),
      },
    })(summary);
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
    setActiveItemContext({
      contextKey: versionContextKey,
      organizationId,
      spaceId,
    });
    setSheetOpen(true);
  };

  const handleSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      setSheetOpen(nextOpen);
      if (!nextOpen) {
        restoreFocus();
      }
    },
    [restoreFocus],
  );

  const handleVersionCreated = (created: Version) => {
    // Optimistically prepend so the dropdown reflects the new version even if
    // the refresh has not yet returned, then refresh authoritative data.
    setVersions((prev) => [
      created,
      ...prev.filter((v) => v.id !== created.id),
    ]);
    selectVersion(created.id);
    void fetchVersions();
  };

  const handleVersionUpdated = (updated: Version) => {
    setVersions((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    void fetchVersions();
  };

  const refreshVersionContext = useCallback(() => {
    void fetchBoard();
    void fetchVersions();
    void fetchTimeline();
  }, [fetchBoard, fetchTimeline, fetchVersions]);

  const loadMoreColumn = useCallback(
    async (category: StatusCategory) => {
      if (!versionId || !board || loadingColumnCategory) {
        return;
      }

      const currentColumn = board.columns.find(
        (column) => column.statusCategory === category,
      );

      if (
        !currentColumn ||
        currentColumn.items.items.length >= currentColumn.total
      ) {
        return;
      }

      const requestId = boardRequestSeq.current + 1;
      boardRequestSeq.current = requestId;
      setLoadingColumnCategory(category);
      setErrorKey(null);

      try {
        const next = await getVersionBoardView({
          versionId,
          organizationId,
          spaceId: spaceId ?? undefined,
          assigneeId: filters.assigneeId ?? undefined,
          columnStatusCategory: category,
          page: currentColumn.items.page + 1,
          pageSize: BOARD_COLUMN_PAGE_SIZE,
          statusCategory: filters.statusCategory ?? undefined,
          workItemType: filters.workItemType ?? undefined,
        });
        if (boardRequestSeq.current !== requestId) return;
        setBoard((current) =>
          current ? mergeBoardColumnPage(current, next, category) : current,
        );
      } catch (error) {
        if (boardRequestSeq.current !== requestId) return;
        setErrorKey(getApiErrorMessageKey(error));
      } finally {
        if (boardRequestSeq.current === requestId) {
          setLoadingColumnCategory(null);
        }
      }
    },
    [
      board,
      filters.assigneeId,
      filters.statusCategory,
      filters.workItemType,
      loadingColumnCategory,
      organizationId,
      spaceId,
      versionId,
    ],
  );

  // -------------------------------------------------------------------------
  // Header meta — flattened from the former <VersionHero> band; lives in the
  // PageHeader's `meta` slot when a version is selected.
  // -------------------------------------------------------------------------

  const owner = currentVersion?.ownerId
    ? getMember(currentVersion.ownerId)
    : undefined;
  const ownerName = owner?.user.name ?? owner?.user.username ?? "";

  const headerMeta = currentVersion ? (
    <div
      data-testid="version-hero"
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <Badge
        data-testid="version-hero-status"
        variant={VERSION_STATUS_VARIANT[currentVersion.status] ?? "default"}
        className="uppercase"
      >
        {tVersionStatus(currentVersion.status)}
      </Badge>

      <div
        data-testid="version-hero-owner"
        className="flex items-center gap-1.5"
      >
        {ownerName ? (
          <>
            <Tip content={ownerName}>
              <Avatar className="h-5 w-5">
                {owner?.user.avatar && (
                  <AvatarImage src={owner.user.avatar} alt={ownerName} />
                )}
                <AvatarFallback className="text-[9px]">
                  {initialOf(ownerName)}
                </AvatarFallback>
              </Avatar>
            </Tip>
            <span className="text-foreground">{ownerName}</span>
          </>
        ) : (
          <span>{tHero("ownerNone")}</span>
        )}
      </div>

      <span className="h-3 w-px bg-border" aria-hidden />

      <span className="flex items-center gap-1">
        <span>{tHero("dateStart")}</span>
        <span
          data-testid="version-hero-date-start"
          className="font-medium text-foreground"
        >
          {formatDateOnly(currentVersion.startDate, locale)}
        </span>
      </span>
      <span className="flex items-center gap-1">
        <span>{tHero("dateTarget")}</span>
        <span
          data-testid="version-hero-date-target"
          className="font-medium text-foreground"
        >
          {formatDateOnly(currentVersion.targetDate, locale)}
        </span>
      </span>
      <span className="flex items-center gap-1">
        <span>{tHero("dateRelease")}</span>
        <span
          data-testid="version-hero-date-release"
          className="font-medium text-foreground"
        >
          {formatDateOnly(currentVersion.releaseDate, locale)}
        </span>
      </span>

      <span className="h-3 w-px bg-border" aria-hidden />

      <KpiInline
        testId="version-hero-kpi-requirementCount"
        label={tHero("kpi.requirementCount")}
        value={currentVersion.stats.requirementCount}
      />
      <KpiInline
        testId="version-hero-kpi-taskCount"
        label={tHero("kpi.taskCount")}
        value={currentVersion.stats.taskCount}
      />
      <KpiInline
        testId="version-hero-kpi-bugCount"
        label={tHero("kpi.bugCount")}
        value={currentVersion.stats.bugCount}
      />
      <KpiInline
        testId="version-hero-kpi-blockedCount"
        label={tHero("kpi.blockedCount")}
        value={currentVersion.stats.blockedCount}
        emphasize={currentVersion.stats.blockedCount > 0}
      />
    </div>
  ) : undefined;

  // -------------------------------------------------------------------------
  // Header actions
  // -------------------------------------------------------------------------

  const headerActions = (
    <>
      {versions.length > 0 && (
        <SelectMenu
          value={versionId ?? ""}
          onChange={(event) => selectVersion(event.target.value)}
          data-testid="version-board-version"
          triggerTestId="version-board-version-trigger"
          menuAlign="end"
          className="h-8 min-w-[10rem] max-w-[13rem] text-xs"
          contentClassName="w-52"
          aria-label={t("selectVersion")}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </SelectMenu>
      )}
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        data-testid="version-page-edit-version"
        disabled={!currentVersion || !spaceId || !canManageVersions}
        aria-disabled={!currentVersion || !spaceId || !canManageVersions}
        title={!canManageVersions ? t("actions.manageReadonly") : undefined}
        onClick={() => setEditVersionDialogOpen(true)}
      >
        <Pencil className="h-3 w-3" />
        {t("actions.editVersion")}
      </Button>
      <Button
        size="sm"
        className="text-xs"
        data-testid="version-page-new-version"
        disabled={!spaceId || !canManageVersions}
        aria-disabled={!spaceId || !canManageVersions}
        title={!canManageVersions ? t("actions.manageReadonly") : undefined}
        onClick={() => setCreateVersionDialogOpen(true)}
      >
        <Plus className="h-3 w-3" />
        {t("actions.newVersion")}
      </Button>
    </>
  );

  // -------------------------------------------------------------------------
  // Empty / error / loading guards (gate the whole tabbed body)
  // -------------------------------------------------------------------------

  let body: React.ReactNode;

  if (!session) {
    body = (
      <EmptyState
        title={t("states.noSession.title")}
        description={t("states.noSession.description")}
      />
    );
  } else if (!spaceId) {
    body = (
      <EmptyState
        title={t("states.noSpace.title")}
        description={t("states.noSpace.description")}
      />
    );
  } else if (errorKey && !board) {
    body = (
      <ErrorState
        title={t("states.error.title")}
        message={tRoot(errorKey)}
        onRetry={() => {
          if (!versionId) void fetchVersions();
          else void fetchBoard();
        }}
      />
    );
  } else if (isLoadingVersions && versions.length === 0) {
    body = <LoadingState label={t("states.loadingVersions")} />;
  } else if (versions.length === 0) {
    body = (
      <EmptyState
        title={t("states.noVersion.title")}
        description={t("states.noVersion.description")}
      />
    );
  } else if (!versionId || !currentVersion) {
    body = (
      <EmptyState
        title={t("states.pickVersion.title")}
        description={t("states.pickVersion.description")}
      />
    );
  } else {
    body = (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as "board" | "requirements" | "timeline")
          }
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div className="flex min-w-0 flex-col gap-3 border-b border-border px-4 py-2 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList className="min-w-max">
                <TabsTrigger value="board" data-testid="version-tab-board">
                  {t("tabs.board")}
                </TabsTrigger>
                <TabsTrigger
                  value="requirements"
                  data-testid="version-tab-requirements"
                >
                  {t("tabs.requirements")}
                </TabsTrigger>
                <TabsTrigger
                  value="timeline"
                  data-testid="version-tab-timeline"
                >
                  {t("tabs.timeline")}
                </TabsTrigger>
              </TabsList>
            </div>
            {activeTab === "board" && (
              <BoardToolbar
                filters={filters}
                setFilters={updateBoardFilters}
                hasActiveFilter={hasActiveFilter}
                members={members}
                getMember={getMember}
                t={t}
                spaceId={spaceId}
                canCreateWorkItem={canCreateWorkItem}
                onNewWorkItem={() => setCreateWorkItemDialogOpen(true)}
              />
            )}
          </div>

          <TabsContent
            value="board"
            className="mt-0 flex min-w-0 flex-1 flex-col overflow-hidden"
          >
            <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto xl:overflow-hidden">
              {isLoadingBoard && !board ? (
                <LoadingState label={t("states.loadingBoard")} />
              ) : (
                <BoardColumns
                  grouped={grouped}
                  loadingColumnCategory={loadingColumnCategory}
                  locale={locale}
                  getMember={getMember}
                  getVersion={getVersionLookup}
                  onLoadMore={loadMoreColumn}
                  openItem={openItem}
                  t={t}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="requirements"
            className="mt-0 min-w-0 flex-1 overflow-y-auto"
          >
            <RequirementsTab
              loading={isLoadingRequirements}
              errorKey={requirementsErrorKey}
              requirements={requirements}
              locale={locale}
              getMember={getMember}
              tRoot={tRoot}
              tRequirementStatus={tRequirementStatus}
              t={t}
              onRetry={() => {
                void fetchRequirements();
              }}
            />
          </TabsContent>

          <TabsContent value="timeline" className="mt-0 flex-1 overflow-y-auto">
            <TimelineTab
              loading={isLoadingTimeline}
              errorKey={timelineErrorKey}
              events={timeline}
              locale={locale}
              tRoot={tRoot}
              tTimelineEvent={tTimelineEvent}
              t={t}
              onRetry={() => {
                void fetchTimeline();
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // -------------------------------------------------------------------------

  const detailSheetOpen =
    sheetOpen && activeItemContext?.contextKey === versionContextKey;
  const detailSheetItem = detailSheetOpen ? activeItem : null;

  return (
    <div
      data-testid="version-board-page"
      className="flex h-full min-w-0 flex-col"
    >
      <PageHeader
        eyebrow={tShell("group.deliver")}
        title={t("title")}
        description={t("subtitle")}
        actions={headerActions}
        meta={headerMeta}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{body}</div>
      <TaskDetailSheet
        item={detailSheetItem}
        open={detailSheetOpen}
        onOpenChange={handleSheetOpenChange}
        spaceId={activeItemContext?.spaceId}
        organizationId={activeItemContext?.organizationId}
        onChanged={() => {
          refreshVersionContext();
        }}
      />
      {spaceId && canCreateWorkItem ? (
        <CreateTaskDialog
          open={createWorkItemDialogOpen}
          onOpenChange={setCreateWorkItemDialogOpen}
          spaceId={spaceId}
          organizationId={organizationId}
          initialVersionId={versionId ?? undefined}
          onCreated={() => {
            refreshVersionContext();
          }}
        />
      ) : null}
      {spaceId && canManageVersions ? (
        <>
          <CreateVersionDialog
            open={createVersionDialogOpen}
            onOpenChange={setCreateVersionDialogOpen}
            spaceId={spaceId}
            organizationId={organizationId}
            onCreated={handleVersionCreated}
          />
          <EditVersionDialog
            open={editVersionDialogOpen}
            onOpenChange={setEditVersionDialogOpen}
            spaceId={spaceId}
            organizationId={organizationId}
            version={currentVersion}
            onUpdated={handleVersionUpdated}
          />
        </>
      ) : null}
    </div>
  );
}

// Backwards-compatible alias — older imports referenced `VersionBoard`.
export { VersionPage as VersionBoard };

// ===========================================================================
// Board toolbar — assignee / statusCategory / workItemType filters
// ===========================================================================

function BoardToolbar({
  filters,
  setFilters,
  hasActiveFilter,
  members,
  getMember,
  t,
  spaceId,
  canCreateWorkItem,
  onNewWorkItem,
}: {
  filters: BoardFilters;
  setFilters: (
    next: BoardFilters | ((prev: BoardFilters) => BoardFilters),
  ) => void;
  hasActiveFilter: boolean;
  members: ReturnType<typeof useSpaceMembers>["members"];
  getMember: ReturnType<typeof useSpaceMembers>["getMember"];
  t: ReturnType<typeof useTranslations<"versionBoard">>;
  spaceId?: string;
  canCreateWorkItem: boolean;
  onNewWorkItem: () => void;
}) {
  const assigneeLabel = filters.assigneeId
    ? (getMember(filters.assigneeId)?.user.name ??
      getMember(filters.assigneeId)?.user.username ??
      "—")
    : t("filters.assignee.all");

  const statusLabel = filters.statusCategory
    ? t(`columns.${filters.statusCategory}`)
    : t("filters.status.all");

  const typeLabel = filters.workItemType
    ? t(`filters.type.${filters.workItemType}`)
    : t("filters.type.all");

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="relative inline-flex min-w-[9rem] max-w-[12rem]">
        <Users className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <SelectMenu
          value={filters.assigneeId ?? ""}
          onChange={(event) =>
            setFilters((prev) => ({
              ...prev,
              assigneeId: event.target.value || null,
            }))
          }
          data-testid="version-board-filter-assignee"
          className="h-8 pl-7 text-xs"
          containerClassName="w-full"
          contentClassName="w-52"
          aria-label={assigneeLabel}
        >
          <option value="">{t("filters.assignee.all")}</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.user.name || member.user.username}
            </option>
          ))}
        </SelectMenu>
      </span>

      <span className="relative inline-flex min-w-[8rem] max-w-[11rem]">
        <Filter className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <SelectMenu
          value={filters.statusCategory ?? ""}
          onChange={(event) =>
            setFilters((prev) => ({
              ...prev,
              statusCategory: (event.target.value || null) as
                | StatusCategory
                | null,
            }))
          }
          data-testid="version-board-filter-status"
          className="h-8 pl-7 text-xs"
          containerClassName="w-full"
          contentClassName="w-52"
          aria-label={statusLabel}
        >
          <option value="">{t("filters.status.all")}</option>
          {COLUMN_ORDER.map((category) => (
            <option key={category} value={category}>
              {t(`columns.${category}`)}
            </option>
          ))}
        </SelectMenu>
      </span>

      <span className="relative inline-flex min-w-[8rem] max-w-[10rem]">
        <Bug className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <SelectMenu
          value={filters.workItemType ?? ""}
          onChange={(event) =>
            setFilters((prev) => ({
              ...prev,
              workItemType: (event.target.value || null) as
                | WorkItemType
                | null,
            }))
          }
          data-testid="version-board-filter-type"
          className="h-8 pl-7 text-xs"
          containerClassName="w-full"
          contentClassName="w-44"
          aria-label={typeLabel}
        >
          <option value="">{t("filters.type.all")}</option>
          <option value="TASK">{t("filters.type.TASK")}</option>
          <option value="BUG">{t("filters.type.BUG")}</option>
        </SelectMenu>
      </span>

      {hasActiveFilter && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          data-testid="version-board-filter-clear"
          onClick={() => setFilters({ ...EMPTY_FILTERS })}
        >
          <XCircle className="h-3 w-3" />
          {t("filters.clear")}
        </Button>
      )}

      <Button
        size="sm"
        className="text-xs"
        data-testid="version-board-new-work-item"
        disabled={!spaceId || !canCreateWorkItem}
        aria-disabled={!spaceId || !canCreateWorkItem}
        title={!canCreateWorkItem ? t("newWorkItemReadonly") : undefined}
        onClick={onNewWorkItem}
      >
        <Plus className="h-3 w-3" />
        {t("newWorkItem")}
      </Button>
    </div>
  );
}

// ===========================================================================
// Inline KPI cell — used in the PageHeader meta strip
// ===========================================================================

function KpiInline({
  testId,
  label,
  value,
  emphasize = false,
}: {
  testId: string;
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <span data-testid={testId} className="flex items-baseline gap-1">
      <span
        className={cn(
          "font-mono text-sm",
          emphasize ? "text-destructive font-semibold" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[11px]">{label}</span>
    </span>
  );
}

// ===========================================================================
// Board columns
// ===========================================================================

function BoardColumns({
  grouped,
  loadingColumnCategory,
  locale,
  getMember,
  getVersion,
  onLoadMore,
  openItem,
  t,
}: {
  grouped: {
    category: StatusCategory;
    items: ViewWorkItemSummary[];
    pageInfo: PageResult<ViewWorkItemSummary>;
    total: number;
  }[];
  loadingColumnCategory: StatusCategory | null;
  locale: string;
  getMember: ReturnType<typeof useSpaceMembers>["getMember"];
  getVersion: (versionId: string) => Version | undefined;
  onLoadMore: (category: StatusCategory) => void;
  openItem: (summary: ViewWorkItemSummary) => void;
  t: ReturnType<typeof useTranslations<"versionBoard">>;
}) {
  return (
    <div
      data-testid="version-board-columns"
      className="grid min-h-full min-w-0 grid-cols-1 gap-3 px-4 py-4 md:grid-cols-2 xl:h-full xl:grid-cols-6"
    >
      {grouped.map(({ category, items, pageInfo, total }) => {
        const hasMore = items.length < total;
        const isLoadingMore = loadingColumnCategory === category;

        return (
          <div
            key={category}
            data-testid={`version-board-column-${category}`}
            className="flex min-h-0 min-w-0 flex-col rounded-lg border border-border bg-card/30"
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
              <span
                className={cn("h-1.5 w-1.5 rounded-full", COLUMN_DOT[category])}
              />
              <h2 className="text-[13px] font-semibold">
                {t(`columns.${category}`)}
              </h2>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {total}
              </span>
            </header>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {items.length === 0 && (
                <div className="flex h-20 items-center justify-center text-[11px] text-muted-foreground">
                  —
                </div>
              )}
              {items.map((item) => {
                const viewItem = createWorkItemViewModelMapper({
                  locale,
                  lookups: {
                    getMember: (userId) => getMember(userId),
                    getVersion: (versionId) => getVersion(versionId),
                  },
                })(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`version-board-card-${item.id}`}
                    onClick={() => openItem(item)}
                    className="group block w-full min-w-0 rounded-md border border-border bg-card p-2.5 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      {item.type === "BUG" ? (
                        <Bug className="h-3 w-3 text-destructive/80" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-primary/80" />
                      )}
                      <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                        {t(`filters.type.${viewItem.type}`)}
                      </span>
                      <span
                        className={cn(
                          "ml-auto h-1.5 w-1.5 rounded-full",
                          priorityDotColor[viewItem.priority],
                        )}
                      />
                    </div>
                    <div className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug">
                      {item.title}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {item.exceptionSignals.some(
                        (s) => s.type === "blocked",
                      ) && (
                        <Badge variant="warning" className="gap-1 text-[9px]">
                          <AlertCircle className="h-2 w-2" />
                          {t("badges.blocked")}
                        </Badge>
                      )}
                      {item.exceptionSignals.some(
                        (s) => s.type === "overdue",
                      ) && (
                        <Badge variant="destructive" className="text-[9px]">
                          {t("badges.overdue")}
                        </Badge>
                      )}
                      <Tip content={viewItem.assignee.name || undefined}>
                        <Avatar className="ml-auto h-5 w-5">
                          <AvatarFallback className="text-[9px]">
                            {viewItem.assignee.initial}
                          </AvatarFallback>
                        </Avatar>
                      </Tip>
                    </div>
                  </button>
                );
              })}
              {hasMore ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full text-xs"
                  data-testid={`version-board-column-load-more-${category}`}
                  disabled={isLoadingMore}
                  onClick={() => onLoadMore(category)}
                >
                  {isLoadingMore
                    ? t("pagination.columnLoading")
                    : t("pagination.columnLoadMore", {
                        loaded: items.length,
                        total: pageInfo.total,
                      })}
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Requirements tab
// ===========================================================================

function RequirementsTab({
  loading,
  errorKey,
  requirements,
  locale,
  getMember,
  tRoot,
  tRequirementStatus,
  t,
  onRetry,
}: {
  loading: boolean;
  errorKey: string | null;
  requirements: Requirement[];
  locale: string;
  getMember: ReturnType<typeof useSpaceMembers>["getMember"];
  tRoot: ReturnType<typeof useTranslations>;
  tRequirementStatus: ReturnType<typeof useTranslations<"requirements.status">>;
  t: ReturnType<typeof useTranslations<"versionBoard">>;
  onRetry: () => void;
}) {
  if (loading) {
    return <LoadingState label={t("requirements.loading")} />;
  }
  if (errorKey) {
    return (
      <ErrorState
        title={t("requirements.errorTitle")}
        message={tRoot(errorKey)}
        onRetry={onRetry}
      />
    );
  }
  if (requirements.length === 0) {
    return (
      <div data-testid="version-tab-requirements-empty">
        <EmptyState
          title={t("requirements.empty.title")}
          description={t("requirements.empty.description")}
        />
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {requirements.map((req) => {
        const owner = req.ownerId ? getMember(req.ownerId) : undefined;
        const ownerName = owner?.user.name ?? owner?.user.username ?? "—";
        return (
          <li
            key={req.id}
            data-testid={`version-requirement-row-${req.id}`}
            className="px-6 py-3"
          >
            <Link
              href={`/requirements/${req.id}`}
              className="flex min-w-0 items-center gap-3 hover:opacity-90"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {req.title || req.id}
                </div>
                {req.summary && (
                  <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {req.summary}
                  </div>
                )}
              </div>
              <Badge
                variant={REQUIREMENT_STATUS_VARIANT[req.status] ?? "default"}
                className="text-[10px] uppercase"
              >
                {tRequirementStatus(req.status)}
              </Badge>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                {ownerName}
              </span>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground md:inline">
                {formatDateTime(req.updatedAt, locale)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ===========================================================================
// Timeline tab
// ===========================================================================

function TimelineTab({
  loading,
  errorKey,
  events,
  locale,
  tRoot,
  tTimelineEvent,
  t,
  onRetry,
}: {
  loading: boolean;
  errorKey: string | null;
  events: TimelineEvent[];
  locale: string;
  tRoot: ReturnType<typeof useTranslations>;
  tTimelineEvent: ReturnType<
    typeof useTranslations<"versionBoard.timeline.event">
  >;
  t: ReturnType<typeof useTranslations<"versionBoard">>;
  onRetry: () => void;
}) {
  if (loading) {
    return <LoadingState label={t("timeline.loading")} />;
  }
  if (errorKey) {
    return (
      <ErrorState
        title={t("timeline.errorTitle")}
        message={tRoot(errorKey)}
        onRetry={onRetry}
      />
    );
  }
  if (events.length === 0) {
    return (
      <div data-testid="version-tab-timeline-empty">
        <EmptyState
          icon={<Clock className="h-4 w-4" />}
          title={t("timeline.empty.title")}
          description={t("timeline.empty.description")}
        />
      </div>
    );
  }
  return (
    <ul className="space-y-3 px-6 py-4">
      {events.map((event) => {
        const actorName = event.actor.name || t("timeline.unknownActor");
        // Fall back to the raw event type when the namespace is missing —
        // keeps the row legible if a new event type ships before i18n catches up.
        let eventLabel: string;
        try {
          eventLabel = tTimelineEvent(event.eventType);
        } catch {
          eventLabel = event.eventType;
        }
        return (
          <li
            key={event.id}
            data-testid={`version-timeline-row-${event.id}`}
            className="flex gap-3"
          >
            <Tip content={actorName}>
              <Avatar className="h-7 w-7">
                {event.actor.avatar && (
                  <AvatarImage src={event.actor.avatar} alt={actorName} />
                )}
                <AvatarFallback>{initialOf(actorName)}</AvatarFallback>
              </Avatar>
            </Tip>
            <div className="flex-1 text-[13px]">
              <div>
                <span className="font-medium">{actorName}</span>
                <span className="text-muted-foreground"> · {eventLabel}</span>
                {event.title && (
                  <span className="text-foreground"> · {event.title}</span>
                )}
                {event.detail && (
                  <span className="ml-1 font-mono text-[12px] text-foreground">
                    {event.detail}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {formatDateTime(event.createdAt, locale)}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
