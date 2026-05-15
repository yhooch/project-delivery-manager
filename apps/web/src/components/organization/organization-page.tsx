"use client";

import type {
  OrganizationMemberWithUser,
  RecordStatus,
} from "@project-delivery/shared";
import { Ban, Crown, Plus, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  canManageOrganization,
  disableOrganizationMember,
  listOrganizationMembers,
  updateOrganization,
} from "../../lib/space-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";

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
  const { currentOrganization, currentSpace, refreshSession, session, status } =
    useSession();
  const organizationId =
    session?.defaultOrganizationId ?? currentOrganization?.id;
  const canManageMembers = canManageOrganization(currentOrganization?.role);

  const [orgName, setOrgName] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [orgStatus, setOrgStatus] = useState<RecordStatus>("ACTIVE");
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);
  const [profileErrorKey, setProfileErrorKey] = useState<string | null>(null);
  const [members, setMembers] = useState<OrganizationMemberWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [disableMember, setDisableMember] =
    useState<OrganizationMemberWithUser | null>(null);
  const [editRoleMember, setEditRoleMember] =
    useState<OrganizationMemberWithUser | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [memberActionErrorKey, setMemberActionErrorKey] = useState<
    string | null
  >(null);
  const loadSequenceRef = useRef(0);

  const activeOwnerCount = useMemo(
    () =>
      members.filter(
        (member) => member.role === "OWNER" && member.status === "ACTIVE",
      ).length,
    [members],
  );

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
      setProfileErrorKey(null);
      return;
    }

    setOrgName(currentOrganization.name);
    setOrgCode(currentOrganization.code);
    setOrgStatus(currentOrganization.status);
    setProfileErrorKey(null);
  }, [
    currentOrganization?.code,
    currentOrganization?.id,
    currentOrganization?.name,
    currentOrganization?.status,
  ]);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;

    if (!organizationId) {
      setMembers([]);
      setIsLoading(false);
      setErrorKey(null);
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const page = await listOrganizationMembers(organizationId);
      if (loadSequenceRef.current !== sequence) return;
      setMembers(page.items);
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
    setMembers([]);
    setIsLoading(false);
    setErrorKey(null);
    setIsAddMemberOpen(false);
    setDisableMember(null);
    setEditRoleMember(null);
    setPendingMemberId(null);
    setMemberActionErrorKey(null);
  }, [organizationId]);

  useEffect(() => {
    if (status !== "authenticated" || !organizationId) {
      return;
    }
    void load();
  }, [load, organizationId, status]);

  async function onConfirmDisable() {
    if (!disableMember || !organizationId || !canManageMembers) {
      return;
    }

    setPendingMemberId(disableMember.id);
    setMemberActionErrorKey(null);

    try {
      const updated = await disableOrganizationMember(
        organizationId,
        disableMember.id,
      );
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDisableMember(null);
    } catch (error) {
      setMemberActionErrorKey(getApiErrorMessageKey(error));
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
    setProfileErrorKey(null);

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
      setProfileErrorKey(getApiErrorMessageKey(error));
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
    setProfileErrorKey(null);
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

  let membersBody;
  if (errorKey) {
    membersBody = (
      <ErrorState message={tRoot(errorKey)} onRetry={() => void load()} />
    );
  } else if (isLoading) {
    membersBody = <ListSkeleton rows={4} />;
  } else if (members.length === 0) {
    membersBody = <EmptyState title={t("members.empty")} />;
  } else {
    membersBody = (
      <ul className="divide-y divide-border">
        {members.map((member) => {
          const isLastActiveOwner =
            member.role === "OWNER" &&
            member.status === "ACTIVE" &&
            activeOwnerCount <= 1;
          const displayName = getOrganizationMemberDisplayName(member);
          const username = getOrganizationMemberUsername(member);

          return (
            <li
              key={member.id}
              data-testid={`organization-member-${member.id}`}
              className={cn(
                "flex items-center gap-3 px-5 py-2.5",
                member.status === "DISABLED" && "opacity-60",
              )}
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback>{initialOf(displayName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {displayName}
                  {member.role === "OWNER" && (
                    <Crown className="h-3 w-3 text-warning" />
                  )}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  <span aria-hidden="true">@</span>
                  <span>{username}</span>
                </div>
              </div>
              <Badge variant={roleVariant[member.role] ?? "default"}>
                {t(`members.roles.${member.role}`)}
              </Badge>
              <Badge
                data-testid={`organization-member-status-${member.id}`}
                variant={member.status === "DISABLED" ? "warning" : "outline"}
              >
                {t(`members.status.${member.status}`)}
              </Badge>
              {canManageMembers ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-testid={`organization-member-edit-role-${member.id}`}
                    disabled={
                      member.status === "DISABLED" ||
                      pendingMemberId === member.id
                    }
                    onClick={() => setEditRoleMember(member)}
                    aria-label={t("members.actions.changeRole", {
                      username,
                    })}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
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
                    aria-label={t("members.actions.disable", {
                      username,
                    })}
                  >
                    <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div data-testid="organization-page" className="flex h-full flex-col">
      {headerNode}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {/* 组织信息 */}
          <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("info.title")}</h2>
              {canManageMembers ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    disabled={isProfileSubmitting || !hasProfileChanges}
                    onClick={onResetOrganizationProfile}
                  >
                    {t("info.actions.cancel")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="text-xs"
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
                </div>
              ) : null}
            </header>
            {profileErrorKey ? (
              <div
                className="border-b border-destructive/40 bg-destructive/10 px-5 py-2 text-xs text-destructive"
                role="alert"
              >
                {tRoot(profileErrorKey)}
              </div>
            ) : null}
            <div className="grid gap-4 px-5 py-4 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="org-name">{t("info.fields.name")}</Label>
                <Input
                  id="org-name"
                  data-testid="organization-profile-name"
                  value={orgName}
                  maxLength={120}
                  readOnly={!canManageMembers}
                  disabled={isProfileSubmitting}
                  onChange={(event) => setOrgName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="org-code">{t("info.fields.code")}</Label>
                <Input
                  id="org-code"
                  data-testid="organization-profile-code"
                  value={orgCode}
                  maxLength={32}
                  pattern="[A-Za-z0-9_-]+"
                  readOnly={!canManageMembers}
                  disabled={isProfileSubmitting}
                  onChange={(event) => setOrgCode(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="org-status">{t("info.fields.status")}</Label>
                <select
                  id="org-status"
                  data-testid="organization-profile-status"
                  className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
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
                </select>
              </div>
            </div>
            <div className="border-t border-border bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
              {canManageMembers
                ? t("info.editableNote")
                : t("info.readOnlyNote")}
            </div>
          </section>

          {/* 组织成员 */}
          <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("members.title")}</h2>
              <Button
                size="sm"
                className="text-xs"
                data-testid="organization-add-member-button"
                disabled={!canManageMembers}
                onClick={() => {
                  if (canManageMembers) {
                    setIsAddMemberOpen(true);
                  }
                }}
              >
                <Plus className="h-3 w-3" />
                {t("members.add")}
              </Button>
            </header>
            {!canManageMembers ? (
              <div
                className="border-b border-border bg-muted/30 px-5 py-2 text-xs text-muted-foreground"
                data-testid="organization-readonly-notice"
              >
                {t("members.readOnly")}
              </div>
            ) : null}
            {memberActionErrorKey ? (
              <div
                className="border-b border-destructive/40 bg-destructive/10 px-5 py-2 text-xs text-destructive"
                role="alert"
              >
                {tRoot(memberActionErrorKey)}
              </div>
            ) : null}
            {membersBody}
            <div className="border-t border-border bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
              {t("members.ownerProtectionNote")}
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
