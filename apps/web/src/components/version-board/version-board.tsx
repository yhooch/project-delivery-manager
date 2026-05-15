"use client";

import type {
  GetVersionBoardViewResponse,
  Requirement,
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
  ChevronDown,
  Clock,
  Filter,
  Pencil,
  Plus,
  Users,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { ApiClientError } from "../../lib/api-client";
import { Link } from "../../i18n/routing";
import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";
import { listRequirements } from "../../lib/requirement-service";
import { listTimeline } from "../../lib/timeline-service";
import { listVersions } from "../../lib/version-service";
import { getVersionBoardView } from "../../lib/view-service";
import { useSpaceMembers } from "../../lib/v2/lookups";
import { toMockWorkItem } from "../workbench/my-workbench";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
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

  const { session, currentSpace } = useSession();
  const organizationId = session?.defaultOrganizationId;
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;

  const { members, getMember } = useSpaceMembers(spaceId, organizationId);

  // ----- versions -----
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // ----- board -----
  const [board, setBoard] = useState<GetVersionBoardViewResponse | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
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

  // ----- tab + dialog state -----
  const [activeTab, setActiveTab] = useState<
    "board" | "requirements" | "timeline"
  >("board");
  const [activeItem, setActiveItem] = useState<WorkItemViewModel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createWorkItemDialogOpen, setCreateWorkItemDialogOpen] =
    useState(false);
  const [createVersionDialogOpen, setCreateVersionDialogOpen] = useState(false);
  const [editVersionDialogOpen, setEditVersionDialogOpen] = useState(false);

  // -------------------------------------------------------------------------
  // Data loaders
  // -------------------------------------------------------------------------

  const fetchVersions = useCallback(async () => {
    if (!spaceId) return;
    setIsLoadingVersions(true);
    setErrorKey(null);
    try {
      const page = await listVersions({
        spaceId,
        organizationId,
        page: 1,
        pageSize: 100,
      });
      setVersions(page.items);
      setVersionId((current) => {
        if (current && page.items.some((v) => v.id === current)) return current;
        return page.items[0]?.id ?? null;
      });
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoadingVersions(false);
    }
  }, [organizationId, spaceId]);

  useEffect(() => {
    void fetchVersions();
  }, [fetchVersions]);

  const fetchBoard = useCallback(async () => {
    if (!versionId) return;
    setIsLoadingBoard(true);
    setErrorKey(null);
    try {
      const next = await getVersionBoardView({
        versionId,
        organizationId,
        spaceId: spaceId ?? undefined,
        page: 1,
        pageSize: 200,
        assigneeId: filters.assigneeId ?? undefined,
        statusCategory: filters.statusCategory ?? undefined,
        workItemType: filters.workItemType ?? undefined,
      });
      setBoard(next);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoadingBoard(false);
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
    if (!versionId || !spaceId) return;
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
      setRequirements(page.items);
    } catch (error) {
      setRequirementsErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoadingRequirements(false);
    }
  }, [organizationId, spaceId, versionId]);

  const fetchTimeline = useCallback(async () => {
    if (!versionId || !spaceId) return;
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
      setTimeline(page.items);
    } catch (error) {
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
      setIsLoadingTimeline(false);
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

  const grouped = useMemo(() => {
    const items = board?.items.items ?? [];
    return COLUMN_ORDER.map((category) => ({
      category,
      items: items.filter((it) => it.currentStatus.statusCategory === category),
      total:
        board?.columns.find((c) => c.statusCategory === category)?.total ?? 0,
    }));
  }, [board]);

  const hasActiveFilter =
    filters.assigneeId !== null ||
    filters.statusCategory !== null ||
    filters.workItemType !== null;

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const openItem = (summary: ViewWorkItemSummary) => {
    const item = toMockWorkItem(locale)(summary);
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
    setSheetOpen(true);
  };

  const handleVersionCreated = (created: Version) => {
    // Optimistically prepend so the dropdown reflects the new version even if
    // the refresh has not yet returned, then refresh authoritative data.
    setVersions((prev) => [created, ...prev.filter((v) => v.id !== created.id)]);
    setVersionId(created.id);
    void fetchVersions();
  };

  const handleVersionUpdated = (updated: Version) => {
    setVersions((prev) =>
      prev.map((v) => (v.id === updated.id ? updated : v)),
    );
    void fetchVersions();
  };

  // -------------------------------------------------------------------------
  // Header meta — flattened from the former <VersionHero> band; lives in the
  // PageHeader's `meta` slot when a version is selected.
  // -------------------------------------------------------------------------

  const owner = currentVersion?.ownerId
    ? getMember(currentVersion.ownerId)
    : undefined;
  const ownerName =
    owner?.user.name ??
    owner?.user.username ??
    currentVersion?.ownerId ??
    "";

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
            <Avatar className="h-5 w-5">
              {owner?.user.avatar && (
                <AvatarImage src={owner.user.avatar} alt={ownerName} />
              )}
              <AvatarFallback className="text-[9px]">
                {initialOf(ownerName)}
              </AvatarFallback>
            </Avatar>
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              data-testid="version-board-version-trigger"
            >
              {currentVersion?.name ?? t("selectVersion")}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {versions.map((v) => (
              <DropdownMenuItem
                key={v.id}
                data-testid={`version-board-version-option-${v.id}`}
                onSelect={() => setVersionId(v.id)}
                className="gap-2"
              >
                <span className="flex-1 truncate">{v.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {v.status}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        data-testid="version-page-edit-version"
        disabled={!currentVersion || !spaceId}
        onClick={() => setEditVersionDialogOpen(true)}
      >
        <Pencil className="h-3 w-3" />
        {t("actions.editVersion")}
      </Button>
      <Button
        size="sm"
        className="text-xs"
        data-testid="version-page-new-version"
        disabled={!spaceId}
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
      <div className="flex flex-1 flex-col overflow-hidden">
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(value as "board" | "requirements" | "timeline")
          }
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-2">
            <TabsList>
              <TabsTrigger value="board" data-testid="version-tab-board">
                {t("tabs.board")}
              </TabsTrigger>
              <TabsTrigger
                value="requirements"
                data-testid="version-tab-requirements"
              >
                {t("tabs.requirements")}
              </TabsTrigger>
              <TabsTrigger value="timeline" data-testid="version-tab-timeline">
                {t("tabs.timeline")}
              </TabsTrigger>
            </TabsList>
            {activeTab === "board" && (
              <BoardToolbar
                filters={filters}
                setFilters={setFilters}
                hasActiveFilter={hasActiveFilter}
                members={members}
                getMember={getMember}
                t={t}
                spaceId={spaceId}
                onNewWorkItem={() => setCreateWorkItemDialogOpen(true)}
              />
            )}
          </div>

          <TabsContent
            value="board"
            className="mt-0 flex flex-1 flex-col overflow-hidden"
          >
            <div className="flex-1 overflow-x-auto overflow-y-hidden">
              {isLoadingBoard && !board ? (
                <LoadingState label={t("states.loadingBoard")} />
              ) : (
                <BoardColumns
                  grouped={grouped}
                  locale={locale}
                  openItem={openItem}
                  t={t}
                />
              )}
            </div>
          </TabsContent>

          <TabsContent
            value="requirements"
            className="mt-0 flex-1 overflow-y-auto"
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

          <TabsContent
            value="timeline"
            className="mt-0 flex-1 overflow-y-auto"
          >
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

  return (
    <div data-testid="version-board-page" className="flex h-full flex-col">
      <PageHeader
        eyebrow={tShell("group.deliver")}
        title={t("title")}
        description={t("subtitle")}
        actions={headerActions}
        meta={headerMeta}
      />
      <div className="flex flex-1 flex-col overflow-hidden">{body}</div>
      <TaskDetailSheet
        item={activeItem}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={() => {
          void fetchBoard();
        }}
      />
      {spaceId && (
        <>
          <CreateTaskDialog
            open={createWorkItemDialogOpen}
            onOpenChange={setCreateWorkItemDialogOpen}
            spaceId={spaceId}
            initialVersionId={versionId ?? undefined}
            onCreated={() => {
              void fetchBoard();
            }}
          />
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
      )}
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
  onNewWorkItem,
}: {
  filters: BoardFilters;
  setFilters: (next: BoardFilters | ((prev: BoardFilters) => BoardFilters)) => void;
  hasActiveFilter: boolean;
  members: ReturnType<typeof useSpaceMembers>["members"];
  getMember: ReturnType<typeof useSpaceMembers>["getMember"];
  t: ReturnType<typeof useTranslations<"versionBoard">>;
  spaceId?: string;
  onNewWorkItem: () => void;
}) {
  const assigneeLabel = filters.assigneeId
    ? (getMember(filters.assigneeId)?.user.name ??
      getMember(filters.assigneeId)?.user.username ??
      filters.assigneeId)
    : t("filters.assignee.all");

  const statusLabel = filters.statusCategory
    ? t(`columns.${filters.statusCategory}`)
    : t("filters.status.all");

  const typeLabel = filters.workItemType
    ? t(`filters.type.${filters.workItemType}`)
    : t("filters.type.all");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Assignee filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            data-testid="version-board-filter-assignee"
          >
            <Users className="h-3 w-3" />
            {assigneeLabel}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            data-testid="version-board-filter-assignee-all"
            onSelect={() =>
              setFilters((prev) => ({ ...prev, assigneeId: null }))
            }
          >
            {t("filters.assignee.all")}
          </DropdownMenuItem>
          {members.map((member) => (
            <DropdownMenuItem
              key={member.userId}
              data-testid={`version-board-filter-assignee-${member.userId}`}
              onSelect={() =>
                setFilters((prev) => ({
                  ...prev,
                  assigneeId: member.userId,
                }))
              }
              className="gap-2"
            >
              <span className="flex-1 truncate">
                {member.user.name || member.user.username}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Status-category filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            data-testid="version-board-filter-status"
          >
            <Filter className="h-3 w-3" />
            {statusLabel}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            data-testid="version-board-filter-status-all"
            onSelect={() =>
              setFilters((prev) => ({ ...prev, statusCategory: null }))
            }
          >
            {t("filters.status.all")}
          </DropdownMenuItem>
          {COLUMN_ORDER.map((category) => (
            <DropdownMenuItem
              key={category}
              data-testid={`version-board-filter-status-${category}`}
              onSelect={() =>
                setFilters((prev) => ({
                  ...prev,
                  statusCategory: category,
                }))
              }
            >
              {t(`columns.${category}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Work-item type filter */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            data-testid="version-board-filter-type"
          >
            <Bug className="h-3 w-3" />
            {typeLabel}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem
            data-testid="version-board-filter-type-all"
            onSelect={() =>
              setFilters((prev) => ({ ...prev, workItemType: null }))
            }
          >
            {t("filters.type.all")}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="version-board-filter-type-TASK"
            onSelect={() =>
              setFilters((prev) => ({ ...prev, workItemType: "TASK" }))
            }
          >
            {t("filters.type.TASK")}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="version-board-filter-type-BUG"
            onSelect={() =>
              setFilters((prev) => ({ ...prev, workItemType: "BUG" }))
            }
          >
            {t("filters.type.BUG")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
        disabled={!spaceId}
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
  locale,
  openItem,
  t,
}: {
  grouped: { category: StatusCategory; items: ViewWorkItemSummary[]; total: number }[];
  locale: string;
  openItem: (summary: ViewWorkItemSummary) => void;
  t: ReturnType<typeof useTranslations<"versionBoard">>;
}) {
  return (
    <div className="flex h-full min-w-max gap-3 px-6 py-4">
      {grouped.map(({ category, items, total }) => (
        <div
          key={category}
          data-testid={`version-board-column-${category}`}
          className="flex h-full w-[280px] shrink-0 flex-col rounded-lg border border-border bg-card/30"
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
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            {items.length === 0 && (
              <div className="flex h-20 items-center justify-center text-[11px] text-muted-foreground">
                —
              </div>
            )}
            {items.map((item) => {
              const mock = toMockWorkItem(locale)(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`version-board-card-${item.id}`}
                  onClick={() => openItem(item)}
                  className="group block w-full rounded-md border border-border bg-card p-2.5 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    {item.type === "BUG" ? (
                      <Bug className="h-3 w-3 text-destructive/80" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 text-primary/80" />
                    )}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {mock.code}
                    </span>
                    <span
                      className={cn(
                        "ml-auto h-1.5 w-1.5 rounded-full",
                        priorityDotColor[mock.priority],
                      )}
                    />
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug">
                    {item.title}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {item.exceptionSignals.some((s) => s.type === "blocked") && (
                      <Badge variant="warning" className="gap-1 text-[9px]">
                        <AlertCircle className="h-2 w-2" />
                        {t("badges.blocked")}
                      </Badge>
                    )}
                    {item.exceptionSignals.some((s) => s.type === "overdue") && (
                      <Badge variant="destructive" className="text-[9px]">
                        {t("badges.overdue")}
                      </Badge>
                    )}
                    <Avatar className="ml-auto h-5 w-5">
                      <AvatarFallback className="text-[9px]">
                        {mock.assignee.initial}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
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
        const ownerName =
          owner?.user.name ?? owner?.user.username ?? req.ownerId ?? "—";
        return (
          <li
            key={req.id}
            data-testid={`version-requirement-row-${req.id}`}
            className="px-6 py-3"
          >
            <Link
              href={`/requirements/${req.id}`}
              className="flex items-center gap-3 hover:opacity-90"
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
              <span className="text-[11px] text-muted-foreground">
                {ownerName}
              </span>
              <span className="text-[11px] text-muted-foreground">
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
  tTimelineEvent: ReturnType<typeof useTranslations<"versionBoard.timeline.event">>;
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
            <Avatar className="h-7 w-7">
              {event.actor.avatar && (
                <AvatarImage src={event.actor.avatar} alt={actorName} />
              )}
              <AvatarFallback>{initialOf(actorName)}</AvatarFallback>
            </Avatar>
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
