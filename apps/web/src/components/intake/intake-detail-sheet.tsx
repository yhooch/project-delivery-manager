"use client";

import type {
  Comment,
  IntakeItem,
  IntakeStatus,
  SpaceMemberWithUser,
  StatusCategory,
  TimelineEvent,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Link2,
  Loader2,
  MessageSquare,
  Send,
  Target,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toCreateCommentRequest } from "../../lib/comment-forms";
import { createComment, listComments } from "../../lib/comment-service";
import { formatDisplayCode } from "../../lib/display-code";
import { getIntakeItem } from "../../lib/intake-service";
import { cn } from "../../lib/utils";
import { listTimeline } from "../../lib/timeline-service";
import {
  useRelationTitle,
  useSpaceMembers,
  useVersions,
} from "../../lib/v2/lookups";
import { listWorkItems } from "../../lib/work-item-service";
import { Link } from "../../i18n/routing";

import { ObjectTagAssignmentField } from "../tag";
import { TimelineEventItem } from "../timeline/timeline-event-item";
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
import { EmptyState, ErrorState, LoadingState } from "../v2/states";

const RELATED_TASKS_PAGE_SIZE = 10;
const INITIAL_RELATED_TASKS_PAGE_INFO = {
  page: 1,
  pageSize: RELATED_TASKS_PAGE_SIZE,
  total: 0,
};

const intakeStatusToCategory: Record<IntakeStatus, StatusCategory> = {
  PENDING: "NOT_STARTED",
  ACCEPTED: "IN_PROGRESS",
  DEFERRED: "WAITING",
  REJECTED: "TERMINATED",
  CONVERTED: "DONE",
};

export type IntakeDetailSheetProps = {
  actionBar?: React.ReactNode;
  actionErrorMessage?: string | null;
  canComment?: boolean;
  canEditTags?: boolean;
  intakeItem?: IntakeItem | null;
  intakeItemId?: string;
  onItemChange?: (item: IntakeItem) => void;
  onOpenChange: (open: boolean) => void;
  onOpenWorkItem?: (item: WorkItem) => void;
  open: boolean;
  organizationId?: string;
  relatedTasksRefreshVersion?: number;
  showRelatedTasksListLink?: boolean;
  spaceId?: string;
  testId?: string;
};

export function IntakeDetailSheet({
  actionBar,
  actionErrorMessage,
  canComment = false,
  canEditTags = false,
  intakeItem,
  intakeItemId,
  onItemChange,
  onOpenChange,
  onOpenWorkItem,
  open,
  organizationId,
  relatedTasksRefreshVersion = 0,
  showRelatedTasksListLink = false,
  spaceId,
  testId = "intake-detail-sheet",
}: IntakeDetailSheetProps) {
  const t = useTranslations("intake");
  const tIntakeItems = useTranslations("intakeItems");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { getMember } = useSpaceMembers(spaceId, organizationId);
  const { getVersion } = useVersions(spaceId, organizationId);
  const [loadedItem, setLoadedItem] = useState<IntakeItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [timelineRefreshVersion, setTimelineRefreshVersion] = useState(0);
  const effectiveItem = intakeItem ?? loadedItem;

  function handleTagsChange(tags: IntakeItem["tags"]) {
    if (!effectiveItem) {
      return;
    }

    const updated = { ...effectiveItem, tags };
    setLoadedItem((current) =>
      current?.id === updated.id ? updated : current,
    );
    onItemChange?.(updated);
  }

  useEffect(() => {
    if (!open || intakeItem || !intakeItemId || !spaceId) {
      setLoadedItem(null);
      setLoading(false);
      setLoadFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setLoadedItem(null);

    void getIntakeItem({ intakeItemId, organizationId, spaceId })
      .then((item) => {
        if (!cancelled) {
          setLoadedItem(item);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [intakeItem, intakeItemId, open, organizationId, spaceId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0" data-testid={testId}>
        {loading || loadFailed || !effectiveItem ? (
          <SheetHeader className="sr-only">
            <SheetTitle>{t("detail.sheetDescription")}</SheetTitle>
            <SheetDescription>
              {loading ? t("states.loading") : t("detail.unavailable")}
            </SheetDescription>
          </SheetHeader>
        ) : null}
        {loading ? (
          <LoadingState className="h-full" label={t("states.loading")} />
        ) : loadFailed || !effectiveItem ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t("detail.unavailable")}
          </div>
        ) : (
          <IntakeDetailContent
            actionBar={actionBar}
            actionErrorMessage={actionErrorMessage}
            canComment={canComment}
            canEditTags={canEditTags}
            getMember={getMember}
            getVersion={getVersion}
            intakeItem={effectiveItem}
            locale={locale}
            onTagsChange={handleTagsChange}
            onOpenWorkItem={onOpenWorkItem}
            onTimelineRefresh={() =>
              setTimelineRefreshVersion((version) => version + 1)
            }
            organizationId={organizationId}
            relatedTasksRefreshVersion={relatedTasksRefreshVersion}
            showRelatedTasksListLink={showRelatedTasksListLink}
            spaceId={spaceId}
            t={t}
            tIntakeItems={tIntakeItems}
            timelineRefreshVersion={timelineRefreshVersion}
            tRoot={tRoot}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function IntakeDetailContent({
  actionBar,
  actionErrorMessage,
  canComment,
  canEditTags,
  getMember,
  getVersion,
  intakeItem,
  locale,
  onTagsChange,
  onOpenWorkItem,
  onTimelineRefresh,
  organizationId,
  relatedTasksRefreshVersion,
  showRelatedTasksListLink,
  spaceId,
  t,
  tIntakeItems,
  timelineRefreshVersion,
  tRoot,
}: {
  actionBar?: React.ReactNode;
  actionErrorMessage?: string | null;
  canComment: boolean;
  canEditTags: boolean;
  getMember: (userId: string) => SpaceMemberWithUser | undefined;
  getVersion: (versionId: string) => Version | undefined;
  intakeItem: IntakeItem;
  locale: string;
  onTagsChange: (tags: IntakeItem["tags"]) => void;
  onOpenWorkItem?: (item: WorkItem) => void;
  onTimelineRefresh: () => void;
  organizationId?: string;
  relatedTasksRefreshVersion: number;
  showRelatedTasksListLink: boolean;
  spaceId?: string;
  t: ReturnType<typeof useTranslations<"intake">>;
  tIntakeItems: ReturnType<typeof useTranslations<"intakeItems">>;
  timelineRefreshVersion: number;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  return (
    <>
      <SheetHeader className="px-5 py-4">
        <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
          <Target className="h-3.5 w-3.5" />
          <span>{formatItemCode(intakeItem.id)}</span>
          <ChevronRight className="h-3 w-3" />
          <span>{tIntakeItems(`sourceType.${intakeItem.sourceType}`)}</span>
        </div>
        <SheetTitle className="mt-1 text-base leading-snug">
          {intakeItem.title}
        </SheetTitle>
        {spaceId ? (
          <ObjectTagAssignmentField
            className="mt-2 w-full"
            canEdit={canEditTags}
            onTagsChange={onTagsChange}
            organizationId={organizationId}
            spaceId={spaceId}
            tags={intakeItem.tags}
            targetId={intakeItem.id}
            targetType="INTAKE_ITEM"
            testId="intake-detail-tags"
          />
        ) : null}
        <SheetDescription className="sr-only">
          {t("detail.sheetDescription")}
        </SheetDescription>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge
            category={intakeStatusToCategory[intakeItem.status]}
            label={tIntakeItems(`status.${intakeItem.status}`)}
          />
          <Badge variant="outline">
            {tIntakeItems(`sourceType.${intakeItem.sourceType}`)}
          </Badge>
          {intakeItem.versionId && (
            <Badge variant="outline" className="gap-1">
              <GitBranch className="h-2.5 w-2.5" />
              {displayVersionName(intakeItem.versionId, getVersion)}
            </Badge>
          )}
        </div>
      </SheetHeader>

      {actionBar ? (
        <div className="flex min-w-0 flex-col gap-2 border-b border-border bg-muted/30 px-5 py-2.5 sm:flex-row sm:items-center">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("detail.actions")}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:ml-auto sm:justify-end">
            {actionBar}
          </div>
        </div>
      ) : null}

      {actionErrorMessage && (
        <div className="border-b border-border bg-destructive/5 px-5 py-2 text-[12px] text-destructive">
          {actionErrorMessage}
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          <FieldRow
            icon={Users}
            label={t("detail.reporter")}
            value={displayUserName(intakeItem.reporterId, getMember)}
          />
          <FieldRow
            icon={Users}
            label={t("detail.assignee")}
            value={
              intakeItem.assigneeId
                ? displayUserName(intakeItem.assigneeId, getMember)
                : t("detail.unassigned")
            }
          />
          <FieldRow
            icon={Clock}
            label={t("detail.acceptedAt")}
            value={formatOptionalDateTime(
              intakeItem.acceptedAt,
              locale,
              tRoot("common.emptyValue"),
            )}
          />
          <FieldRow
            icon={GitBranch}
            label={t("detail.version")}
            value={
              intakeItem.versionId
                ? displayVersionName(intakeItem.versionId, getVersion)
                : t("detail.noVersion")
            }
          />
        </div>
        <IntakeTraceabilitySection
          intakeItem={intakeItem}
          organizationId={organizationId}
          spaceId={spaceId}
          t={t}
        />
        <div className="mt-6">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("detail.descriptionTitle")}
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {intakeItem.description ?? t("detail.descriptionEmpty")}
          </p>
        </div>
        <RelatedTasksSection
          intakeItem={intakeItem}
          locale={locale}
          onOpenWorkItem={onOpenWorkItem}
          organizationId={organizationId}
          refreshVersion={relatedTasksRefreshVersion}
          showOpenList={showRelatedTasksListLink}
          spaceId={spaceId}
          t={t}
          tIntakeItems={tIntakeItems}
          tRoot={tRoot}
        />
        <IntakeCommentsSection
          canComment={canComment}
          getMember={getMember}
          intakeItem={intakeItem}
          locale={locale}
          onTimelineRefresh={onTimelineRefresh}
          organizationId={organizationId}
          spaceId={spaceId}
          t={t}
          tIntakeItems={tIntakeItems}
          tRoot={tRoot}
        />
        <IntakeTimelineSection
          intakeItem={intakeItem}
          locale={locale}
          organizationId={organizationId}
          refreshVersion={timelineRefreshVersion}
          spaceId={spaceId}
          t={t}
          tIntakeItems={tIntakeItems}
          tRoot={tRoot}
        />
      </div>
    </>
  );
}

function IntakeTraceabilitySection({
  intakeItem,
  organizationId,
  spaceId,
  t,
}: {
  intakeItem: IntakeItem;
  organizationId?: string;
  spaceId?: string;
  t: ReturnType<typeof useTranslations<"intake">>;
}) {
  const requirementTitle = useRelationTitle(
    "requirement",
    intakeItem.requirementId,
    spaceId,
    organizationId,
  );

  if (!intakeItem.requirementId) {
    return null;
  }

  return (
    <section className="mt-6" data-testid="intake-links-section">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t("detail.linksTitle")}
      </h3>
      <div className="mt-2 grid gap-y-3 text-[13px]">
        <RelationAnchorRow
          href={`/requirements/${intakeItem.requirementId}`}
          label={t("filters.requirement")}
          loading={requirementTitle.loading}
          unavailable={
            Boolean(requirementTitle.error) || !requirementTitle.title
          }
          unavailableLabel={t("detail.unavailable")}
          value={requirementTitle.title}
          loadingLabel={t("detail.loadingTitle")}
          testId="intake-requirement-link"
        />
      </div>
    </section>
  );
}

function RelationAnchorRow({
  href,
  label,
  loading,
  loadingLabel,
  testId,
  unavailable,
  unavailableLabel,
  value,
}: {
  href: string;
  label: string;
  loading: boolean;
  loadingLabel: string;
  testId: string;
  unavailable: boolean;
  unavailableLabel: string;
  value?: string;
}) {
  const displayValue = loading
    ? loadingLabel
    : unavailable
      ? unavailableLabel
      : value;

  return (
    <div className="flex items-center gap-2">
      <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {loading || unavailable ? (
        <span className="ml-auto truncate font-medium text-muted-foreground">
          {displayValue}
        </span>
      ) : (
        <Link
          className="ml-auto cursor-pointer truncate font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid={testId}
          href={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          {displayValue}
        </Link>
      )}
    </div>
  );
}

function RelatedTasksSection({
  intakeItem,
  locale,
  onOpenWorkItem,
  organizationId,
  refreshVersion,
  showOpenList,
  spaceId,
  t,
  tIntakeItems,
  tRoot,
}: {
  intakeItem: IntakeItem;
  locale: string;
  onOpenWorkItem?: (item: WorkItem) => void;
  organizationId?: string;
  refreshVersion: number;
  showOpenList: boolean;
  spaceId?: string;
  t: ReturnType<typeof useTranslations<"intake">>;
  tIntakeItems: ReturnType<typeof useTranslations<"intakeItems">>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const [tasks, setTasks] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [loadMoreErrorKey, setLoadMoreErrorKey] = useState<string | null>(null);
  const [pageInfo, setPageInfo] = useState(INITIAL_RELATED_TASKS_PAGE_INFO);
  const taskScopeKey = useMemo(
    () => `${organizationId ?? ""}:${spaceId ?? ""}:${intakeItem.id}`,
    [intakeItem.id, organizationId, spaceId],
  );
  const latestTaskScopeKeyRef = useRef(taskScopeKey);
  const taskRequestIdRef = useRef(0);
  latestTaskScopeKeyRef.current = taskScopeKey;

  const fetchTasks = useCallback(
    async (page = 1, mode: "replace" | "append" = "replace") => {
      if (!spaceId) {
        setTasks([]);
        setLoading(false);
        setLoadingMore(false);
        setErrorKey(null);
        setLoadMoreErrorKey(null);
        setPageInfo(INITIAL_RELATED_TASKS_PAGE_INFO);
        return;
      }

      const requestId = taskRequestIdRef.current + 1;
      taskRequestIdRef.current = requestId;
      const requestScopeKey = taskScopeKey;
      const append = mode === "append";

      if (append) {
        setLoadingMore(true);
        setLoadMoreErrorKey(null);
      } else {
        setLoading(true);
        setLoadingMore(false);
        setErrorKey(null);
        setLoadMoreErrorKey(null);
      }

      try {
        const result = await listWorkItems({
          intakeItemId: intakeItem.id,
          organizationId,
          page,
          pageSize: RELATED_TASKS_PAGE_SIZE,
          spaceId,
        });
        if (
          taskRequestIdRef.current !== requestId ||
          latestTaskScopeKeyRef.current !== requestScopeKey
        ) {
          return;
        }
        setTasks((current) =>
          append ? [...current, ...result.items] : result.items,
        );
        setPageInfo((current) => ({
          page: result.page ?? page,
          pageSize: result.pageSize ?? RELATED_TASKS_PAGE_SIZE,
          total: result.total ?? (append ? current.total : result.items.length),
        }));
      } catch (error) {
        if (
          taskRequestIdRef.current === requestId &&
          latestTaskScopeKeyRef.current === requestScopeKey
        ) {
          if (append) {
            setLoadMoreErrorKey(getApiErrorMessageKey(error));
          } else {
            setErrorKey(getApiErrorMessageKey(error));
          }
        }
      } finally {
        if (
          taskRequestIdRef.current === requestId &&
          latestTaskScopeKeyRef.current === requestScopeKey
        ) {
          if (append) {
            setLoadingMore(false);
          } else {
            setLoading(false);
          }
        }
      }
    },
    [intakeItem.id, organizationId, spaceId, taskScopeKey],
  );

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks, refreshVersion]);

  const loadedCount = tasks.length;
  const paginationFrom = loadedCount > 0 ? 1 : 0;
  const paginationTo = Math.min(loadedCount, pageInfo.total);
  const hasMoreTasks = loadedCount < pageInfo.total;

  return (
    <section className="mt-6" data-testid="intake-related-tasks-section">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {tIntakeItems("relatedTasks.title")}
        </h3>
        {showOpenList ? (
          <Link
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="intake-related-tasks-open-list"
            href={buildWorkItemsHref({ intakeItemId: intakeItem.id })}
          >
            <Link2 className="h-3 w-3" />
            {tIntakeItems("relatedTasks.openTaskList")}
          </Link>
        ) : null}
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
        <>
          <ul
            className="divide-y divide-border rounded-md border border-border"
            data-testid="intake-related-tasks-list"
          >
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  data-testid="intake-related-task-item"
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenWorkItem?.(task)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {task.title}
                  </span>
                  <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                    {tIntakeItems("relatedTasks.meta", {
                      dueDate: formatOptionalDate(
                        task.dueDate,
                        locale,
                        tIntakeItems("noDueDate"),
                      ),
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
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span
              className="text-[11px] text-muted-foreground"
              data-testid="intake-related-tasks-pagination-summary"
            >
              {t("pagination.summary", {
                from: paginationFrom,
                to: paginationTo,
                total: pageInfo.total,
              })}
            </span>
            {hasMoreTasks && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                data-testid="intake-related-tasks-load-more"
                disabled={loadingMore}
                onClick={() => {
                  void fetchTasks(pageInfo.page + 1, "append");
                }}
              >
                {loadingMore && <Loader2 className="h-3 w-3 animate-spin" />}
                {loadingMore
                  ? t("pagination.loadingMore")
                  : t("pagination.loadMore")}
              </Button>
            )}
          </div>
          {loadMoreErrorKey && (
            <p
              className="mt-2 text-[11px] text-destructive"
              data-testid="intake-related-tasks-load-more-error"
            >
              {tRoot(loadMoreErrorKey)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function IntakeCommentsSection({
  canComment,
  getMember,
  intakeItem,
  locale,
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
  locale: string;
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
    if (!draft.trim() || !spaceId || !canComment) {
      return;
    }

    setSubmitting(true);
    setSubmitErrorKey(null);

    try {
      const request = toCreateCommentRequest({
        body: draft,
        targetId: intakeItem.id,
        targetType: "INTAKE_ITEM",
      });
      const created = await createComment({
        ...request,
        organizationId,
        spaceId,
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
                        {formatOptionalDateTime(
                          comment.createdAt,
                          locale,
                          tRoot("common.emptyValue"),
                        )}
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
  locale,
  organizationId,
  refreshVersion,
  spaceId,
  t,
  tIntakeItems,
  tRoot,
}: {
  intakeItem: IntakeItem;
  locale: string;
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
  const tTimelineEvent = useTranslations("common.timeline.event");

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
              <TimelineEventItem
                key={event.id}
                className="px-3 py-3"
                event={event}
                locale={locale}
                testId="intake-timeline-item"
                translateEventType={tTimelineEvent}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function FieldRow({
  contentClassName,
  icon: Icon,
  label,
  rootClassName,
  value,
}: {
  contentClassName?: string;
  icon: typeof Users;
  label: string;
  rootClassName?: string;
  value: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2", rootClassName)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div
        className={cn(
          "ml-auto min-w-0 font-medium text-foreground",
          contentClassName,
        )}
      >
        {value}
      </div>
    </div>
  );
}

function displayUserName(
  userId: string,
  getMember: (userId: string) => SpaceMemberWithUser | undefined,
): string {
  const member = getMember(userId);
  return member?.user.name ?? member?.user.username ?? "-";
}

function displayVersionName(
  versionId: string,
  getVersion: (versionId: string) => Version | undefined,
): string {
  return getVersion(versionId)?.name ?? "-";
}

function formatOptionalDate(
  value: string | null | undefined,
  locale: string,
  emptyValue: string,
): string {
  if (!value) {
    return emptyValue;
  }

  return formatDate(value, locale) ?? emptyValue;
}

function formatOptionalDateTime(
  value: string | null | undefined,
  locale: string,
  emptyValue: string,
): string {
  if (!value) {
    return emptyValue;
  }

  return formatDateTime(value, locale) ?? emptyValue;
}

function formatDate(value: string, locale: string): string | undefined {
  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      date,
    );
  } catch {
    return undefined;
  }
}

function formatDateTime(value: string, locale: string): string | undefined {
  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  } catch {
    return undefined;
  }
}

function formatItemCode(id: string): string {
  return formatDisplayCode("INTAKE", id);
}

function initialOf(id: string): string {
  return id.trim().charAt(0).toUpperCase() || "?";
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
