"use client";

import type {
  GetVersionBoardViewResponse,
  PageResult,
  RecordStatus,
  RealtimeEvent,
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
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Pencil,
  Plus,
  Tags,
  Users,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { resolveRequirementDisplayCode } from "../../lib/display-code";
import { Link, usePathname, useRouter } from "../../i18n/routing";
import {
  createWorkItemViewModelMapper,
  type WorkItemViewModel,
} from "../../lib/v2/work-item-view-model";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";
import { TimelineEventItem } from "../timeline/timeline-event-item";
import { listRequirements } from "../../lib/requirement-service";
import { listTimeline } from "../../lib/timeline-service";
import { listVersions } from "../../lib/version-service";
import { getVersionBoardView } from "../../lib/view-service";
import { useFocusReturn } from "../../lib/hooks/use-list-keyboard-nav";
import { useSpaceMembers } from "../../lib/v2/lookups";
import { translateWorkflowStateName } from "../../lib/workflow-display";
import {
  resolveRefreshMode,
  shouldClearDataForRefresh,
  shouldShowBlockingRefreshState,
  shouldSurfaceRefreshError,
  useRealtimeInvalidation,
  type RealtimeInvalidationContext,
  type RefreshModeOptions,
} from "../../lib/realtime";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SelectMenu } from "../ui/select-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { getStatusCategoryDotClass, StatusBadge } from "../ui/status-badge";
import { Tip } from "../ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { CreateTaskDialog } from "../work-item/create-task-dialog";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";
import { FilterField, FilterPanel } from "../v2/filter-controls";
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
const BOARD_COLUMN_INITIAL_VISIBLE_ITEMS = 5;
const BOARD_COLUMN_EXPAND_STEP = 10;
const DEFAULT_VERSION_STATUS_ORDER: VersionStatus[] = [
  "IN_PROGRESS",
  "PLANNED",
  "RELEASED",
  "ARCHIVED",
];

const VERSION_PAGE_REALTIME_KEYS = [
  "version-board",
  "requirement-list",
  "requirement-detail",
  "timeline",
  "comments",
  "attachments",
] as const;

type VersionPageRealtimeKey = (typeof VERSION_PAGE_REALTIME_KEYS)[number];

function getDefaultVersionId(
  versions: Version[],
  preferredVersionId: string | null,
): string | null {
  if (preferredVersionId && versions.some((v) => v.id === preferredVersionId)) {
    return preferredVersionId;
  }

  for (const status of DEFAULT_VERSION_STATUS_ORDER) {
    const version = versions.find((v) => v.status === status);
    if (version) return version.id;
  }

  return versions[0]?.id ?? null;
}

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

function realtimeHintString(
  event: RealtimeEvent,
  key:
    | "spaceId"
    | "targetId"
    | "targetType"
    | "versionId"
    | "workItemId",
): string | undefined {
  const value = event.hints?.[key];
  return typeof value === "string" ? value : undefined;
}

function realtimeHintStringArray(
  event: RealtimeEvent,
  key: "changedFields",
): string[] {
  const value = event.hints?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function realtimeHintBoolean(
  event: RealtimeEvent,
  key: "suggestFullRefresh",
): boolean {
  return event.hints?.[key] === true;
}

function realtimeEventMatchesSpace(
  event: RealtimeEvent,
  spaceId: string | undefined,
): boolean {
  const eventSpaceId = realtimeHintString(event, "spaceId") ?? event.spaceId;
  return !spaceId || !eventSpaceId || eventSpaceId === spaceId;
}

function realtimeEventTargetsVersionMetadata(event: RealtimeEvent): boolean {
  return (
    event.target.type === "VERSION" ||
    realtimeHintString(event, "targetType") === "VERSION"
  );
}

function realtimeEventMatchesVersion(
  event: RealtimeEvent,
  versionId: string | null,
  spaceId: string | undefined,
): boolean {
  if (!realtimeEventMatchesSpace(event, spaceId)) {
    return false;
  }

  const hintedVersionId = realtimeHintString(event, "versionId");

  if (hintedVersionId) {
    return hintedVersionId === versionId;
  }

  if (event.target.type === "VERSION") {
    return event.target.id === versionId;
  }

  return false;
}

function realtimeEventMayAffectVersion(
  event: RealtimeEvent,
  versionId: string | null,
  spaceId: string | undefined,
): boolean {
  if (!realtimeEventMatchesSpace(event, spaceId)) {
    return false;
  }

  const hintedVersionId = realtimeHintString(event, "versionId");

  if (hintedVersionId === versionId) {
    return true;
  }

  if (event.target.type === "VERSION") {
    return event.target.id === versionId;
  }

  if (
    realtimeHintBoolean(event, "suggestFullRefresh") ||
    realtimeHintStringArray(event, "changedFields").includes("versionId")
  ) {
    return true;
  }

  return !hintedVersionId;
}

function realtimeEventMatchesActiveDetail(
  event: RealtimeEvent,
  activeItemId: string | undefined,
  spaceId: string | undefined,
): boolean {
  if (!activeItemId || !realtimeEventMatchesSpace(event, spaceId)) {
    return false;
  }

  const hintedWorkItemId = realtimeHintString(event, "workItemId");
  if (hintedWorkItemId) {
    return hintedWorkItemId === activeItemId;
  }

  const hintedTargetType = realtimeHintString(event, "targetType");
  const hintedTargetId = realtimeHintString(event, "targetId");
  if (hintedTargetType === "WORK_ITEM" && hintedTargetId) {
    return hintedTargetId === activeItemId;
  }

  return event.target.type === "WORK_ITEM" && event.target.id === activeItemId;
}

function shouldRefreshRealtimeResource(
  context: RealtimeInvalidationContext,
  key: VersionPageRealtimeKey,
  matchesEvent: (event: RealtimeEvent) => boolean,
): boolean {
  if (!context.keys.includes(key)) {
    return false;
  }

  const hasMatchingResync = context.resyncs.some(
    (resync) => resync.invalidates.length === 0 || resync.invalidates.includes(key),
  );
  if (hasMatchingResync) {
    return true;
  }

  const matchingEvents = context.events.filter((event) =>
    event.invalidates.includes(key),
  );

  if (matchingEvents.length === 0) {
    return true;
  }

  return matchingEvents.some(matchesEvent);
}

function shouldRefreshAnyRealtimeResource(
  context: RealtimeInvalidationContext,
  keys: readonly VersionPageRealtimeKey[],
  matchesEvent: (event: RealtimeEvent) => boolean,
): boolean {
  return keys.some((key) =>
    shouldRefreshRealtimeResource(context, key, matchesEvent),
  );
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
  const tTimelineEvent = useTranslations("common.timeline.event");
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
  const versionIdRef = useRef<string | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // ----- board -----
  const [board, setBoard] = useState<GetVersionBoardViewResponse | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
  const [loadingColumnCategory, setLoadingColumnCategory] =
    useState<StatusCategory | null>(null);
  const [columnVisibleCounts, setColumnVisibleCounts] = useState<
    Partial<Record<StatusCategory, number>>
  >({});
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // ----- requirements tab -----
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [requirementsTotal, setRequirementsTotal] = useState(0);
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
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [createWorkItemDialogOpen, setCreateWorkItemDialogOpen] =
    useState(false);
  const [createVersionDialogOpen, setCreateVersionDialogOpen] = useState(false);
  const [editVersionDialogOpen, setEditVersionDialogOpen] = useState(false);
  const [versionDetailSheetOpen, setVersionDetailSheetOpen] = useState(false);
  const { captureFocus, restoreFocus } = useFocusReturn();
  const commitVersionId = useCallback((nextVersionId: string | null) => {
    versionIdRef.current = nextVersionId;
    setVersionId(nextVersionId);
  }, []);

  useEffect(() => {
    versionsRequestSeq.current += 1;
    boardRequestSeq.current += 1;
    requirementsRequestSeq.current += 1;
    timelineRequestSeq.current += 1;
    setVersions([]);
    commitVersionId(null);
    setBoard(null);
    setLoadingColumnCategory(null);
    setColumnVisibleCounts({});
    setRequirements([]);
    setRequirementsTotal(0);
    setTimeline([]);
    setFilterOpen(false);
    setErrorKey(null);
    setRequirementsErrorKey(null);
    setTimelineErrorKey(null);
    setActiveItem(null);
    setActiveItemContext(null);
    setSheetOpen(false);
    setDetailRefreshToken(0);
    setCreateWorkItemDialogOpen(false);
    setCreateVersionDialogOpen(false);
    setEditVersionDialogOpen(false);
    setVersionDetailSheetOpen(false);
  }, [commitVersionId, organizationId, spaceId]);

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
      commitVersionId(nextVersionId);
      setColumnVisibleCounts({});
      if (syncUrl) {
        replaceVersionParam(nextVersionId);
      }
    },
    [commitVersionId, replaceVersionParam],
  );

  const fetchVersions = useCallback(async (options?: RefreshModeOptions) => {
    const mode = resolveRefreshMode(options);
    if (!spaceId) {
      versionsRequestSeq.current += 1;
      setVersions([]);
      commitVersionId(null);
      setIsLoadingVersions(false);
      return;
    }
    const requestId = versionsRequestSeq.current + 1;
    versionsRequestSeq.current = requestId;
    if (shouldShowBlockingRefreshState(mode)) {
      setIsLoadingVersions(true);
    }
    if (shouldSurfaceRefreshError(mode)) {
      setErrorKey(null);
    }
    try {
      const page = await listVersions({
        spaceId,
        organizationId,
        page: 1,
        pageSize: 100,
      });
      if (versionsRequestSeq.current !== requestId) return;
      setVersions(page.items);
      const hasUrlVersion = Boolean(
        versionIdParam &&
          page.items.some((version) => version.id === versionIdParam),
      );
      const nextVersionId = hasUrlVersion
        ? (versionIdParam ?? null)
        : getDefaultVersionId(page.items, versionIdRef.current);

      if (versionIdParam && !hasUrlVersion) {
        replaceVersionParam(nextVersionId ?? undefined);
      }
      commitVersionId(nextVersionId ?? null);
      setErrorKey(null);
    } catch (error) {
      if (versionsRequestSeq.current !== requestId) return;
      if (shouldSurfaceRefreshError(mode)) {
        setErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (versionsRequestSeq.current === requestId) {
        setIsLoadingVersions(false);
      }
    }
  }, [
    commitVersionId,
    organizationId,
    replaceVersionParam,
    spaceId,
    versionIdParam,
  ]);

  useEffect(() => {
    void fetchVersions({ mode: "initial" });
  }, [fetchVersions]);

  useEffect(() => {
    if (!versionIdParam) {
      return;
    }

    if (versions.some((version) => version.id === versionIdParam)) {
      commitVersionId(versionIdParam);
    }
  }, [commitVersionId, versionIdParam, versions]);

  const fetchBoard = useCallback(async (options?: RefreshModeOptions) => {
    const mode = resolveRefreshMode(options);
    if (!versionId) {
      boardRequestSeq.current += 1;
      if (shouldClearDataForRefresh(mode)) {
        setBoard(null);
      }
      setIsLoadingBoard(false);
      return;
    }
    const requestId = boardRequestSeq.current + 1;
    boardRequestSeq.current = requestId;
    if (shouldClearDataForRefresh(mode)) {
      setBoard(null);
    }
    if (shouldShowBlockingRefreshState(mode)) {
      setIsLoadingBoard(true);
    }
    if (shouldSurfaceRefreshError(mode)) {
      setErrorKey(null);
    }
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
      setErrorKey(null);
    } catch (error) {
      if (boardRequestSeq.current !== requestId) return;
      if (shouldSurfaceRefreshError(mode)) {
        setErrorKey(getApiErrorMessageKey(error));
      }
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
    if (versionId) void fetchBoard({ mode: "initial" });
  }, [fetchBoard, versionId]);

  useEffect(() => {
    setColumnVisibleCounts({});
  }, [
    filters.assigneeId,
    filters.statusCategory,
    filters.workItemType,
    versionId,
  ]);

  const fetchRequirements = useCallback(async (options?: RefreshModeOptions) => {
    const mode = resolveRefreshMode(options);
    if (!versionId || !spaceId) {
      requirementsRequestSeq.current += 1;
      if (shouldClearDataForRefresh(mode)) {
        setRequirements([]);
        setRequirementsTotal(0);
      }
      setIsLoadingRequirements(false);
      return;
    }
    const requestId = requirementsRequestSeq.current + 1;
    requirementsRequestSeq.current = requestId;
    if (shouldClearDataForRefresh(mode)) {
      setRequirements([]);
      setRequirementsTotal(0);
    }
    if (shouldShowBlockingRefreshState(mode)) {
      setIsLoadingRequirements(true);
    }
    if (shouldSurfaceRefreshError(mode)) {
      setRequirementsErrorKey(null);
    }
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
      setRequirementsTotal(page.total ?? page.items.length);
      setRequirementsErrorKey(null);
    } catch (error) {
      if (requirementsRequestSeq.current !== requestId) return;
      if (shouldSurfaceRefreshError(mode)) {
        setRequirementsTotal(0);
        setRequirementsErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (requirementsRequestSeq.current === requestId) {
        setIsLoadingRequirements(false);
      }
    }
  }, [organizationId, spaceId, versionId]);

  const fetchTimeline = useCallback(async (options?: RefreshModeOptions) => {
    const mode = resolveRefreshMode(options);
    if (!versionId || !spaceId) {
      timelineRequestSeq.current += 1;
      if (shouldClearDataForRefresh(mode)) {
        setTimeline([]);
      }
      setIsLoadingTimeline(false);
      return;
    }
    const requestId = timelineRequestSeq.current + 1;
    timelineRequestSeq.current = requestId;
    if (shouldClearDataForRefresh(mode)) {
      setTimeline([]);
    }
    if (shouldShowBlockingRefreshState(mode)) {
      setIsLoadingTimeline(true);
    }
    if (shouldSurfaceRefreshError(mode)) {
      setTimelineErrorKey(null);
    }
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
      setTimelineErrorKey(null);
    } catch (error) {
      if (timelineRequestSeq.current !== requestId) return;
      if (shouldSurfaceRefreshError(mode)) {
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
      setRequirementsTotal(0);
      setTimeline([]);
      return;
    }
    void fetchRequirements({ mode: "initial" });
    void fetchTimeline({ mode: "initial" });
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
  const activeFilterCount = [
    filters.assigneeId,
    filters.statusCategory,
    filters.workItemType,
  ].filter(Boolean).length;
  const boardTotal = useMemo(
    () => board?.columns.reduce((sum, column) => sum + column.total, 0) ?? 0,
    [board],
  );
  const canCreateNotStartedTask =
    canCreateWorkItem &&
    filters.workItemType !== "BUG" &&
    (filters.statusCategory === null ||
      filters.statusCategory === "NOT_STARTED");

  const updateBoardFilters = useCallback(
    (next: BoardFilters | ((prev: BoardFilters) => BoardFilters)) => {
      setFilters(next);
      setColumnVisibleCounts({});
    },
    [],
  );

  const expandBoardColumn = useCallback(
    (category: StatusCategory, loadedCount: number) => {
      setColumnVisibleCounts((current) => {
        const visibleCount =
          current[category] ?? BOARD_COLUMN_INITIAL_VISIBLE_ITEMS;
        return {
          ...current,
          [category]: Math.min(
            loadedCount,
            visibleCount + BOARD_COLUMN_EXPAND_STEP,
          ),
        };
      });
    },
    [],
  );

  const collapseBoardColumn = useCallback((category: StatusCategory) => {
    setColumnVisibleCounts((current) => ({
      ...current,
      [category]: BOARD_COLUMN_INITIAL_VISIBLE_ITEMS,
    }));
  }, []);

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
      workflowStateLabel: (state) => translateWorkflowStateName(tRoot, state),
    })(summary);
    recordRecentOpen(
      {
        id: item.id,
        type: item.type,
        displayCode: item.code,
        title: item.title,
        href:
          item.type === "BUG"
            ? `/bugs?bugId=${encodeURIComponent(item.id)}`
            : `/work-items?workItemId=${encodeURIComponent(item.id)}`,
        organizationId,
        spaceId,
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
    void fetchVersions({ mode: "manual" });
  };

  const handleVersionUpdated = (updated: Version) => {
    setVersions((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    void fetchVersions({ mode: "manual" });
  };

  const refreshVersionContext = useCallback(
    (options?: RefreshModeOptions) => {
      const mode = resolveRefreshMode(options);
      void fetchBoard({ mode });
      void fetchVersions({ mode });
      void fetchTimeline({ mode });
    },
    [fetchBoard, fetchTimeline, fetchVersions],
  );

  useRealtimeInvalidation(VERSION_PAGE_REALTIME_KEYS, (context) => {
    const refreshOptions = { mode: "realtime" } satisfies RefreshModeOptions;
    const currentVersionId = versionIdRef.current;
    const activeDetailItemId =
      sheetOpen && activeItemContext?.contextKey === versionContextKey
        ? activeItem?.id
        : undefined;

    if (
      shouldRefreshRealtimeResource(context, "version-board", (event) =>
        realtimeEventMayAffectVersion(event, currentVersionId, spaceId),
      )
    ) {
      void fetchBoard(refreshOptions);
    }

    if (
      shouldRefreshRealtimeResource(context, "version-board", (event) =>
        realtimeEventMatchesSpace(event, spaceId) &&
        realtimeEventTargetsVersionMetadata(event),
      )
    ) {
      void fetchVersions(refreshOptions);
    }

    if (
      shouldRefreshAnyRealtimeResource(
        context,
        ["requirement-list", "requirement-detail"],
        (event) => realtimeEventMayAffectVersion(event, currentVersionId, spaceId),
      )
    ) {
      void fetchRequirements(refreshOptions);
    }

    if (
      shouldRefreshRealtimeResource(context, "timeline", (event) =>
        realtimeEventMatchesVersion(event, currentVersionId, spaceId),
      )
    ) {
      void fetchTimeline(refreshOptions);
    }

    if (
      shouldRefreshAnyRealtimeResource(
        context,
        ["timeline", "comments", "attachments"],
        (event) =>
          realtimeEventMatchesActiveDetail(event, activeDetailItemId, spaceId),
      )
    ) {
      setDetailRefreshToken((token) => token + 1);
    }
  });

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
  // Version context — keep page-level title/actions in PageHeader, and render
  // selected-version details as a dedicated strip below it.
  // -------------------------------------------------------------------------

  const owner = currentVersion?.ownerId
    ? getMember(currentVersion.ownerId)
    : undefined;
  const ownerName = owner?.user.name ?? owner?.user.username ?? "";
  const fullVersionTarget = currentVersion?.target?.trim() ?? "";
  const versionDescription = currentVersion?.description?.trim() ?? "";
  const versionTarget = fullVersionTarget || tHero("targetNone");

  const versionSummary = currentVersion ? (
    <div
      data-testid="version-hero"
      className="border-b border-border bg-muted/10 px-4 py-3 sm:px-6"
    >
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
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

          <span
            className="hidden h-3 w-px bg-border sm:inline-block"
            aria-hidden
          />

          <span className="flex min-w-0 items-center gap-1.5 sm:max-w-[40rem] xl:max-w-[48rem]">
            <span className="shrink-0">{tHero("target")}</span>
            <Tip content={versionTarget}>
              <span
                data-testid="version-hero-target"
                className="min-w-0 truncate font-medium text-foreground"
              >
                {versionTarget}
              </span>
            </Tip>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="version-hero-detail-open"
              className="h-6 shrink-0 px-1.5 text-[11px]"
              onClick={() => setVersionDetailSheetOpen(true)}
            >
              <FileText className="h-3 w-3" />
              {tHero("viewDetails")}
            </Button>
          </span>
        </div>

        <div
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground xl:justify-end"
          aria-label={tHero("ariaLabel")}
        >
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

          <span
            className="hidden h-3 w-px bg-border md:inline-block"
            aria-hidden
          />

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
      </div>
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
      {spaceId && currentVersion && activeTab === "board" && (
        <Button
          variant={filterOpen ? "secondary" : "outline"}
          size="sm"
          className="text-xs"
          data-testid="version-board-filter-toggle"
          aria-expanded={filterOpen}
          aria-controls="version-board-filter-panel"
          onClick={() => setFilterOpen((open) => !open)}
        >
          <Filter className="h-3 w-3" />
          {t("filterTask")}
          {activeFilterCount > 0 && (
            <span
              data-testid="version-board-filter-active-count"
              className="ml-0.5 rounded bg-background px-1 font-mono text-[10px] text-foreground"
            >
              {activeFilterCount}
            </span>
          )}
        </Button>
      )}
      {spaceId && currentVersion && activeTab === "board" && (
        <Button
          size="sm"
          className="text-xs"
          data-testid="version-board-new-work-item"
          disabled={!canCreateWorkItem}
          aria-disabled={!canCreateWorkItem}
          title={!canCreateWorkItem ? t("newWorkItemReadonly") : undefined}
          onClick={() => setCreateWorkItemDialogOpen(true)}
        >
          <Plus className="h-3 w-3" />
          {t("newWorkItem")}
        </Button>
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
          if (!versionId) void fetchVersions({ mode: "manual" });
          else void fetchBoard({ mode: "manual" });
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
      <div className="flex min-w-0 flex-1 flex-col">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const nextTab = value as "board" | "requirements" | "timeline";
            setActiveTab(nextTab);
            if (nextTab !== "board") {
              setFilterOpen(false);
            }
          }}
          className="flex min-w-0 flex-1 flex-col"
        >
          <div className="flex min-w-0 border-b border-border px-4 py-3 sm:px-6">
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList className="h-auto min-w-max gap-1 border-0">
                <TabsTrigger
                  value="board"
                  data-testid="version-tab-board"
                  className="h-7 rounded-md px-2.5 text-[12px] after:hidden data-[state=active]:bg-muted data-[state=active]:font-medium data-[state=active]:text-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  {t("tabs.board")}
                  <span
                    data-testid="version-tab-board-count"
                    className="rounded bg-background px-1 font-mono text-[10px]"
                  >
                    {boardTotal}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="requirements"
                  data-testid="version-tab-requirements"
                  className="h-7 rounded-md px-2.5 text-[12px] after:hidden data-[state=active]:bg-muted data-[state=active]:font-medium data-[state=active]:text-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  {t("tabs.requirements")}
                  <span
                    data-testid="version-tab-requirements-count"
                    className="rounded bg-background px-1 font-mono text-[10px]"
                  >
                    {requirementsTotal}
                  </span>
                </TabsTrigger>
                <TabsTrigger
                  value="timeline"
                  data-testid="version-tab-timeline"
                  className="h-7 rounded-md px-2.5 text-[12px] after:hidden data-[state=active]:bg-muted data-[state=active]:font-medium data-[state=active]:text-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  {t("tabs.timeline")}
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          {activeTab === "board" && filterOpen && (
            <BoardFilterPanel
              id="version-board-filter-panel"
              filters={filters}
              setFilters={updateBoardFilters}
              hasActiveFilter={hasActiveFilter}
              members={members}
              getMember={getMember}
              t={t}
            />
          )}

          <TabsContent
            value="board"
            className="mt-0 flex min-w-0 flex-1 flex-col"
          >
            <div className="min-w-0 flex-1 overflow-x-hidden">
              {isLoadingBoard && !board ? (
                <LoadingState label={t("states.loadingBoard")} />
              ) : (
                <BoardColumns
                  grouped={grouped}
                  columnVisibleCounts={columnVisibleCounts}
                  loadingColumnCategory={loadingColumnCategory}
                  locale={locale}
                  getMember={getMember}
                  getVersion={getVersionLookup}
                  canCreateNotStartedTask={canCreateNotStartedTask}
                  onExpandColumn={expandBoardColumn}
                  onCollapseColumn={collapseBoardColumn}
                  onNewTask={() => setCreateWorkItemDialogOpen(true)}
                  onLoadMore={loadMoreColumn}
                  openItem={openItem}
                  t={t}
                  tRoot={tRoot}
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
                void fetchRequirements({ mode: "manual" });
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
                void fetchTimeline({ mode: "manual" });
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
  const detailSheetKey = detailSheetItem
    ? `${versionContextKey}:${detailSheetItem.id}:${detailRefreshToken}`
    : `${versionContextKey}:empty`;

  return (
    <div
      data-testid="version-board-page"
      className="flex min-h-full min-w-0 flex-col"
    >
      <PageHeader
        eyebrow={tShell("group.deliver")}
        title={t("title")}
        description={t("subtitle")}
        actions={headerActions}
      />
      {versionSummary}
      <div className="flex min-w-0 flex-1 flex-col">{body}</div>
      <TaskDetailSheet
        key={detailSheetKey}
        item={detailSheetItem}
        open={detailSheetOpen}
        onOpenChange={handleSheetOpenChange}
        spaceId={activeItemContext?.spaceId}
        organizationId={activeItemContext?.organizationId}
        onChanged={() => {
          refreshVersionContext();
        }}
      />
      <Sheet
        open={versionDetailSheetOpen && Boolean(currentVersion)}
        onOpenChange={setVersionDetailSheetOpen}
      >
        <SheetContent
          className="flex flex-col gap-0 p-0"
          data-testid="version-detail-sheet"
        >
          <SheetHeader className="pr-14">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="truncate">
                  {currentVersion?.name ?? t("title")}
                </SheetTitle>
                <SheetDescription>
                  {tHero("detailSheetDescription", {
                    version: currentVersion?.name ?? "",
                  })}
                </SheetDescription>
              </div>
              {canManageVersions ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-0.5 shrink-0 text-xs"
                  data-testid="version-detail-edit-version"
                  onClick={() => {
                    setVersionDetailSheetOpen(false);
                    setEditVersionDialogOpen(true);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                  {t("actions.editVersion")}
                </Button>
              ) : null}
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <section className="border-b border-border/60 pb-4">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                {tHero("target")}
              </h3>
              <div
                data-testid="version-detail-target"
                className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground"
              >
                {fullVersionTarget || tHero("targetNone")}
              </div>
            </section>
            <section className="border-b border-border/60 py-4">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                {tHero("description")}
              </h3>
              <div
                data-testid="version-detail-description"
                className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground"
              >
                {versionDescription || tHero("descriptionNone")}
              </div>
            </section>
            <section className="border-b border-border/60 py-4">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                {tHero("metadata")}
              </h3>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <VersionDetailField label={tHero("owner")}>
                  <span data-testid="version-detail-owner">
                    {ownerName || tHero("ownerNone")}
                  </span>
                </VersionDetailField>
                <VersionDetailField label={tHero("status")}>
                  {currentVersion ? (
                    <Badge
                      data-testid="version-detail-status"
                      variant={
                        VERSION_STATUS_VARIANT[currentVersion.status] ??
                        "default"
                      }
                      className="uppercase"
                    >
                      {tVersionStatus(currentVersion.status)}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </VersionDetailField>
                <VersionDetailField label={tHero("dateStart")}>
                  <span data-testid="version-detail-date-start">
                    {formatDateOnly(currentVersion?.startDate, locale)}
                  </span>
                </VersionDetailField>
                <VersionDetailField label={tHero("dateTarget")}>
                  <span data-testid="version-detail-date-target">
                    {formatDateOnly(currentVersion?.targetDate, locale)}
                  </span>
                </VersionDetailField>
                <VersionDetailField label={tHero("dateRelease")}>
                  <span data-testid="version-detail-date-release">
                    {formatDateOnly(currentVersion?.releaseDate, locale)}
                  </span>
                </VersionDetailField>
              </dl>
            </section>
            <section className="pt-4">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                {tHero("stats")}
              </h3>
              {currentVersion ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <VersionDetailStat
                    testId="version-detail-kpi-requirementCount"
                    label={tHero("kpi.requirementCount")}
                    value={currentVersion.stats.requirementCount}
                  />
                  <VersionDetailStat
                    testId="version-detail-kpi-taskCount"
                    label={tHero("kpi.taskCount")}
                    value={currentVersion.stats.taskCount}
                  />
                  <VersionDetailStat
                    testId="version-detail-kpi-bugCount"
                    label={tHero("kpi.bugCount")}
                    value={currentVersion.stats.bugCount}
                  />
                  <VersionDetailStat
                    testId="version-detail-kpi-blockedCount"
                    label={tHero("kpi.blockedCount")}
                    value={currentVersion.stats.blockedCount}
                    emphasize={currentVersion.stats.blockedCount > 0}
                  />
                </div>
              ) : null}
            </section>
          </div>
        </SheetContent>
      </Sheet>
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

function VersionDetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{children}</dd>
    </div>
  );
}

function VersionDetailStat({
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
    <div
      data-testid={testId}
      className="rounded-md border border-border bg-muted/20 px-3 py-2"
    >
      <div
        className={cn(
          "font-mono text-lg font-semibold",
          emphasize ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ===========================================================================
// Board filters — assignee / statusCategory / workItemType
// ===========================================================================

function BoardFilterPanel({
  id,
  filters,
  setFilters,
  hasActiveFilter,
  members,
  getMember,
  t,
}: {
  id: string;
  filters: BoardFilters;
  setFilters: (
    next: BoardFilters | ((prev: BoardFilters) => BoardFilters),
  ) => void;
  hasActiveFilter: boolean;
  members: ReturnType<typeof useSpaceMembers>["members"];
  getMember: ReturnType<typeof useSpaceMembers>["getMember"];
  t: ReturnType<typeof useTranslations<"versionBoard">>;
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
    <FilterPanel
      id={id}
      data-testid="version-board-filter-panel"
    >
      <FilterField label={t("filters.assignee.label")}>
        <span className="relative block min-w-0">
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
            className="h-8 w-full pl-7 text-xs"
            containerClassName="w-full"
            contentClassName="w-56"
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
      </FilterField>

      <FilterField label={t("filters.status.label")} width="sm">
        <span className="relative block min-w-0">
          <Filter className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <SelectMenu
            value={filters.statusCategory ?? ""}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                statusCategory: (event.target.value ||
                  null) as StatusCategory | null,
              }))
            }
            data-testid="version-board-filter-status"
            className="h-8 w-full pl-7 text-xs"
            containerClassName="w-full"
            contentClassName="w-56"
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
      </FilterField>

      <FilterField label={t("filters.type.label")} width="sm">
        <span className="relative block min-w-0">
          <Tags className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <SelectMenu
            value={filters.workItemType ?? ""}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                workItemType: (event.target.value ||
                  null) as WorkItemType | null,
              }))
            }
            data-testid="version-board-filter-type"
            className="h-8 w-full pl-7 text-xs"
            containerClassName="w-full"
            contentClassName="w-44"
            aria-label={typeLabel}
          >
            <option value="">{t("filters.type.all")}</option>
            <option value="TASK">{t("filters.type.TASK")}</option>
            <option value="BUG">{t("filters.type.BUG")}</option>
          </SelectMenu>
        </span>
      </FilterField>

      {hasActiveFilter && (
        <div className="flex h-8 items-center">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            data-testid="version-board-filter-clear"
            onClick={() => setFilters({ ...EMPTY_FILTERS })}
          >
            <XCircle className="h-3 w-3" />
            {t("filters.clear")}
          </Button>
        </div>
      )}
    </FilterPanel>
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
  columnVisibleCounts,
  loadingColumnCategory,
  locale,
  getMember,
  getVersion,
  canCreateNotStartedTask,
  onExpandColumn,
  onCollapseColumn,
  onNewTask,
  onLoadMore,
  openItem,
  t,
  tRoot,
}: {
  grouped: {
    category: StatusCategory;
    items: ViewWorkItemSummary[];
    pageInfo: PageResult<ViewWorkItemSummary>;
    total: number;
  }[];
  columnVisibleCounts: Partial<Record<StatusCategory, number>>;
  loadingColumnCategory: StatusCategory | null;
  locale: string;
  getMember: ReturnType<typeof useSpaceMembers>["getMember"];
  getVersion: (versionId: string) => Version | undefined;
  canCreateNotStartedTask: boolean;
  onExpandColumn: (category: StatusCategory, loadedCount: number) => void;
  onCollapseColumn: (category: StatusCategory) => void;
  onNewTask: () => void;
  onLoadMore: (category: StatusCategory) => void;
  openItem: (summary: ViewWorkItemSummary) => void;
  t: ReturnType<typeof useTranslations<"versionBoard">>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      data-testid="version-board-columns"
      className="grid min-w-0 grid-cols-1 items-start gap-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-6"
    >
      {grouped.map(({ category, items, pageInfo, total }) => {
        const hasMore = items.length < total;
        const isLoadingMore = loadingColumnCategory === category;
        const showCreateTask =
          category === "NOT_STARTED" && canCreateNotStartedTask;
        const visibleCount =
          columnVisibleCounts[category] ?? BOARD_COLUMN_INITIAL_VISIBLE_ITEMS;
        const visibleItems = items.slice(0, visibleCount);
        const hiddenLoadedCount = items.length - visibleItems.length;
        const hasHiddenLoaded = hiddenLoadedCount > 0;
        const expandCount = Math.min(
          BOARD_COLUMN_EXPAND_STEP,
          hiddenLoadedCount,
        );
        const isExpanded =
          visibleItems.length > BOARD_COLUMN_INITIAL_VISIBLE_ITEMS;

        return (
          <div
            key={category}
            data-testid={`version-board-column-${category}`}
            className="flex min-w-0 flex-col rounded-lg border border-border bg-card/30"
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  getStatusCategoryDotClass(category),
                )}
              />
              <h2 className="text-[13px] font-semibold">
                {t(`columns.${category}`)}
              </h2>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {total}
              </span>
            </header>
            <div
              data-testid={`version-board-column-items-${category}`}
              className="space-y-2 p-2"
            >
              {showCreateTask ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-start border border-dashed border-border/80 bg-background/60 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  data-testid={`version-board-column-create-task-${category}`}
                  onClick={onNewTask}
                >
                  <Plus className="h-3 w-3" />
                  {t("newWorkItem")}
                </Button>
              ) : null}
              {items.length === 0 && !showCreateTask && (
                <div className="flex h-20 items-center justify-center text-[11px] text-muted-foreground">
                  —
                </div>
              )}
              {visibleItems.map((item) => {
                const viewItem = createWorkItemViewModelMapper({
                  locale,
                  lookups: {
                    getMember: (userId) => getMember(userId),
                    getVersion: (versionId) => getVersion(versionId),
                  },
                  workflowStateLabel: (state) =>
                    translateWorkflowStateName(tRoot, state),
                })(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`version-board-card-${item.id}`}
                    onClick={() => openItem(item)}
                    className="group block w-full min-w-0 rounded-md border border-border bg-card p-2.5 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <div className="flex items-center gap-1.5">
                      {item.type === "BUG" ? (
                        <Bug className="h-3 w-3 text-destructive/80" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3 text-primary/80" />
                      )}
                      <span
                        data-testid={`version-board-card-code-${item.id}`}
                        className="max-w-[5.5rem] shrink-0 truncate font-mono text-[10px] text-foreground"
                      >
                        {viewItem.code}
                      </span>
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
                    <div className="mt-2 flex min-w-0">
                      <StatusBadge
                        category={viewItem.statusCategory}
                        label={viewItem.statusLabel}
                        className="max-w-full text-[9px]"
                      />
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
              {hasHiddenLoaded ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full text-xs"
                  data-testid={`version-board-column-expand-${category}`}
                  onClick={() => onExpandColumn(category, items.length)}
                >
                  <ChevronDown className="h-3 w-3" />
                  {t("pagination.columnExpandMore", {
                    count: expandCount,
                  })}
                </Button>
              ) : null}
              {!hasHiddenLoaded && hasMore ? (
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
              {isExpanded ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full text-xs text-muted-foreground"
                  data-testid={`version-board-column-collapse-${category}`}
                  onClick={() => onCollapseColumn(category)}
                >
                  <ChevronUp className="h-3 w-3" />
                  {t("pagination.columnCollapse")}
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
        const displayCode = resolveRequirementDisplayCode(req, {
          draftLabel: tRequirementStatus("DRAFT"),
        });
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
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    data-testid={`version-requirement-code-${req.id}`}
                    className="shrink-0 font-mono text-[11px] text-muted-foreground"
                  >
                    {displayCode}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {req.title || req.id}
                  </span>
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
  tTimelineEvent: ReturnType<typeof useTranslations<"common.timeline.event">>;
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
      {events.map((event) => (
        <TimelineEventItem
          key={event.id}
          event={event}
          locale={locale}
          testId={`version-timeline-row-${event.id}`}
          translateEventType={tTimelineEvent}
          unknownActorLabel={t("timeline.unknownActor")}
        />
      ))}
    </ul>
  );
}
