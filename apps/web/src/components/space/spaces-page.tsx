"use client";

import type { SpaceSummary } from "@project-delivery/shared";
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
  useState,
  type ReactNode,
} from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { canManageOrganization, listSpaces } from "../../lib/space-service";
import { useSession } from "../providers/session-provider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";
import { CreateSpaceDialog } from "../shell/create-space-dialog";

const statusVariant: Record<string, "primary" | "warning" | "default"> = {
  ACTIVE: "primary",
  DISABLED: "warning",
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
  const canCreateSpace =
    Boolean(session?.capabilities?.canCreateSpace) &&
    canManageOrganization(currentOrganization?.role);

  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [switchErrorKey, setSwitchErrorKey] = useState<string | null>(null);
  const [pendingSpaceId, setPendingSpaceId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const membershipBySpaceId = useMemo(
    () =>
      new Map(spacesForCurrentOrganization.map((space) => [space.id, space])),
    [spacesForCurrentOrganization],
  );

  const load = useCallback(async () => {
    if (!organizationId) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const page = await listSpaces(organizationId);
      setSpaces(page.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
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
              className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`}
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
              <Plus className="h-3 w-3" />
              {tShell("organizationSwitcher.createSpace")}
            </Button>
          ) : null}
        </>
      }
    />
  );

  if (status === "loading") {
    return (
      <div data-testid="spaces-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ListSkeleton rows={5} />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div data-testid="spaces-page" className="flex h-full flex-col">
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
      <div data-testid="spaces-page" className="flex h-full flex-col">
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
      <EmptyState
        icon={<FolderKanban className="h-4 w-4" />}
        title={t("list.empty")}
        description={t("list.description")}
        action={
          canCreateSpace ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3 w-3" />
              {tShell("organizationSwitcher.createSpace")}
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <ul
        data-testid="spaces-list"
        aria-label={t("list.table.label")}
        className="divide-y divide-border"
      >
        {spaces.map((space) => {
          const membership = membershipBySpaceId.get(space.id);
          const isCurrent = space.id === currentSpace?.id;
          const canSwitch = Boolean(membership) && !isCurrent;
          return (
            <li
              key={space.id}
              data-testid={`spaces-list-item-${space.id}`}
              className="flex flex-wrap items-center gap-3 px-5 py-3"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FolderKanban className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-sm font-semibold">
                    {space.name}
                  </h2>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {space.code}
                  </span>
                  {isCurrent ? (
                    <Badge variant="primary">{t("list.selected")}</Badge>
                  ) : null}
                  <Badge variant={statusVariant[space.status] ?? "default"}>
                    {t(`settings.status.${space.status}`)}
                  </Badge>
                  {membership ? (
                    <Badge variant="outline">
                      {t(`members.roles.${membership.role}`)}
                    </Badge>
                  ) : (
                    <Badge variant="default">{t("list.notMember")}</Badge>
                  )}
                </div>
                {space.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {space.description}
                  </p>
                ) : null}
                <div
                  data-testid={`spaces-operational-fields-${space.id}`}
                  className="mt-2 grid gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground sm:grid-cols-2 lg:grid-cols-3"
                >
                  <SpaceMetaItem
                    icon={<User2 className="h-3 w-3" aria-hidden="true" />}
                    label={t("list.fields.owner")}
                    testId={`spaces-owner-${space.id}`}
                    value={formatOwnerLabel(space, t("list.emptyValue"))}
                  />
                  <SpaceMetaItem
                    icon={<GitBranch className="h-3 w-3" aria-hidden="true" />}
                    label={t("list.fields.currentVersion")}
                    testId={`spaces-current-version-${space.id}`}
                    value={
                      space.currentVersion ? (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <span className="truncate">
                            {space.currentVersion.name}
                          </span>
                          <Badge variant="outline">
                            {tVersionStatus(space.currentVersion.status)}
                          </Badge>
                        </span>
                      ) : (
                        t("list.emptyValue")
                      )
                    }
                  />
                  <SpaceMetaItem
                    icon={<ListChecks className="h-3 w-3" aria-hidden="true" />}
                    label={t("list.fields.unfinishedTaskCount")}
                    testId={`spaces-unfinished-tasks-${space.id}`}
                    value={formatNullableCount(
                      space.unfinishedTaskCount,
                      t("list.emptyValue"),
                    )}
                  />
                  <SpaceMetaItem
                    icon={<Bug className="h-3 w-3" aria-hidden="true" />}
                    label={t("list.fields.openBugCount")}
                    testId={`spaces-open-bugs-${space.id}`}
                    value={formatNullableCount(
                      space.openBugCount,
                      t("list.emptyValue"),
                    )}
                  />
                  <SpaceMetaItem
                    icon={
                      <CircleAlert className="h-3 w-3" aria-hidden="true" />
                    }
                    label={t("list.fields.blockedCount")}
                    testId={`spaces-blocked-${space.id}`}
                    value={formatNullableCount(
                      space.blockedCount,
                      t("list.emptyValue"),
                    )}
                  />
                  <SpaceMetaItem
                    icon={<Clock3 className="h-3 w-3" aria-hidden="true" />}
                    label={t("list.fields.updatedAt")}
                    testId={`spaces-updated-at-${space.id}`}
                    value={formatUpdatedAt(
                      space.updatedAt,
                      locale,
                      t("list.emptyValue"),
                    )}
                  />
                </div>
              </div>
              <Button
                variant={isCurrent ? "outline" : "default"}
                size="sm"
                className="text-xs"
                data-testid={`spaces-switch-${space.id}`}
                disabled={
                  pendingSpaceId !== null ||
                  !canSwitch ||
                  space.status === "DISABLED"
                }
                onClick={() => void onSwitchSpace(space.id)}
              >
                {isCurrent ? (
                  <>
                    <ArrowUpRight className="h-3 w-3" />
                    {t("list.selected")}
                  </>
                ) : pendingSpaceId === space.id ? (
                  tShell("organizationSwitcher.switchingSpace")
                ) : (
                  t("list.switch")
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div data-testid="spaces-page" className="flex h-full flex-col">
      {headerNode}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {!canCreateSpace ? (
            <div
              data-testid="spaces-readonly-notice"
              className="rounded-md border border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
            >
              {t("list.readOnly")}
            </div>
          ) : null}
          {switchErrorKey ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
            >
              {tRoot(switchErrorKey)}
            </div>
          ) : null}
          <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("list.title")}</h2>
              <span className="text-[11px] text-muted-foreground">
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
    <div className="flex min-w-0 items-center gap-1.5" data-testid={testId}>
      <span className="flex shrink-0 items-center gap-1">
        {icon}
        <span>{label}</span>
      </span>
      <span className="min-w-0 truncate font-medium text-foreground/80">
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
