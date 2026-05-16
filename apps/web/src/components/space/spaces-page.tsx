"use client";

import type {
  RecordStatus,
  SpaceRole,
  SpaceSummary,
  VersionStatus,
} from "@project-delivery/shared";
import {
  ArrowUpRight,
  Bug,
  CircleAlert,
  Clock3,
  FolderKanban,
  GitBranch,
  ListChecks,
  Plus,
  RotateCw,
  User2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { listSpaces } from "../../lib/space-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CreateSpaceDialog } from "../shell/create-space-dialog";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";

const statusVariant: Record<RecordStatus, "primary" | "warning"> = {
  ACTIVE: "primary",
  DISABLED: "warning",
};
const versionStatusVariant: Record<
  VersionStatus,
  "primary" | "info" | "success" | "default"
> = {
  PLANNED: "info",
  IN_PROGRESS: "primary",
  RELEASED: "success",
  ARCHIVED: "default",
};
const roleVariant: Record<
  SpaceRole,
  "primary" | "info" | "warning" | "default"
> = {
  SPACE_ADMIN: "primary",
  PM: "info",
  DEVELOPER: "default",
  TESTER: "warning",
  REQUIREMENT: "info",
  MEMBER: "default",
  VIEWER: "default",
};

export function SpacesPage() {
  const locale = useLocale();
  const t = useTranslations("spaces");
  const tShell = useTranslations("shell");
  const tVersionStatus = useTranslations("versionBoard.status");
  const tRoot = useTranslations();
  const {
    currentOrganization,
    currentSpace,
    session,
    spacesForCurrentOrganization,
    status,
    switchSpace,
  } = useSession();

  const organizationId =
    session?.defaultOrganizationId ?? currentOrganization?.id;
  const canCreateSpace = Boolean(
    session?.capabilities?.canCreateSpace &&
    currentOrganization?.status === "ACTIVE",
  );

  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [switchErrorKey, setSwitchErrorKey] = useState<string | null>(null);
  const [pendingSpaceId, setPendingSpaceId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const loadSequenceRef = useRef(0);

  const membershipBySpaceId = useMemo(
    () =>
      new Map(spacesForCurrentOrganization.map((space) => [space.id, space])),
    [spacesForCurrentOrganization],
  );

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;

    if (!organizationId) {
      setSpaces([]);
      setIsLoading(false);
      setErrorKey(null);
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const page = await listSpaces(organizationId);
      if (loadSequenceRef.current !== sequence) return;
      setSpaces(page.items);
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return;
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (loadSequenceRef.current === sequence) {
        setIsLoading(false);
      }
    }
  }, [organizationId]);

  useEffect(() => {
    loadSequenceRef.current += 1;
    setSpaces([]);
    setIsLoading(false);
    setErrorKey(null);
    setSwitchErrorKey(null);
    setPendingSpaceId(null);
  }, [organizationId]);

  useEffect(() => {
    if (status !== "authenticated" || !organizationId) {
      return;
    }

    void load();
  }, [load, organizationId, status]);

  async function onSwitchSpace(spaceId: string) {
    const membership = membershipBySpaceId.get(spaceId);
    if (!membership || membership.id === currentSpace?.id) {
      return;
    }

    setPendingSpaceId(spaceId);
    setSwitchErrorKey(null);

    try {
      await switchSpace(spaceId);
    } catch (error) {
      setSwitchErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPendingSpaceId(null);
    }
  }

  function onCreateOpenChange(open: boolean) {
    setCreateOpen(open);
    if (!open) {
      void load();
    }
  }

  const headerNode = (
    <PageHeader
      eyebrow={currentOrganization?.name ?? t("workspace.page.eyebrow")}
      title={t("workspace.page.title")}
      description={t("list.description")}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            data-testid="spaces-refresh-button"
            disabled={isLoading}
            onClick={() => void load()}
          >
            <RotateCw
              className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
            {t("list.refresh")}
          </Button>
          {canCreateSpace ? (
            <Button
              size="sm"
              className="text-xs"
              data-testid="spaces-create-button"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {tShell("organizationSwitcher.createSpace")}
            </Button>
          ) : null}
        </>
      }
    />
  );

  if (status === "loading") {
    return (
      <div
        data-testid="spaces-page"
        className="flex h-full flex-col bg-background"
      >
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ListSkeleton rows={5} />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div
        data-testid="spaces-page"
        className="flex h-full flex-col bg-background"
      >
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <EmptyState
            title={t("workspace.session.unauthenticated.title")}
            description={t("workspace.session.unauthenticated.description")}
          />
        </div>
      </div>
    );
  }

  if (!organizationId || !currentOrganization) {
    return (
      <div
        data-testid="spaces-page"
        className="flex h-full flex-col bg-background"
      >
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <EmptyState
            title={t("workspace.missingOrganization.title")}
            description={t("workspace.missingOrganization.description")}
          />
        </div>
      </div>
    );
  }

  let body;
  if (errorKey) {
    body = (
      <ErrorState
        title={t("list.errorTitle")}
        message={tRoot(errorKey)}
        onRetry={() => void load()}
      />
    );
  } else if (isLoading) {
    body = <ListSkeleton rows={5} />;
  } else if (spaces.length === 0) {
    body = (
      <div className="py-12 border border-dashed border-border rounded-xl bg-muted/10">
        <EmptyState
          icon={<FolderKanban className="h-5 w-5" />}
          title={t("list.empty")}
          description={t("list.description")}
          action={
            canCreateSpace ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                {tShell("organizationSwitcher.createSpace")}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    body = (
      <ul
        data-testid="spaces-list"
        aria-label={t("list.table.label")}
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        {spaces.map((space) => {
          const membership = membershipBySpaceId.get(space.id);
          const isCurrent = space.id === currentSpace?.id;
          const canSwitch = Boolean(membership) && !isCurrent;
          return (
            <li
              key={space.id}
              data-testid={`spaces-list-item-${space.id}`}
              className={cn(
                "group flex flex-col border-b border-border/60 transition-colors last:border-b-0 hover:bg-muted/20 xl:flex-row xl:items-stretch",
                isCurrent
                  ? "bg-primary/5 ring-1 ring-inset ring-primary/20"
                  : "bg-card",
                space.status === "DISABLED" && "opacity-60",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center">
                <div className="min-w-0 xl:w-[22rem]">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                        isCurrent
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/60 text-muted-foreground group-hover:bg-primary/5 group-hover:text-primary/80",
                      )}
                    >
                      <FolderKanban className="h-4 w-4" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">
                          {space.name}
                        </h2>
                        {isCurrent && (
                          <Badge
                            variant="primary"
                            className="h-5 px-1.5 text-[10px] font-medium uppercase leading-none"
                          >
                            {t("list.selected")}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {space.code}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {membership ? (
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4 xl:grid-cols-6">
                    <SpaceMetaItem
                      icon={<User2 className="h-3.5 w-3.5" />}
                      label={t("list.fields.owner")}
                      testId={`spaces-owner-${space.id}`}
                      value={formatOwnerLabel(space, t("list.emptyValue"))}
                    />
                    <SpaceMetaItem
                      icon={<GitBranch className="h-3.5 w-3.5" />}
                      label={t("list.fields.currentVersion")}
                      testId={`spaces-current-version-${space.id}`}
                      value={
                        space.currentVersion ? (
                          <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground/90">
                            <span className="truncate max-w-[80px]">
                              {space.currentVersion.name}
                            </span>
                            <Badge
                              variant={
                                versionStatusVariant[
                                  space.currentVersion.status
                                ]
                              }
                              className="h-5 px-1.5 text-[10px] font-normal"
                            >
                              {tVersionStatus(space.currentVersion.status)}
                            </Badge>
                          </span>
                        ) : (
                          t("list.emptyValue")
                        )
                      }
                    />
                    <SpaceMetaItem
                      icon={<ListChecks className="h-3.5 w-3.5 text-primary" />}
                      label={t("list.fields.unfinishedTaskCount")}
                      testId={`spaces-unfinished-tasks-${space.id}`}
                      value={
                        <span className="text-foreground/90">
                          {formatNullableCount(
                            space.unfinishedTaskCount,
                            t("list.emptyValue"),
                          )}
                        </span>
                      }
                    />
                    <SpaceMetaItem
                      icon={<Bug className="h-3.5 w-3.5 text-destructive" />}
                      label={t("list.fields.openBugCount")}
                      testId={`spaces-open-bugs-${space.id}`}
                      value={
                        <span className="text-foreground/90">
                          {formatNullableCount(
                            space.openBugCount,
                            t("list.emptyValue"),
                          )}
                        </span>
                      }
                    />
                    <SpaceMetaItem
                      icon={
                        <CircleAlert className="h-3.5 w-3.5 text-warning" />
                      }
                      label={t("list.fields.blockedCount")}
                      testId={`spaces-blocked-${space.id}`}
                      value={
                        <span className="text-foreground/90">
                          {formatNullableCount(
                            space.blockedCount,
                            t("list.emptyValue"),
                          )}
                        </span>
                      }
                    />
                    <SpaceMetaItem
                      icon={<Clock3 className="h-3.5 w-3.5" />}
                      label={t("list.fields.updatedAt")}
                      testId={`spaces-updated-at-${space.id}`}
                      value={formatUpdatedAt(
                        space.updatedAt,
                        locale,
                        t("list.emptyValue"),
                      )}
                    />
                  </div>
                ) : (
                  <div
                    data-testid={`spaces-restricted-${space.id}`}
                    className="mt-auto rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-xs text-muted-foreground"
                  >
                    {t("list.restricted")}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/40 bg-muted/10 px-4 py-3 xl:w-56 xl:border-l xl:border-t-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant={statusVariant[space.status]}
                    className="h-5 px-1.5 text-[10px] font-normal"
                  >
                    {t(`settings.status.${space.status}`)}
                  </Badge>
                  {membership ? (
                    <Badge
                      variant={roleVariant[membership.role] ?? "default"}
                      className="h-5 px-1.5 text-[10px] font-normal"
                    >
                      {t(`members.roles.${membership.role}`)}
                    </Badge>
                  ) : (
                    <Badge
                      variant="default"
                      className="h-5 border-transparent bg-muted/30 px-1.5 text-[10px] font-normal text-muted-foreground"
                    >
                      {t("list.notMember")}
                    </Badge>
                  )}
                </div>
                <Button
                  variant={isCurrent ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 shrink-0 px-2.5 text-xs font-medium"
                  data-testid={`spaces-switch-${space.id}`}
                  disabled={
                    pendingSpaceId !== null ||
                    !canSwitch ||
                    space.status === "DISABLED"
                  }
                  onClick={() => void onSwitchSpace(space.id)}
                >
                  {isCurrent ? (
                    t("list.selected")
                  ) : pendingSpaceId === space.id ? (
                    tShell("organizationSwitcher.switchingSpace")
                  ) : (
                    <>
                      {t("list.switch")}
                      <ArrowUpRight className="h-3 w-3 ml-1 opacity-60" />
                    </>
                  )}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div
      data-testid="spaces-page"
      className="flex h-full flex-col bg-background"
    >
      {headerNode}

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {!canCreateSpace ? (
            <div
              data-testid="spaces-readonly-notice"
              className="rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-xs text-warning flex items-center gap-2"
            >
              <CircleAlert className="h-4 w-4" />
              {t("list.readOnly")}
            </div>
          ) : null}
          {switchErrorKey ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive flex items-center gap-2"
            >
              <CircleAlert className="h-4 w-4" />
              {tRoot(switchErrorKey)}
            </div>
          ) : null}

          <section className="flex flex-col gap-4">
            <header className="flex items-center justify-between px-1">
              <h2 className="text-lg font-medium tracking-tight">
                {t("list.title")}
              </h2>
              <span className="text-[11px] text-muted-foreground font-medium px-2.5 py-1 bg-muted/30 rounded-full border border-border/50">
                {t("list.spaceCount", { count: spaces.length })}
              </span>
            </header>
            {body}
          </section>
        </div>
      </div>

      {canCreateSpace ? (
        <CreateSpaceDialog
          open={createOpen}
          onOpenChange={onCreateOpenChange}
          organizationId={organizationId}
        />
      ) : null}
    </div>
  );
}

function SpaceMetaItem({
  icon,
  label,
  testId,
  value,
}: {
  icon: ReactNode;
  label: string;
  testId: string;
  value: ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 items-center justify-between gap-2"
      data-testid={testId}
    >
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground/70">
        {icon}
        <span className="truncate text-[11px]">{label}</span>
      </span>
      <span className="min-w-0 truncate text-[12px] font-medium text-foreground/80">
        {value}
      </span>
    </div>
  );
}

function formatOwnerLabel(space: SpaceSummary, fallback: string): string {
  return (
    space.owner?.name?.trim() ||
    space.owner?.username?.trim() ||
    space.ownerId?.trim() ||
    fallback
  );
}

function formatNullableCount(
  value: number | null | undefined,
  fallback: string,
): string {
  return typeof value === "number" ? String(value) : fallback;
}

function formatUpdatedAt(
  value: string | null | undefined,
  locale: string,
  fallback: string,
): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return fallback;
  }
}
