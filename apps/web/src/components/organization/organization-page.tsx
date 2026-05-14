"use client";

import type { OrganizationMemberWithUser } from "@project-delivery/shared";
import { Crown, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  listOrganizationMembers,
  updateOrganizationMember,
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

const roleVariant: Record<string, "primary" | "info" | "default"> = {
  OWNER: "primary",
  ADMIN: "info",
  MEMBER: "default",
};

export function OrganizationPage() {
  const t = useTranslations("organization");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const { currentOrganization, session, status } = useSession();
  const organizationId = session?.defaultOrganizationId ?? currentOrganization?.id;

  const [members, setMembers] = useState<OrganizationMemberWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [removeMember, setRemoveMember] =
    useState<OrganizationMemberWithUser | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [memberActionErrorKey, setMemberActionErrorKey] = useState<
    string | null
  >(null);

  const activeOwnerCount = useMemo(
    () =>
      members.filter(
        (member) => member.role === "OWNER" && member.status === "ACTIVE",
      ).length,
    [members],
  );

  const load = useCallback(async () => {
    if (!organizationId) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const page = await listOrganizationMembers(organizationId);
      setMembers(page.items);
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

  async function onConfirmRemove() {
    if (!removeMember || !organizationId) {
      return;
    }

    setPendingMemberId(removeMember.id);
    setMemberActionErrorKey(null);

    try {
      const updated = await updateOrganizationMember(
        organizationId,
        removeMember.id,
        { status: "DISABLED" },
      );
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setRemoveMember(null);
    } catch (error) {
      setMemberActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPendingMemberId(null);
    }
  }

  const headerNode = (
    <PageHeader
      eyebrow={currentOrganization?.name ?? "—"}
      title={tShell("organization")}
      description={t("page.description")}
    />
  );

  if (status === "loading") {
    return (
      <div className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ListSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (!organizationId || !currentOrganization) {
    return (
      <div className="flex h-full flex-col">
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

          return (
            <li
              key={member.id}
              className={cn(
                "flex items-center gap-3 px-5 py-2.5",
                member.status === "DISABLED" && "opacity-60",
              )}
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback>{member.user.name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {member.user.name}
                  {member.role === "OWNER" && (
                    <Crown className="h-3 w-3 text-warning" />
                  )}
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  @{member.user.username}
                </div>
              </div>
              <Badge variant={roleVariant[member.role] ?? "default"}>
                {member.role}
              </Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={
                  isLastActiveOwner ||
                  member.status === "DISABLED" ||
                  pendingMemberId === member.id
                }
                onClick={() => setRemoveMember(member)}
                aria-label={t("members.actions.remove", {
                  username: member.user.username,
                })}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {headerNode}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {/* 组织信息 */}
          <section className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("info.title")}</h2>
            </header>
            <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="org-name">{t("info.fields.name")}</Label>
                <Input
                  id="org-name"
                  value={currentOrganization.name}
                  readOnly
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="org-code">{t("info.fields.code")}</Label>
                <Input
                  id="org-code"
                  value={currentOrganization.code}
                  readOnly
                />
              </div>
            </div>
            <div className="border-t border-border bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
              {t("info.readOnlyNote")}
            </div>
          </section>

          {/* 组织成员 */}
          <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("members.title")}</h2>
              <Button
                size="sm"
                className="text-xs"
                onClick={() => setIsAddMemberOpen(true)}
              >
                <Plus className="h-3 w-3" />
                {t("members.add")}
              </Button>
            </header>
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

      <AddOrgMemberDialog
        onClose={() => setIsAddMemberOpen(false)}
        onSuccess={(member) => {
          setIsAddMemberOpen(false);
          setMembers((current) => {
            const filtered = current.filter((item) => item.id !== member.id);
            return [...filtered, member];
          });
          void load();
        }}
        open={isAddMemberOpen}
        organizationId={organizationId}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setRemoveMember(null);
          }
        }}
        open={removeMember !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tRoot("organization.dialog.removeMember.title")}
            </DialogTitle>
            <DialogDescription>
              {tRoot("organization.dialog.removeMember.description", {
                username: removeMember?.user.username ?? "",
              })}
            </DialogDescription>
          </DialogHeader>

          {removeMember &&
          removeMember.role === "OWNER" &&
          activeOwnerCount <= 1 ? (
            <div
              className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
              role="alert"
            >
              {tRoot("organization.dialog.removeMember.lastOwnerWarning")}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              className="text-xs"
              disabled={pendingMemberId !== null}
              onClick={() => setRemoveMember(null)}
              size="sm"
              type="button"
              variant="outline"
            >
              {tRoot("organization.dialog.removeMember.cancel")}
            </Button>
            <Button
              className="text-xs"
              disabled={
                pendingMemberId !== null ||
                !removeMember ||
                (removeMember.role === "OWNER" && activeOwnerCount <= 1)
              }
              onClick={() => void onConfirmRemove()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {pendingMemberId !== null
                ? tRoot("organization.dialog.removeMember.submitting")
                : tRoot("organization.dialog.removeMember.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
