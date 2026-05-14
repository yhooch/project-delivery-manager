"use client";

import type {
  GetVersionBoardViewResponse,
  StatusCategory,
  Version,
  ViewWorkItemSummary,
} from "@project-delivery/shared";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  ChevronDown,
  Filter,
  Plus,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import type { MockWorkItem } from "../../lib/v2/mock-data";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { listVersions } from "../../lib/version-service";
import { getVersionBoardView } from "../../lib/view-service";
import { toMockWorkItem } from "../workbench/my-workbench";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";
import { PageHeader } from "../v2/page-header";

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

const priorityDotColor: Record<MockWorkItem["priority"], string> = {
  LOW: "bg-muted-foreground/40",
  MEDIUM: "bg-info",
  HIGH: "bg-warning",
  URGENT: "bg-destructive",
};

export function VersionBoard() {
  const t = useTranslations("versionBoard");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { session, currentSpace } = useSession();
  const organizationId = session?.defaultOrganizationId;
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;

  const [versions, setVersions] = useState<Version[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [board, setBoard] = useState<GetVersionBoardViewResponse | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<MockWorkItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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
      // Default-select first version (or keep existing if still in list)
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
      });
      setBoard(next);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoadingBoard(false);
    }
  }, [organizationId, spaceId, versionId]);

  useEffect(() => {
    if (versionId) void fetchBoard();
  }, [fetchBoard, versionId]);

  const grouped = useMemo(() => {
    const items = board?.items.items ?? [];
    return COLUMN_ORDER.map((category) => ({
      category,
      items: items.filter((it) => it.currentStatus.statusCategory === category),
      total:
        board?.columns.find((c) => c.statusCategory === category)?.total ?? 0,
    }));
  }, [board]);

  const currentVersion = useMemo(
    () => versions.find((v) => v.id === versionId) ?? null,
    [versionId, versions],
  );

  const openItem = (summary: ViewWorkItemSummary) => {
    setActiveItem(toMockWorkItem(locale)(summary));
    setSheetOpen(true);
  };

  const headerActions = (
    <>
      {versions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs">
              {currentVersion?.name ?? t("selectVersion")}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {versions.map((v) => (
              <DropdownMenuItem
                key={v.id}
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
      <Button variant="outline" size="sm" className="text-xs" disabled>
        <Users className="h-3 w-3" />
        {t("filterAll")}
      </Button>
      <Button variant="outline" size="sm" className="text-xs" disabled>
        <Filter className="h-3 w-3" />
        {t("filterTask")}
      </Button>
      <Button
        size="sm"
        className="text-xs"
        onClick={() => alert("TODO")}
      >
        <Plus className="h-3 w-3" />
        {t("newWorkItem")}
      </Button>
    </>
  );

  let body;
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
  } else if (errorKey) {
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
  } else if (!versionId) {
    body = (
      <EmptyState
        title={t("states.pickVersion.title")}
        description={t("states.pickVersion.description")}
      />
    );
  } else if (isLoadingBoard && !board) {
    body = <LoadingState label={t("states.loadingBoard")} />;
  } else {
    body = (
      <div className="flex h-full min-w-max gap-3 px-6 py-4">
        {grouped.map(({ category, items, total }) => (
          <div
            key={category}
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
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto h-5 w-5"
                onClick={() => alert("TODO")}
              >
                <Plus className="h-3 w-3" />
              </Button>
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow={tShell("group.deliver")}
        title={t("title")}
        description={t("subtitle")}
        actions={headerActions}
      />
      <div className="flex-1 overflow-x-auto overflow-y-hidden">{body}</div>
      <TaskDetailSheet
        item={activeItem}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
