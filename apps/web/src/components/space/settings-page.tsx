"use client";

import type { Space, SpaceMemberWithUser } from "@project-delivery/shared";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  getSpace,
  listSpaceMembers,
  updateSpace,
  updateSpaceMember,
} from "../../lib/space-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";

import { Avatar, AvatarFallback } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";

import { AddSpaceMemberDialog } from "./add-space-member-dialog";
import { EditSpaceMemberRoleDialog } from "./edit-space-member-role-dialog";

const roleVariant: Record<string, "primary" | "info" | "warning" | "default"> =
  {
    SPACE_ADMIN: "primary",
    PM: "info",
    DEVELOPER: "default",
    TESTER: "warning",
    REQUIREMENT: "info",
    MEMBER: "default",
    VIEWER: "default",
  };

export function SpaceSettingsPage() {
  const t = useTranslations("spaceSettings");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const { currentSpace, session, status } = useSession();
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;

  const [space, setSpace] = useState<Space | null>(null);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [threshold, setThreshold] = useState("3");
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isSavingBasic, setIsSavingBasic] = useState(false);
  const [isSavingThreshold, setIsSavingThreshold] = useState(false);
  const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editRoleMember, setEditRoleMember] =
    useState<SpaceMemberWithUser | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [memberActionErrorKey, setMemberActionErrorKey] = useState<
    string | null
  >(null);

  const organizationId =
    space?.organizationId ??
    currentSpace?.organizationId ??
    session?.defaultOrganizationId;

  const existingUserIds = useMemo(
    () => new Set(members.map((member) => member.userId)),
    [members],
  );

  const load = useCallback(async () => {
    if (!spaceId) {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const [nextSpace, memberPage] = await Promise.all([
        getSpace(spaceId),
        listSpaceMembers(spaceId),
      ]);
      setSpace(nextSpace);
      setName(nextSpace.name);
      setCode(nextSpace.code);
      setThreshold(String(nextSpace.settings.staleThresholdDays));
      setMembers(memberPage.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (status !== "authenticated" || !spaceId) {
      return;
    }
    void load();
  }, [load, spaceId, status]);

  async function onSaveBasic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!space || !spaceId) {
      return;
    }

    setIsSavingBasic(true);
    setSaveErrorKey(null);
    const previous = space;
    const optimistic: Space = {
      ...space,
      name: name.trim(),
      code: code.trim(),
    };
    setSpace(optimistic);

    try {
      const updated = await updateSpace(spaceId, {
        name: optimistic.name,
        code: optimistic.code,
      });
      setSpace(updated);
      setName(updated.name);
      setCode(updated.code);
    } catch (error) {
      setSpace(previous);
      setName(previous.name);
      setCode(previous.code);
      setSaveErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSavingBasic(false);
    }
  }

  async function onSaveThreshold() {
    if (!space || !spaceId) {
      return;
    }
    const numeric = Number.parseInt(threshold, 10);
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 30) {
      setSaveErrorKey("errors.api.VALIDATION_ERROR");
      return;
    }

    setIsSavingThreshold(true);
    setSaveErrorKey(null);
    const previous = space;
    const optimistic: Space = {
      ...space,
      settings: { ...space.settings, staleThresholdDays: numeric },
    };
    setSpace(optimistic);

    try {
      const updated = await updateSpace(spaceId, {
        staleThresholdDays: numeric,
      });
      setSpace(updated);
      setThreshold(String(updated.settings.staleThresholdDays));
    } catch (error) {
      setSpace(previous);
      setThreshold(String(previous.settings.staleThresholdDays));
      setSaveErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSavingThreshold(false);
    }
  }

  async function onDisableMember(member: SpaceMemberWithUser) {
    if (!spaceId) {
      return;
    }

    const previous = members;
    setPendingMemberId(member.id);
    setMemberActionErrorKey(null);
    setMembers((current) =>
      current.map((item) =>
        item.id === member.id ? { ...item, status: "DISABLED" } : item,
      ),
    );

    try {
      const updated = await updateSpaceMember(spaceId, member.id, {
        status: "DISABLED",
      });
      setMembers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      setMembers(previous);
      setMemberActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPendingMemberId(null);
    }
  }

  const headerNode = (
    <PageHeader
      eyebrow={currentSpace?.name ?? tShell("group.configure")}
      title={tShell("spaceSettings")}
      description={t("page.description")}
    />
  );

  if (status === "loading") {
    return (
      <div data-testid="space-settings-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ListSkeleton rows={6} />
        </div>
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div data-testid="space-settings-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <EmptyState
            title={t("page.noSpace.title")}
            description={t("page.noSpace.description")}
          />
        </div>
      </div>
    );
  }

  if (errorKey) {
    return (
      <div data-testid="space-settings-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ErrorState message={tRoot(errorKey)} onRetry={() => void load()} />
        </div>
      </div>
    );
  }

  if (isLoading || !space) {
    return (
      <div data-testid="space-settings-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ListSkeleton rows={6} />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="space-settings-page" className="flex h-full flex-col">
      {headerNode}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {saveErrorKey ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
            >
              {tRoot(saveErrorKey)}
            </div>
          ) : null}

          {/* 基础信息 */}
          <section className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("basic.title")}</h2>
            </header>
            <form onSubmit={onSaveBasic}>
              <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="space-name">{t("basic.fields.name")}</Label>
                  <Input
                    id="space-name"
                    data-testid="space-settings-name-input"
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="space-code">{t("basic.fields.code")}</Label>
                  <Input
                    id="space-code"
                    data-testid="space-settings-code-input"
                    value={code}
                    maxLength={32}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end border-t border-border px-5 py-3">
                <Button
                  size="sm"
                  type="submit"
                  className="text-xs"
                  data-testid="space-settings-basic-submit"
                  disabled={isSavingBasic}
                >
                  {isSavingBasic ? t("actions.saving") : t("actions.save")}
                </Button>
              </div>
            </form>
          </section>

          {/* 异常阈值 */}
          <section className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("threshold.title")}</h2>
            </header>
            <div className="px-5 py-4">
              <div className="flex items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="stale-threshold">
                    {t("threshold.fields.staleDays")}
                  </Label>
                  <Input
                    id="stale-threshold"
                    data-testid="space-settings-threshold-input"
                    type="number"
                    min={1}
                    max={30}
                    value={threshold}
                    onChange={(event) => setThreshold(event.target.value)}
                    className="w-32"
                  />
                </div>
                <Button
                  size="sm"
                  className="text-xs"
                  type="button"
                  data-testid="space-settings-threshold-submit"
                  onClick={() => void onSaveThreshold()}
                  disabled={isSavingThreshold}
                >
                  {isSavingThreshold ? t("actions.saving") : t("actions.save")}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("threshold.hint")}
              </p>
            </div>
          </section>

          {/* 成员管理 */}
          <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("members.title")}</h2>
              <Button
                size="sm"
                className="text-xs"
                data-testid="space-settings-add-member-button"
                disabled={!organizationId}
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
            {members.length === 0 ? (
              <EmptyState title={t("members.empty")} />
            ) : (
              <ul
                data-testid="space-settings-members-list"
                className="divide-y divide-border"
              >
                {members.map((member) => (
                  <li
                    key={member.id}
                    data-testid={`space-settings-member-${member.id}`}
                    className={cn(
                      "flex items-center gap-3 px-5 py-2.5",
                      member.status === "DISABLED" && "opacity-60",
                    )}
                  >
                    <Avatar className="h-7 w-7">
                      <AvatarFallback>
                        {member.user.name.slice(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium">
                        {member.user.name}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        @{member.user.username}
                      </div>
                    </div>
                    <Badge variant={roleVariant[member.role] ?? "default"}>
                      {t(`members.roles.${member.role}`)}
                    </Badge>
                    {member.status === "DISABLED" && (
                      <Badge variant="default">
                        {t("members.statusDisabled")}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      data-testid={`space-settings-member-edit-${member.id}`}
                      disabled={
                        pendingMemberId === member.id ||
                        member.status === "DISABLED"
                      }
                      onClick={() => setEditRoleMember(member)}
                      aria-label={t("members.actions.changeRole", {
                        username: member.user.username,
                      })}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      data-testid={`space-settings-member-disable-${member.id}`}
                      disabled={
                        pendingMemberId === member.id ||
                        member.status === "DISABLED"
                      }
                      onClick={() => void onDisableMember(member)}
                      aria-label={t("members.actions.changeStatus", {
                        username: member.user.username,
                      })}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {organizationId ? (
        <AddSpaceMemberDialog
          existingUserIds={existingUserIds}
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
          spaceId={spaceId}
        />
      ) : null}

      <EditSpaceMemberRoleDialog
        member={editRoleMember}
        onClose={() => setEditRoleMember(null)}
        onSuccess={(updated) => {
          setEditRoleMember(null);
          setMembers((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          );
        }}
        open={editRoleMember !== null}
        spaceId={spaceId}
      />
    </div>
  );
}
