"use client";

import type {
  GetSpaceExceptionsViewResponse,
  SpaceExceptionItem,
  ViewExceptionType,
} from "@project-delivery/shared";
import {
  Bug,
  CheckCircle2,
  Clock,
  PauseCircle,
  Settings2,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { useListKeyboardNav } from "../../lib/hooks/use-list-keyboard-nav";
import { getSpace } from "../../lib/space-service";
import { cn } from "../../lib/utils";
import type { WorkItemViewModel } from "../../lib/v2/work-item-view-model";
import { getSpaceExceptionsView } from "../../lib/view-service";
import { toMockWorkItem } from "../workbench/my-workbench";
import { useSession } from "../providers/session-provider";
import { recordRecentOpen } from "../shell/recent-opens";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { TaskDetailSheet } from "../work-item/task-detail-sheet";
import { PageHeader } from "../v2/page-header";
import { EmptyState, ErrorState, LoadingState } from "../v2/states";

import { ThresholdEditorDialog } from "./threshold-editor-dialog";

function canManageSpaceThreshold(role: string | undefined): boolean {
  return role === "SPACE_ADMIN" || role === "PM";
}

type Tone =
  | "destructive"
  | "warning"
  | "info"
  | "success"
  | "primary"
  | "default";

const tabs: {
  key: ViewExceptionType;
  icon: LucideIcon;
  tone: Tone;
}[] = [
  { key: "overdue", icon: Timer, tone: "destructive" },
  { key: "blocked", icon: PauseCircle, tone: "warning" },
  { key: "pending_confirm", icon: CheckCircle2, tone: "info" },
  { key: "pending_regression", icon: Bug, tone: "info" },
  { key: "stale", icon: Clock, tone: "default" },
];

const toneClass: Record<Tone, string> = {
  destructive: "text-destructive",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  primary: "text-primary",
  default: "text-muted-foreground",
};

export function ExceptionsPage() {
  const t = useTranslations("spaceExceptions");
  const tNav = useTranslations("shell.nav");
  const tStatusCategory = useTranslations("workItems.statusCategory");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { currentSpace, session } = useSession();
  const [view, setView] = useState<GetSpaceExceptionsViewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [active, setActive] = useState<WorkItemViewModel | null>(null);
  const [open, setOpen] = useState(false);
  const [tabValue, setTabValue] = useState<ViewExceptionType>(tabs[0].key);
  const [thresholdValue, setThresholdValue] = useState<number | null>(null);
  const [thresholdOpen, setThresholdOpen] = useState(false);

  const organizationId = session?.defaultOrganizationId;
  const spaceId = session?.defaultSpaceId;
  const canEditThreshold = canManageSpaceThreshold(currentSpace?.role);

  const fetchView = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const next = await getSpaceExceptionsView({
        spaceId,
        organizationId,
        page: 1,
        pageSize: 100,
      });
      setView(next);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, spaceId]);

  useEffect(() => {
    if (!spaceId) {
      setThresholdValue(null);
      return;
    }

    let isActive = true;
    void (async () => {
      try {
        const nextSpace = await getSpace(spaceId);
        if (isActive) {
          setThresholdValue(nextSpace.settings.staleThresholdDays);
        }
      } catch {
        // silent — button still functions; dialog falls back to default value
      }
    })();

    return () => {
      isActive = false;
    };
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId) {
      setView(null);
      return;
    }

    let isActive = true;

    async function load() {
      setIsLoading(true);
      setErrorKey(null);

      try {
        const next = await getSpaceExceptionsView({
          spaceId: spaceId!,
          organizationId,
          page: 1,
          pageSize: 100,
        });

        if (isActive) {
          setView(next);
        }
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
  }, [organizationId, spaceId]);

  const grouped = useMemo(() => {
    const items = view?.items.items ?? [];
    return tabs.map((tab) => {
      const exceptionItems = items.filter((item) =>
        item.exceptions.some((signal) => signal.type === tab.key),
      );
      const countFromCounts = view?.counts.find(
        (entry) => entry.exceptionType === tab.key,
      )?.count;
      return {
        ...tab,
        items: exceptionItems,
        count: countFromCounts ?? exceptionItems.length,
      };
    });
  }, [view]);

  const visibleItems = useMemo(
    () => grouped.find((tab) => tab.key === tabValue)?.items ?? [],
    [grouped, tabValue],
  );

  const buildExceptionViewModel = useCallback(
    (item: SpaceExceptionItem): WorkItemViewModel => {
      const mock = toMockWorkItem(locale, undefined, tStatusCategory)(
        item.workItem,
      );
      const blockedSignal = item.exceptions.find(
        (signal) => signal.type === "blocked",
      );
      return {
        ...mock,
        isBlocked: mock.isBlocked || Boolean(blockedSignal),
        blockedReason: mock.blockedReason ?? blockedSignal?.reason,
      };
    },
    [locale, tStatusCategory],
  );

  const rememberWorkItem = useCallback(
    (item: WorkItemViewModel) => {
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
    },
    [organizationId, spaceId],
  );

  const openExceptionItem = useCallback(
    (item: SpaceExceptionItem) => {
      const next = buildExceptionViewModel(item);
      rememberWorkItem(next);
      setActive(next);
      setOpen(true);
    },
    [buildExceptionViewModel, rememberWorkItem],
  );

  useListKeyboardNav<SpaceExceptionItem>({
    items: visibleItems,
    activeId: active?.id,
    getId: (item) => item.workItem.id,
    onSelect: (item) => {
      setActive(buildExceptionViewModel(item));
    },
    onOpen: openExceptionItem,
    onEdit: openExceptionItem,
    onClose: () => setOpen(false),
  });

  const headerActions = (
    <Button
      variant="outline"
      size="sm"
      className="text-xs"
      data-testid="exceptions-threshold-button"
      disabled={!canEditThreshold}
      title={canEditThreshold ? undefined : t("threshold.readonly")}
      onClick={() => setThresholdOpen(true)}
    >
      <Settings2 className="h-3 w-3" />
      {t("threshold.title")}
      {thresholdValue !== null && (
        <span className="ml-1 text-[10px] text-muted-foreground">
          {t("threshold.readonlyValue", { count: thresholdValue })}
        </span>
      )}
    </Button>
  );

  const pageDescription = t("page.description");

  if (!session) {
    return (
      <div data-testid="exceptions-page" className="flex h-full flex-col">
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("exceptions")}
          description={pageDescription}
        />
        <div className="flex-1 px-6 py-6">
          <EmptyState
            title={t("states.unauthenticated.title")}
            description={t("states.unauthenticated.description")}
          />
        </div>
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div data-testid="exceptions-page" className="flex h-full flex-col">
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("exceptions")}
          description={pageDescription}
        />
        <div className="flex-1 px-6 py-6">
          <EmptyState
            title={t("states.noSpaceSelected.title")}
            description={t("states.noSpaceSelected.description")}
          />
        </div>
      </div>
    );
  }

  if (isLoading && !view) {
    return (
      <div data-testid="exceptions-page" className="flex h-full flex-col">
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("exceptions")}
          description={pageDescription}
          actions={headerActions}
        />
        <div className="flex-1 px-6 py-6">
          <LoadingState label={t("states.loadingList")} />
        </div>
      </div>
    );
  }

  if (errorKey) {
    return (
      <div data-testid="exceptions-page" className="flex h-full flex-col">
        <PageHeader
          eyebrow={tNav("group.deliver")}
          title={tNav("exceptions")}
          description={pageDescription}
          actions={headerActions}
        />
        <div className="flex-1 px-6 py-6">
          <ErrorState
            title={t("errorTitle")}
            message={tRoot(errorKey)}
            onRetry={() => void fetchView()}
          />
        </div>
      </div>
    );
  }

  const handleSelect = (item: SpaceExceptionItem) => {
    openExceptionItem(item);
  };

  return (
    <div data-testid="exceptions-page" className="flex h-full flex-col">
      <PageHeader
        eyebrow={tNav("group.deliver")}
        title={tNav("exceptions")}
        description={pageDescription}
        actions={headerActions}
      />

      <Tabs
        value={tabValue}
        onValueChange={(next) => setTabValue(next as ViewExceptionType)}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <TabsList className="px-6">
          {grouped.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="gap-1.5"
                data-testid={`exceptions-tab-${tab.key}`}
              >
                <Icon className={cn("h-3 w-3", toneClass[tab.tone])} />
                {tRoot(`m4Views.exceptionType.${tab.key}`)}
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {tab.count}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {grouped.map((tab) => (
          <TabsContent
            key={tab.key}
            value={tab.key}
            data-testid={`exceptions-panel-${tab.key}`}
            className="mt-0 flex-1 overflow-y-auto"
          >
            {tab.items.length === 0 ? (
              <EmptyState
                title={t("states.empty.title")}
                description={t("states.empty.description")}
              />
            ) : (
              <ul
                data-testid={`exceptions-list-${tab.key}`}
                className="divide-y divide-border"
              >
                {tab.items.map((item) => {
                  const mock = buildExceptionViewModel(item);
                  const matchedSignal = item.exceptions.find(
                    (signal) => signal.type === tab.key,
                  );
                  const exceptionDetail = matchedSignal?.reason;

                  return (
                    <li
                      key={item.workItem.id}
                      data-testid={`exceptions-row-${tab.key}-${item.workItem.id}`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect(item)}
                        className="flex w-full items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-muted/40 cursor-pointer"
                      >
                        {mock.type === "BUG" ? (
                          <Bug className="h-3.5 w-3.5 shrink-0 text-destructive/80" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                        )}
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {mock.code}
                        </span>
                        <span className="flex-1 truncate text-[13px] font-medium">
                          {mock.title}
                        </span>
                        {exceptionDetail && (
                          <span
                            className={cn(
                              "hidden text-[11px] md:inline-block",
                              toneClass[tab.tone],
                            )}
                          >
                            {exceptionDetail}
                          </span>
                        )}
                        <StatusBadge
                          category={mock.statusCategory}
                          label={mock.statusLabel}
                          withDot={false}
                        />
                        {mock.versionName && (
                          <Badge
                            variant="outline"
                            className="hidden md:inline-flex"
                          >
                            {mock.versionName}
                          </Badge>
                        )}
                        <Avatar className="h-5 w-5 shrink-0">
                          <AvatarFallback className="text-[9px]">
                            {mock.assignee.initial}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <TaskDetailSheet
        item={active}
        open={open}
        onOpenChange={setOpen}
        onChanged={() => {
          void fetchView();
        }}
      />

      {spaceId && (
        <ThresholdEditorDialog
          initialValue={thresholdValue ?? 3}
          onClose={() => setThresholdOpen(false)}
          onSaved={(nextValue) => {
            setThresholdValue(nextValue);
            setThresholdOpen(false);
            void fetchView();
          }}
          open={thresholdOpen}
          spaceId={spaceId}
        />
      )}
    </div>
  );
}
