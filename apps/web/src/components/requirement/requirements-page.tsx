"use client";

import type { Requirement } from "@project-delivery/shared";
import {
  Archive,
  Clock,
  FileText,
  Filter,
  GitBranch,
  Link2,
  Plus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Link, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { useListKeyboardNav } from "../../lib/hooks/use-list-keyboard-nav";
import {
  createRequirementDraft,
  listRequirements,
} from "../../lib/requirement-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge, type BadgeProps } from "../ui/badge";
import { Button } from "../ui/button";
import { PageHeader } from "../v2/page-header";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  LoadingState,
} from "../v2/states";

type FilterKey = "active" | "DRAFT" | "CONFIRMED" | "ARCHIVED" | "all";

const statusVariant: Record<Requirement["status"], BadgeProps["variant"]> = {
  DRAFT: "default",
  CONFIRMED: "success",
  ARCHIVED: "default",
};

export function RequirementsPage() {
  const t = useTranslations("requirements");
  const tNav = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const router = useRouter();
  const { session, status: sessionStatus } = useSession();
  const spaceId = session?.defaultSpaceId;

  const [items, setItems] = useState<Requirement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("active");
  const [isCreating, setIsCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  const loadItems = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const page = await listRequirements({
        spaceId,
        page: 1,
        pageSize: 100,
        includeDrafts: true,
      });
      setItems(page.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
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
    if (filter === "active") {
      return items.filter((r) => r.status !== "ARCHIVED");
    }
    return items.filter((r) => r.status === filter);
  }, [filter, items]);

  const buckets: { label: string; key: FilterKey }[] = [
    { label: t("filters.active"), key: "active" },
    { label: t("filters.draft"), key: "DRAFT" },
    { label: t("filters.confirmed"), key: "CONFIRMED" },
    { label: t("filters.archived"), key: "ARCHIVED" },
    { label: t("filters.all"), key: "all" },
  ];

  useListKeyboardNav<Requirement>({
    items: filtered,
    activeId,
    getId: (item) => item.id,
    onSelect: (item) => setActiveId(item.id),
    onOpen: (item) => router.push(`/requirements/${item.id}`),
  });

  async function handleCreateDraft() {
    if (!spaceId || isCreating) {
      return;
    }
    setIsCreating(true);
    setErrorKey(null);

    try {
      const draft = await createRequirementDraft({ spaceId }, {});
      router.push(`/requirements/${draft.id}`);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
      setIsCreating(false);
    }
  }

  const headerActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        type="button"
        disabled
      >
        <Filter className="h-3 w-3" />
        {t("page.filter")}
      </Button>
      <Button
        size="sm"
        className="text-xs"
        data-testid="requirements-create-button"
        onClick={() => {
          void handleCreateDraft();
        }}
        type="button"
        disabled={!spaceId || isCreating}
      >
        <Plus className="h-3 w-3" />
        {isCreating ? t("dialog.create.submitting") : t("page.create")}
      </Button>
    </>
  );

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
      <ul data-testid="requirements-list" className="divide-y divide-border">
        {filtered.map((req) => (
          <li key={req.id} data-testid={`requirements-row-${req.id}`}>
            <Link
              href={`/requirements/${req.id}`}
              className={cn(
                "flex w-full items-start gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/40 cursor-pointer",
                activeId === req.id && "bg-muted/40",
              )}
            >
              {req.status === "ARCHIVED" ? (
                <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/80" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatRequirementCode(req.id)}
                  </span>
                  <span className="truncate text-[13px] font-medium">
                    {req.title || t("list.untitled")}
                  </span>
                </div>
                {req.summary && (
                  <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
                    {req.summary}
                  </p>
                )}
              </div>
              <Badge variant={statusVariant[req.status]}>
                {t(`status.${req.status}`)}
              </Badge>
              {req.versionId && (
                <Badge variant="outline" className="hidden gap-1 md:inline-flex">
                  <GitBranch className="h-2.5 w-2.5" />
                  {shortenId(req.versionId)}
                </Badge>
              )}
              {req.relatedWorkItems.taskCount + req.relatedWorkItems.bugCount >
                0 && (
                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground md:flex">
                  <Link2 className="h-2.5 w-2.5" />
                  {req.relatedWorkItems.taskCount +
                    req.relatedWorkItems.bugCount}
                </span>
              )}
              {req.ownerId && (
                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground md:flex">
                  <Clock className="h-2.5 w-2.5" />
                  {shortenId(req.ownerId)}
                </span>
              )}
              <Avatar className="h-5 w-5 shrink-0">
                <AvatarFallback className="text-[9px]">
                  {req.ownerId ? initialOf(req.ownerId) : "·"}
                </AvatarFallback>
              </Avatar>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div data-testid="requirements-page" className="flex h-full flex-col">
      <PageHeader
        eyebrow={tNav("group.document")}
        title={tNav("requirements")}
        description={t("page.description")}
        actions={headerActions}
      />

      {sessionStatus === "authenticated" && spaceId && !errorKey && (
        <div className="flex items-center gap-1 border-b border-border px-6 py-3">
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
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}

function shortenId(id: string): string {
  if (id.length <= 8) {
    return id;
  }
  return id.slice(-6);
}

function formatRequirementCode(id: string): string {
  return `REQ-${shortenId(id)}`.toUpperCase();
}

function initialOf(id: string): string {
  return id.charAt(0).toUpperCase();
}
