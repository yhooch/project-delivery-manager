"use client";

import type {
  OrganizationMemberWithUser,
  RecordStatus,
} from "@project-delivery/shared";
import { Ban, Crown, Plus, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  canManageOrganization,
  disableOrganizationMember,
  listOrganizationMembers,
  updateOrganization,
} from "../../lib/space-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import {
  formatApiErrorDisplayMessage,
  getApiErrorDisplay,
  type ApiErrorDisplayState,
} from "../shell/api-error-display";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SelectMenu } from "../ui/select-menu";
import { Tip } from "../ui/tooltip";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";

import { AddOrgMemberDialog } from "./add-org-member-dialog";
import { EditOrgMemberRoleDialog } from "./edit-org-member-role-dialog";

const roleVariant: Record<string, "primary" | "info" | "default"> = {
  OWNER: "primary",
  ADMIN: "info",
  MEMBER: "default",
};
const organizationStatusOptions: readonly RecordStatus[] = [
  "ACTIVE",
  "DISABLED",
];

export function OrganizationPage() {
  const t = useTranslations("organization");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const requestIdLabel = tRoot("errors.apiDetails.requestId");
  const { currentOrganization, currentSpace, refreshSession, session, status } =
    useSession();
  const organizationId =
    session?.defaultOrganizationId ?? currentOrganization?.id;
  const canManageMembers = canManageOrganization(currentOrganization?.role);

  const [orgName, setOrgName] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [orgStatus, setOrgStatus] = useState<RecordStatus>("ACTIVE");
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [profileError, setProfileError] =
    useState<ApiErrorDisplayState | null>(null);
  const [members, setMembers] = useState<OrganizationMemberWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiErrorDisplayState | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [disableMember, setDisableMember] =
    useState<OrganizationMemberWithUser | null>(null);
  const [editRoleMember, setEditRoleMember] =
    useState<OrganizationMemberWithUser | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] =
    useState<ApiErrorDisplayState | null>(null);
  const loadSequenceRef = useRef(0);

  const activeOwnerCount = useMemo(
    () =>
      members.filter(
        (member) => member.role === "OWNER" && member.status === "ACTIVE",
      ).length,
    [members],
  );

  function refreshAfterCurrentUserMemberChange(
    member: OrganizationMemberWithUser,
  ) {
    if (member.userId !== session?.user.id) {
      return;
    }

    const recentOrganizationId =
      member.status === "ACTIVE" ? member.organizationId : undefined;
    const recentSpaceId =
      member.status === "ACTIVE" ? currentSpace?.id : undefined;

    void refreshSession(recentOrganizationId, recentSpaceId).catch((error) => {
      setMemberActionError(getApiErrorDisplay(error, requestIdLabel));
    });
  }

  const hasProfileChanges = Boolean(
    currentOrganization &&
    (orgName.trim() !== currentOrganization.name ||
      orgCode.trim() !== currentOrganization.code ||
      orgStatus !== currentOrganization.status),
  );

  useEffect(() => {
    if (!currentOrganization) {
      setOrgName("");
      setOrgCode("");
      setOrgStatus("ACTIVE");
      setProfileError(null);
      return;
    }

    setOrgName(currentOrganization.name);
    setOrgCode(currentOrganization.code);
    setOrgStatus(currentOrganization.status);
    setProfileError(null);
  }, [
    currentOrganization?.code,
    currentOrganization?.id,
    currentOrganization?.name,
    currentOrganization?.status,
  ]);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;

    if (!organizationId || !canManageMembers) {
      setMembers([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const page = await listOrganizationMembers(organizationId);
      if (loadSequenceRef.current !== sequence) return;
      setMembers(page.items);
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return;
      setError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      if (loadSequenceRef.current === sequence) {
        setIsLoading(false);
      }
    }
  }, [canManageMembers, organizationId, requestIdLabel]);

  useEffect(() => {
    loadSequenceRef.current += 1;
    setMembers([]);
    setIsLoading(false);
    setError(null);
    setIsAddMemberOpen(false);
    setDisableMember(null);
    setEditRoleMember(null);
    setPendingMemberId(null);
    setMemberActionError(null);
  }, [organizationId]);

  useEffect(() => {
    if (canManageMembers) {
      return;
    }

    loadSequenceRef.current += 1;
    setMembers([]);
    setIsLoading(false);
    setError(null);
    setIsAddMemberOpen(false);
    setDisableMember(null);
    setEditRoleMember(null);
    setPendingMemberId(null);
    setMemberActionError(null);
  }, [canManageMembers]);

  useEffect(() => {
    if (status !== "authenticated" || !organizationId || !canManageMembers) {
      return;
    }
    void load();
  }, [canManageMembers, load, organizationId, status]);

  async function onConfirmDisable() {
    if (!disableMember || !organizationId || !canManageMembers) {
      return;
    }

    setPendingMemberId(disableMember.id);
    setMemberActionError(null);

    try {
      const updated = await disableOrganizationMember(
        organizationId,
        disableMember.id,
      );
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      refreshAfterCurrentUserMemberChange(updated);
      setDisableMember(null);
    } catch (error) {
      setMemberActionError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      setPendingMemberId(null);
    }
  }

  async function onSaveOrganizationProfile() {
    if (!organizationId || !currentOrganization || !canManageMembers) {
      return;
    }

    const nextName = orgName.trim();
    const nextCode = orgCode.trim();

    if (nextName.length === 0 || nextCode.length < 2 || !hasProfileChanges) {
      return;
    }

    setIsProfileSubmitting(true);
    setProfileError(null);

    try {
      const updated = await updateOrganization(organizationId, {
        ...(nextName !== currentOrganization.name ? { name: nextName } : {}),
        ...(nextCode !== currentOrganization.code ? { code: nextCode } : {}),
        ...(orgStatus !== currentOrganization.status
          ? { status: orgStatus }
          : {}),
      });
      await refreshSession(updated.id, currentSpace?.id);
    } catch (error) {
      setProfileError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      setIsProfileSubmitting(false);
    }
  }

  function onResetOrganizationProfile() {
    if (!currentOrganization) {
      return;
    }

    setOrgName(currentOrganization.name);
    setOrgCode(currentOrganization.code);
    setOrgStatus(currentOrganization.status);
    setProfileError(null);
  }

  const isEditRoleMemberLastActiveOwner =
    editRoleMember?.role === "OWNER" &&
    editRoleMember.status === "ACTIVE" &&
    activeOwnerCount <= 1;

  const headerNode = (
    <PageHeader
      eyebrow={currentOrganization?.name ?? tRoot("common.emptyValue")}
      title={tShell("organization")}
      description={t("page.description")}
    />
  );

  if (status === "loading") {
    return (
      <div data-testid="organization-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ListSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (!organizationId || !currentOrganization) {
    return (
      <div data-testid="organization-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <EmptyState
            title={t("page.noOrganization.title")}
            description={t("page.noOrganization.description")}
          />
        </div>
      </div>
    );
  }

  if (!canManageMembers) {
    return (
      <div data-testid="organization-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <EmptyState
            title={t("page.noPermission.title")}
            description={t("page.noPermission.description")}
          />
        </div>
      </div>
    );
  }

  let membersBody;
  if (error) {
    membersBody = (
      <ErrorState
        message={formatApiErrorDisplayMessage(
          tRoot(error.messageKey),
          error.detailLines,
          " · ",
        )}
        onRetry={() => void load()}
      />
    );
  } else if (isLoading) {
    membersBody = <ListSkeleton rows={4} />;
  } else if (members.length === 0) {
    membersBody = <EmptyState title={t("members.empty")} />;
  } else {
    membersBody = (
      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const isLastActiveOwner =
            member.role === "OWNER" &&
            member.status === "ACTIVE" &&
            activeOwnerCount <= 1;
          const displayName = getOrganizationMemberDisplayName(member);
          const username = getOrganizationMemberUsername(member);
          const changeRoleLabel = t("members.actions.changeRole", {
            username,
          });
          const disableLabel = t("members.actions.disable", {
            username,
          });

          return (
            <li
              key={member.id}
              data-testid={`organization-member-${member.id}`}
              className={cn(
                "group flex flex-col sm:flex-row sm:items-center gap-3 py-3",
                member.status === "DISABLED" && "opacity-60",
              )}
            >
              <div className="flex flex-1 items-center gap-4 min-w-0">
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="bg-muted text-muted-foreground">
                    {initialOf(displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate text-foreground">
                      {displayName}
                    </span>
                    {member.role === "OWNER" && (
                      <Crown className="h-3.5 w-3.5 text-warning shrink-0" />
                    )}
                  </div>
                  <div className="text-[13px] text-muted-foreground truncate">
                    @{username}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 sm:pl-4 pl-[56px]">
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={roleVariant[member.role] ?? "default"}
                    className="font-normal"
                  >
                    {t(`members.roles.${member.role}`)}
                  </Badge>
                  <Badge
                    data-testid={`organization-member-status-${member.id}`}
                    variant={
                      member.status === "DISABLED" ? "warning" : "outline"
                    }
                    className="font-normal"
                  >
                    {t(`members.status.${member.status}`)}
                  </Badge>
                </div>
                {canManageMembers ? (
                  <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                    <Tip content={changeRoleLabel}>
                      <span className="inline-flex">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          data-testid={`organization-member-edit-role-${member.id}`}
                          disabled={
                            member.status === "DISABLED" ||
                            pendingMemberId === member.id
                          }
                          onClick={() => setEditRoleMember(member)}
                          aria-label={changeRoleLabel}
                          className="hover:bg-muted"
                        >
                          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </span>
                    </Tip>
                    <Tip content={disableLabel}>
                      <span className="inline-flex">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          data-testid={`organization-member-disable-${member.id}`}
                          disabled={
                            isLastActiveOwner ||
                            member.status === "DISABLED" ||
                            pendingMemberId === member.id
                          }
                          onClick={() => setDisableMember(member)}
                          aria-label={disableLabel}
                          className="hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Ban className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </span>
                    </Tip>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div
      data-testid="organization-page"
      className="flex h-full flex-col bg-background"
    >
      {headerNode}

      <div className="flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-12">
          {/* Organization Info */}
          <section className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
            <div>
              <h2 className="text-base font-medium text-foreground">
                {t("info.title")}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {tRoot("organization.page.description")}
              </p>
            </div>
            <div className="flex flex-col gap-6">
              {profileError ? (
                <div
                  className="whitespace-pre-wrap rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {formatApiErrorDisplayMessage(
                    tRoot(profileError.messageKey),
                    profileError.detailLines,
                  )}
                </div>
              ) : null}
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="org-name" className="text-sm font-medium">
                    {t("info.fields.name")}
                  </Label>
                  <Input
                    id="org-name"
                    data-testid="organization-profile-name"
                    value={orgName}
                    maxLength={120}
                    readOnly={!canManageMembers}
                    disabled={isProfileSubmitting}
                    onChange={(event) => setOrgName(event.target.value)}
                    className="max-w-md bg-transparent"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="org-code" className="text-sm font-medium">
                    {t("info.fields.code")}
                  </Label>
                  <Input
                    id="org-code"
                    data-testid="organization-profile-code"
                    value={orgCode}
                    maxLength={32}
                    pattern="[A-Za-z0-9_-]+"
                    readOnly={!canManageMembers}
                    disabled={isProfileSubmitting}
                    onChange={(event) => setOrgCode(event.target.value)}
                    className="max-w-md bg-transparent"
                  />
                </div>
                <div className="flex flex-col gap-2 md:col-span-2">
                  <Label htmlFor="org-status" className="text-sm font-medium">
                    {t("info.fields.status")}
                  </Label>
                  <SelectMenu
                    id="org-status"
                    data-testid="organization-profile-status"
                    className="flex h-9 w-full max-w-[220px] rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={orgStatus}
                    disabled={!canManageMembers || isProfileSubmitting}
                    onChange={(event) =>
                      setOrgStatus(event.target.value as RecordStatus)
                    }
                  >
                    {organizationStatusOptions.map((statusKey) => (
                      <option key={statusKey} value={statusKey}>
                        {t(`info.status.${statusKey}`)}
                      </option>
                    ))}
                  </SelectMenu>
                </div>
              </div>
              <div className="flex items-center gap-4 pt-2">
                {canManageMembers ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      data-testid="organization-profile-save"
                      disabled={
                        isProfileSubmitting ||
                        !hasProfileChanges ||
                        orgName.trim().length === 0 ||
                        orgCode.trim().length < 2
                      }
                      onClick={() => void onSaveOrganizationProfile()}
                    >
                      {isProfileSubmitting
                        ? t("info.actions.submitting")
                        : t("info.actions.save")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isProfileSubmitting || !hasProfileChanges}
                      onClick={onResetOrganizationProfile}
                    >
                      {t("info.actions.cancel")}
                    </Button>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("info.readOnlyNote")}
                  </span>
                )}
              </div>
            </div>
          </section>

          <div className="h-px w-full bg-border/50" />

          {/* Members */}
          <section className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
            <div>
              <h2 className="text-base font-medium text-foreground">
                {t("members.title")}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {t("members.description")}
              </p>
              {canManageMembers && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-6"
                  data-testid="organization-add-member-button"
                  disabled={!canManageMembers}
                  onClick={() => setIsAddMemberOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2 -ml-1" />
                  {t("members.add")}
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-4">
              {!canManageMembers && (
                <div className="text-sm text-muted-foreground bg-muted/30 px-4 py-3 rounded-lg w-fit">
                  {t("members.readOnly")}
                </div>
              )}
              {memberActionError && (
                <div
                  className="w-fit whitespace-pre-wrap rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {formatApiErrorDisplayMessage(
                    tRoot(memberActionError.messageKey),
                    memberActionError.detailLines,
                  )}
                </div>
              )}
              <div className="w-full">{membersBody}</div>

              {members.length > 0 && (
                <p className="text-sm text-muted-foreground mt-4">
                  {t("members.ownerProtectionNote")}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      {canManageMembers ? (
        <>
          <AddOrgMemberDialog
            onClose={() => setIsAddMemberOpen(false)}
            onSuccess={(member) => {
              setIsAddMemberOpen(false);
              setMembers((current) => {
                const filtered = current.filter(
                  (item) => item.id !== member.id,
                );
                return [...filtered, member];
              });
              void load();
            }}
            open={isAddMemberOpen}
            organizationId={organizationId}
          />
          <EditOrgMemberRoleDialog
            isLastActiveOwner={Boolean(isEditRoleMemberLastActiveOwner)}
            member={editRoleMember}
            onClose={() => setEditRoleMember(null)}
            onSuccess={(member) => {
              setEditRoleMember(null);
              setMembers((current) =>
                current.map((item) => (item.id === member.id ? member : item)),
              );
              refreshAfterCurrentUserMemberChange(member);
              void load();
            }}
            open={editRoleMember !== null}
            organizationId={organizationId}
          />
        </>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setDisableMember(null);
          }
        }}
        open={disableMember !== null}
      >
        <DialogContent data-testid="organization-disable-member-dialog">
          <DialogHeader>
            <DialogTitle>
              {tRoot("organization.dialog.disableMember.title")}
            </DialogTitle>
            <DialogDescription>
              {tRoot("organization.dialog.disableMember.description", {
                username: disableMember?.user.username ?? "",
              })}
            </DialogDescription>
          </DialogHeader>

          {disableMember &&
          disableMember.role === "OWNER" &&
          activeOwnerCount <= 1 ? (
            <div
              className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
              role="alert"
            >
              {tRoot("organization.dialog.disableMember.lastOwnerWarning")}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              className="text-xs"
              data-testid="organization-disable-member-cancel"
              disabled={pendingMemberId !== null}
              onClick={() => setDisableMember(null)}
              size="sm"
              type="button"
              variant="outline"
            >
              {tRoot("organization.dialog.disableMember.cancel")}
            </Button>
            <Button
              className="text-xs"
              data-testid="organization-disable-member-submit"
              disabled={
                pendingMemberId !== null ||
                !disableMember ||
                !canManageMembers ||
                (disableMember.role === "OWNER" && activeOwnerCount <= 1)
              }
              onClick={() => void onConfirmDisable()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {pendingMemberId !== null
                ? tRoot("organization.dialog.disableMember.submitting")
                : tRoot("organization.dialog.disableMember.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getOrganizationMemberDisplayName(member: OrganizationMemberWithUser) {
  return (
    member.user.name?.trim() || member.user.username?.trim() || member.userId
  );
}

function getOrganizationMemberUsername(member: OrganizationMemberWithUser) {
  return (
    member.user.username?.trim() || member.user.name?.trim() || member.userId
  );
}

function initialOf(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
}
