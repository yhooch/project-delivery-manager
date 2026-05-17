"use client";

import {
  Building2,
  Check,
  ChevronsUpDown,
  FolderKanban,
  Plus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  getApiErrorMessageKey,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";
import { useSession } from "../providers/session-provider";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

import { CreateOrganizationDialog } from "./create-organization-dialog";
import { CreateSpaceDialog } from "./create-space-dialog";

type PendingState =
  | { kind: "idle" }
  | { kind: "switchingOrg" }
  | { kind: "switchingSpace" };

export function OrganizationSwitcher() {
  const t = useTranslations("shell.organizationSwitcher");
  const tRoot = useTranslations();
  const {
    currentOrganization,
    currentSpace,
    session,
    spacesForCurrentOrganization,
    status,
    switchOrganization,
    switchSpace,
  } = useSession();
  const [pending, setPending] = useState<PendingState>({ kind: "idle" });
  const [switchErrorKey, setSwitchErrorKey] =
    useState<ApiErrorMessageKey | null>(null);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);

  if (status !== "authenticated" || !session) {
    return (
      <div
        data-testid="org-switcher"
        data-org-switcher-state="signed-out"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground"
      >
        <Building2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        <span>{t("signedOut")}</span>
      </div>
    );
  }

  const canCreateOrganization = Boolean(
    session.capabilities?.canCreateOrganization,
  );
  const canCreateSpace = Boolean(session.capabilities?.canCreateSpace);
  const hasMultipleOrgs = session.organizations.length > 1;
  const hasAnySpaces = spacesForCurrentOrganization.length > 0;

  // Static fallback: only when user has no actions at all (no other orgs,
  // no spaces to switch between, and no creation capabilities).
  if (
    !hasMultipleOrgs &&
    !hasAnySpaces &&
    !canCreateOrganization &&
    !canCreateSpace
  ) {
    return (
      <div
        data-testid="org-switcher"
        data-org-switcher-state="static"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-foreground"
      >
        <Building2 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
        <span data-testid="org-switcher-current-name">
          {currentOrganization?.name ?? t("empty")}
        </span>
      </div>
    );
  }

  const pendingLabel =
    pending.kind === "switchingOrg"
      ? t("switchingOrg")
      : pending.kind === "switchingSpace"
        ? t("switchingSpace")
        : null;
  const isPending = pending.kind !== "idle";

  async function onSwitchOrganization(organizationId: string) {
    if (organizationId === currentOrganization?.id) return;
    setPending({ kind: "switchingOrg" });
    setSwitchErrorKey(null);
    try {
      await switchOrganization(organizationId);
    } catch (error) {
      setSwitchErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPending({ kind: "idle" });
    }
  }

  async function onSwitchSpace(spaceId: string) {
    if (spaceId === currentSpace?.id) return;
    setPending({ kind: "switchingSpace" });
    setSwitchErrorKey(null);
    try {
      await switchSpace(spaceId);
    } catch (error) {
      setSwitchErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPending({ kind: "idle" });
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-testid="org-switcher"
            data-org-switcher-state="menu"
            aria-label={t("trigger")}
            disabled={isPending}
            className="h-7 max-w-[260px] gap-1.5 border border-border bg-card/60 px-2 text-xs hover:bg-muted"
          >
            <Building2
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <span
              data-testid="org-switcher-current-name"
              className="truncate text-foreground"
            >
              {pendingLabel ?? currentOrganization?.name ?? t("empty")}
            </span>
            {currentSpace && (
              <>
                <span className="text-muted-foreground/60">/</span>
                <span
                  data-testid="org-switcher-current-space"
                  className="truncate text-muted-foreground"
                >
                  {currentSpace.name}
                </span>
              </>
            )}
            <ChevronsUpDown
              aria-hidden="true"
              className="ml-auto h-3 w-3 shrink-0 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[320px]"
          data-testid="org-switcher-menu"
        >
          {switchErrorKey ? (
            <div
              className="mx-1 mb-1 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
              data-testid="org-switcher-error"
              role="alert"
            >
              {tRoot(switchErrorKey)}
            </div>
          ) : null}

          <DropdownMenuLabel>{t("organizationsHeading")}</DropdownMenuLabel>
          {session.organizations.map((organization) => {
            const isCurrent = organization.id === currentOrganization?.id;
            return (
              <DropdownMenuItem
                key={organization.id}
                data-testid={`org-switcher-org-${organization.id}`}
                disabled={isPending}
                onSelect={(event) => {
                  event.preventDefault();
                  void onSwitchOrganization(organization.id);
                }}
                className="gap-2 text-xs"
              >
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate">{organization.name}</span>
                <Badge variant="outline" className="shrink-0 normal-case">
                  {t(`roles.${organization.role}`)}
                </Badge>
                {isCurrent ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    <span className="sr-only">{t("currentBadge")}</span>
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          <DropdownMenuLabel>{t("spacesHeading")}</DropdownMenuLabel>
          {hasAnySpaces ? (
            spacesForCurrentOrganization.map((space) => {
              const isCurrent = space.id === currentSpace?.id;
              return (
                <DropdownMenuItem
                  key={space.id}
                  data-testid={`org-switcher-space-${space.id}`}
                  disabled={isPending}
                  onSelect={(event) => {
                    event.preventDefault();
                    void onSwitchSpace(space.id);
                  }}
                  className="gap-2 text-xs"
                >
                  <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{space.name}</span>
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">{t("currentBadge")}</span>
                    </span>
                  ) : null}
                </DropdownMenuItem>
              );
            })
          ) : (
            <div
              data-testid="org-switcher-no-spaces"
              className="px-2 py-1.5 text-xs text-muted-foreground"
            >
              {t("noSpaces")}
            </div>
          )}

          {(canCreateOrganization || canCreateSpace) && (
            <>
              <DropdownMenuSeparator />
              {canCreateOrganization && (
                <DropdownMenuItem
                  data-testid="org-switcher-create-org"
                  onSelect={(event) => {
                    event.preventDefault();
                    setCreateOrgOpen(true);
                  }}
                  className="gap-2 text-xs"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("createOrganization")}
                </DropdownMenuItem>
              )}
              {canCreateSpace && currentOrganization && (
                <DropdownMenuItem
                  data-testid="org-switcher-create-space"
                  onSelect={(event) => {
                    event.preventDefault();
                    setCreateSpaceOpen(true);
                  }}
                  className="gap-2 text-xs"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("createSpace")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateOrganizationDialog
        open={createOrgOpen}
        onOpenChange={setCreateOrgOpen}
      />
      {currentOrganization && (
        <CreateSpaceDialog
          open={createSpaceOpen}
          onOpenChange={setCreateSpaceOpen}
          organizationId={currentOrganization.id}
        />
      )}
    </>
  );
}
