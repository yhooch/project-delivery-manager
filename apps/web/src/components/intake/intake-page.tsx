"use client";

import type {
  IntakeItem,
  IntakeStatus,
  Priority,
  StatusCategory,
} from "@project-delivery/shared";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Pencil,
  Plus,
  Target,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { useListKeyboardNav } from "../../lib/hooks/use-list-keyboard-nav";
import {
  acceptIntakeItem,
  deferIntakeItem,
  getIntakeItem,
  listIntakeItems,
  rejectIntakeItem,
} from "../../lib/intake-service";
import { cn } from "../../lib/utils";
import { listWorkItems } from "../../lib/work-item-service";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
  const canWriteIntake = currentSpaceRole ? currentSpaceRole !== "VIEWER" : true;
  const recentScope = useMemo(
    () => ({ organizationId, spaceId }),
    [organizationId, spaceId],
  );

  const [items, setItems] = useState<IntakeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [active, setActive] = useState<IntakeItem | null>(null);
  const [actionInFlight, setActionInFlight] = useState<StatusActionKind | null>(
    null,
  );
  const [viewTasksInFlight, setViewTasksInFlight] = useState(false);
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [hasLoadedItems, setHasLoadedItems] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState<IntakeItem | null>(null);
  const [handledDeepLinkKey, setHandledDeepLinkKey] = useState<string | null>(
    null,
  );

  const loadItems = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setIsLoading(true);
    setHasLoadedItems(false);
    setErrorKey(null);

    try {
      const page = await listIntakeItems({ spaceId, page: 1, pageSize: 100 });
      setItems(page.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
      setHasLoadedItems(true);
    }
  }, [spaceId]);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !spaceId) {
      return;
    }
    void loadItems();
  }, [loadItems, sessionStatus, spaceId]);

  const filtered = useMemo(() => {
    if (filter === "all") {
      return items;
    }
    return items.filter((item) => item.status === filter);
  }, [filter, items]);

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
      recordRecentOpen(
        {
          id: item.id,
          type: "INTAKE",
          code: formatItemCode(item.id),
          title: item.title,
          href: "/intake-items",
        },
        recentScope,
      );
      setActive(item);
    },
    [recentScope],
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
    onSubmit: (item) => {
      if (!canWriteIntake) {
        return;
      }
      if (item.status === "PENDING") {
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
    }
  }

  async function handleStatusAction(
    action: StatusActionKind,
    target: IntakeItem | null = active,
  ) {
    if (!target || !spaceId || !canWriteIntake) {
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
      const context = { intakeItemId: target.id, spaceId };
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
      void loadItems();
    } catch (error) {
      setItems(original);
      setActive((current) => (current?.id === target.id ? target : current));
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setActionInFlight(null);
    }
  }

  function openConvertDialog() {
    if (!active || !canWriteIntake) {
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

  async function handleViewConvertedTasks(target: IntakeItem | null = active) {
    if (!target || !spaceId || target.status !== "CONVERTED") {
      return;
    }

    setViewTasksInFlight(true);

    try {
      const related = await listWorkItems({
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

  const headerActions = canWriteIntake ? (
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
        onRetry={() => void loadItems()}
        retryLabel={t("actions.retry")}
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        title={t("states.empty.title")}
        description={t("states.empty.description")}
      />
    );
  } else {
    body = (
      <ul data-testid="intake-list" className="divide-y divide-border">
        {filtered.map((item) => (
          <li key={item.id} data-testid={`intake-row-${item.id}`}>
            <button
              type="button"
              onClick={() => openItem(item)}
              className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-muted/40 cursor-pointer"
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
              <span className="flex-1 truncate text-[13px] font-medium">
                {item.title}
              </span>
              <Badge variant="outline" className="hidden md:inline-flex">
                {tIntakeItems(`sourceType.${item.sourceType}`)}
              </Badge>
              <StatusBadge
                category={intakeStatusToCategory[item.status]}
                label={tIntakeItems(`status.${item.status}`)}
                withDot={false}
              />
              {item.versionId && (
                <span className="hidden gap-1 text-[11px] text-muted-foreground md:inline-flex">
                  <GitBranch className="h-2.5 w-2.5" />
                  {shortenId(item.versionId)}
                </span>
              )}
              <Avatar className="h-5 w-5 shrink-0">
                <AvatarFallback className="text-[9px]">
                  {initialOf(item.reporterId)}
                </AvatarFallback>
              </Avatar>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div data-testid="intake-page" className="flex h-full flex-col">
      <PageHeader
        eyebrow={tNav("group.document")}
        title={tNav("intake")}
        description={t("page.description")}
        actions={headerActions}
      />

      {sessionStatus === "authenticated" && spaceId && !errorKey && (
        <div className="flex items-center gap-1 border-b border-border px-6 py-3">
          {buckets.map((b) => (
            <button
              key={b.key}
              type="button"
              data-testid={`intake-filter-${b.key}`}
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
      )}

      <div className="flex-1 overflow-y-auto">{body}</div>

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
                      {shortenId(active.versionId)}
                    </Badge>
                  )}
                </div>
              </SheetHeader>

              <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-5 py-2.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("detail.actions")}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {canWriteIntake && (
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
                  {canWriteIntake && active.status === "PENDING" && (
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
                  {canWriteIntake && active.status === "ACCEPTED" && (
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

              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
                  <FieldRow
                    icon={Users}
                    label={t("detail.reporter")}
                    value={shortenId(active.reporterId)}
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
                        ? shortenId(active.versionId)
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
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {spaceId && canWriteIntake && (
        <CreateIntakeDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          spaceId={spaceId}
          onCreated={() => {
            void loadItems();
          }}
        />
      )}

      {spaceId && canWriteIntake && (
        <EditIntakeDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          spaceId={spaceId}
          intakeItem={active}
          onUpdated={handleUpdatedIntakeItem}
        />
      )}

      {spaceId && canWriteIntake && (
        <ConvertIntakeDialog
          open={convertOpen}
          onOpenChange={(next) => {
            setConvertOpen(next);
            if (!next) {
              setConvertTarget(null);
            }
          }}
          spaceId={spaceId}
          intakeItem={convertTarget}
          onConverted={() => {
            void loadItems();
          }}
        />
      )}
    </div>
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

function shortenId(id: string): string {
  if (id.length <= 8) {
    return id;
  }
  return id.slice(-6);
}

function formatItemCode(id: string): string {
  return `INK-${shortenId(id)}`.toUpperCase();
}

function initialOf(id: string): string {
  return id.charAt(0).toUpperCase();
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
