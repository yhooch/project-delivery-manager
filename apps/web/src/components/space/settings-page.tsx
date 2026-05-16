"use client";

import type {
  Space,
  SpaceMemberWithUser,
  SpaceRole,
} from "@project-delivery/shared";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { ApiClientError } from "../../lib/api-client";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { canManageSpace } from "../../lib/permission-gates";
import { toUpdateSpaceRequest } from "../../lib/space-forms";
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
import { SelectMenu } from "../ui/select-menu";
import { Textarea } from "../ui/textarea";
import { EmptyState, ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";

import { AddSpaceMemberDialog } from "./add-space-member-dialog";
import { EditSpaceMemberRoleDialog } from "./edit-space-member-role-dialog";

const SPACE_ROLES: readonly SpaceRole[] = [
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
  "VIEWER",
];

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
  const { currentOrganization, currentSpace, refreshSession, session, status } =
    useSession();
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;
  const writeAllowed = canManageSpace(currentSpace?.role);
  const writeDisabledHint = writeAllowed
    ? undefined
    : t("actions.viewerOnlyHint");

  const [space, setSpace] = useState<Space | null>(null);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string>("");
  const [threshold, setThreshold] = useState("3");
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [isSavingBasic, setIsSavingBasic] = useState(false);
  const [isSavingThreshold, setIsSavingThreshold] = useState(false);
  const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editRoleMember, setEditRoleMember] =
    useState<SpaceMemberWithUser | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [memberActionErrorKey, setMemberActionErrorKey] = useState<
    string | null
  >(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberRoleFilter, setMemberRoleFilter] = useState<SpaceRole | "ALL">(
    "ALL",
  );
  const loadSequenceRef = useRef(0);

  const organizationId =
    space?.organizationId ??
    currentSpace?.organizationId ??
    session?.defaultOrganizationId;

  const existingUserIds = useMemo(
    () => new Set(members.map((member) => member.userId)),
    [members],
  );

  const ownerCandidates = useMemo(
    () => members.filter((member) => member.status === "ACTIVE"),
    [members],
  );

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return members.filter((member) => {
      const identity = getSpaceMemberIdentity(member);
      if (memberRoleFilter !== "ALL" && member.role !== memberRoleFilter) {
        return false;
      }
      if (query.length === 0) {
        return true;
      }
      return (
        identity.username.toLowerCase().includes(query) ||
        identity.displayName.toLowerCase().includes(query)
      );
    });
  }, [memberRoleFilter, memberSearch, members]);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;

    if (!spaceId) {
      setSpace(null);
      setMembers([]);
      setIsLoading(false);
      setErrorKey(null);
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const [nextSpace, memberPage] = await Promise.all([
        getSpace(spaceId),
        listSpaceMembers(spaceId),
      ]);
      if (loadSequenceRef.current !== sequence) return;
      setSpace(nextSpace);
      setName(nextSpace.name);
      setCode(nextSpace.code);
      setDescription(nextSpace.description ?? "");
      setOwnerId(nextSpace.ownerId ?? "");
      setThreshold(String(nextSpace.settings.staleThresholdDays));
      setThresholdError(null);
      setMembers(memberPage.items);
    } catch (error) {
      if (loadSequenceRef.current !== sequence) return;
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (loadSequenceRef.current === sequence) {
        setIsLoading(false);
      }
    }
  }, [spaceId]);

  useEffect(() => {
    loadSequenceRef.current += 1;
    setSpace(null);
    setMembers([]);
    setName("");
    setCode("");
    setDescription("");
    setOwnerId("");
    setThreshold("3");
    setIsLoading(false);
    setErrorKey(null);
    setSaveErrorKey(null);
    setCodeError(null);
    setThresholdError(null);
    setIsAddMemberOpen(false);
    setEditRoleMember(null);
    setPendingMemberId(null);
    setMemberActionErrorKey(null);
    setMemberSearch("");
    setMemberRoleFilter("ALL");
  }, [spaceId]);

  useEffect(() => {
    if (status !== "authenticated" || !spaceId) {
      return;
    }
    void load();
  }, [load, spaceId, status]);

  async function onSaveBasic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!space || !spaceId || !writeAllowed) {
      return;
    }

    setIsSavingBasic(true);
    setSaveErrorKey(null);
    setCodeError(null);

    let request: ReturnType<typeof toUpdateSpaceRequest>;
    try {
      request = toUpdateSpaceRequest({ code, description, name, ownerId });
    } catch (error) {
      setSaveErrorKey(getApiErrorMessageKey(error));
      setIsSavingBasic(false);
      return;
    }

    const previous = space;
    const optimistic: Space = {
      ...space,
      name: request.name ?? space.name,
      code: request.code ?? space.code,
      description: request.description,
      ownerId: request.ownerId,
    };
    setSpace(optimistic);

    try {
      const updated = await updateSpace(spaceId, request);
      setSpace(updated);
      setName(updated.name);
      setCode(updated.code);
      setDescription(updated.description ?? "");
      setOwnerId(updated.ownerId ?? "");
      try {
        await refreshSession(updated.organizationId, updated.id);
      } catch (error) {
        setSaveErrorKey(getApiErrorMessageKey(error));
      }
    } catch (error) {
      setSpace(previous);
      setName(previous.name);
      setCode(previous.code);
      setDescription(previous.description ?? "");
      setOwnerId(previous.ownerId ?? "");
      if (error instanceof ApiClientError && error.error.code === "CONFLICT") {
        setCodeError("spaceSettings.basic.codeConflict");
      } else {
        setSaveErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      setIsSavingBasic(false);
    }
  }

  async function onSaveThreshold() {
    if (!space || !spaceId || !writeAllowed) {
      return;
    }
    let request: ReturnType<typeof toUpdateSpaceRequest>;
    try {
      request = toUpdateSpaceRequest({ staleThresholdDays: threshold });
    } catch {
      setThresholdError("threshold.error");
      return;
    }
    const numeric = request.staleThresholdDays;
    if (numeric === undefined) {
      setThresholdError("threshold.error");
      return;
    }

    setIsSavingThreshold(true);
    setSaveErrorKey(null);
    setThresholdError(null);
    const previous = space;
    const optimistic: Space = {
      ...space,
      settings: { ...space.settings, staleThresholdDays: numeric },
    };
    setSpace(optimistic);

    try {
      const updated = await updateSpace(spaceId, request);
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
    if (!spaceId || !writeAllowed) {
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
      <div
        data-testid="space-settings-page"
        className="flex h-full min-w-0 flex-col"
      >
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ListSkeleton rows={6} />
        </div>
      </div>
    );
  }

  if (!spaceId) {
    return (
      <div
        data-testid="space-settings-page"
        className="flex h-full min-w-0 flex-col"
      >
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
      <div
        data-testid="space-settings-page"
        className="flex h-full min-w-0 flex-col"
      >
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ErrorState message={tRoot(errorKey)} onRetry={() => void load()} />
        </div>
      </div>
    );
  }

  if (isLoading || !space) {
    return (
      <div
        data-testid="space-settings-page"
        className="flex h-full min-w-0 flex-col"
      >
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ListSkeleton rows={6} />
        </div>
      </div>
    );
  }

  const spaceStatus = space.status ?? currentSpace?.status ?? "ACTIVE";
  const ownerMember = space.ownerId
    ? members.find((member) => member.userId === space.ownerId)
    : undefined;
  const emptyValue = tRoot("common.emptyValue");

  return (
    <div
      data-testid="space-settings-page"
      className="flex h-full min-w-0 flex-col"
    >
      {headerNode}

      <div className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-4xl min-w-0 flex-col gap-6">
          {saveErrorKey ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
            >
              {tRoot(saveErrorKey)}
            </div>
          ) : null}

          {/* 概览卡 */}
          <section
            data-testid="space-settings-overview"
            className="rounded-lg border border-border bg-card px-5 py-4"
          >
            <div className="flex min-w-0 items-start gap-4">
              <Avatar className="h-12 w-12">
                <AvatarFallback className="text-base">
                  {space.name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="min-w-0 truncate text-base font-semibold">
                    {space.name}
                  </h2>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {space.code}
                  </span>
                  <Badge
                    variant={spaceStatus === "DISABLED" ? "warning" : "primary"}
                    data-testid="space-settings-status-badge"
                  >
                    {spaceStatus === "DISABLED"
                      ? t("overview.statusDisabled")
                      : t("overview.statusActive")}
                  </Badge>
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-3">
                  <div className="flex min-w-0 gap-1.5">
                    <dt>{t("overview.organizationLabel")}：</dt>
                    <dd className="min-w-0 truncate font-medium text-foreground/80">
                      {currentOrganization?.name ?? emptyValue}
                    </dd>
                  </div>
                  <div className="flex min-w-0 gap-1.5">
                    <dt>{t("overview.memberCountLabel")}：</dt>
                    <dd className="font-medium text-foreground/80">
                      {t("overview.memberCount", { count: members.length })}
                    </dd>
                  </div>
                  <div className="flex min-w-0 gap-1.5">
                    <dt>{t("overview.yourRoleLabel")}：</dt>
                    <dd className="font-medium text-foreground/80">
                      {currentSpace?.role
                        ? t(`members.roles.${currentSpace.role}`)
                        : emptyValue}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

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
                    disabled={!writeAllowed}
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
                    onChange={(event) => {
                      setCode(event.target.value);
                      if (codeError) setCodeError(null);
                    }}
                    aria-invalid={codeError ? "true" : undefined}
                    aria-describedby={
                      codeError ? "space-code-error" : "space-code-hint"
                    }
                    disabled={!writeAllowed}
                    required
                  />
                  {codeError ? (
                    <p
                      id="space-code-error"
                      data-testid="space-settings-code-error"
                      className="text-[11px] text-destructive"
                    >
                      {tRoot(codeError)}
                    </p>
                  ) : (
                    <p
                      id="space-code-hint"
                      className="text-[11px] text-muted-foreground"
                    >
                      {t("basic.fields.codeHint")}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="space-description">
                    {t("basic.fields.description")}
                  </Label>
                  <Textarea
                    id="space-description"
                    data-testid="space-settings-description-input"
                    value={description}
                    maxLength={2000}
                    placeholder={t("basic.fields.descriptionPlaceholder")}
                    onChange={(event) => setDescription(event.target.value)}
                    disabled={!writeAllowed}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="space-owner">{t("basic.fields.owner")}</Label>
                  <SelectMenu
                    id="space-owner"
                    data-testid="space-settings-owner-input"
                    className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                    disabled={!writeAllowed}
                  >
                    <option value="">{t("basic.fields.ownerNone")}</option>
                    {ownerCandidates.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.user.name} (@{member.user.username})
                      </option>
                    ))}
                  </SelectMenu>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3">
                {writeDisabledHint && (
                  <span className="text-[11px] text-muted-foreground">
                    {writeDisabledHint}
                  </span>
                )}
                <Button
                  size="sm"
                  type="submit"
                  className="text-xs"
                  data-testid="space-settings-basic-submit"
                  disabled={isSavingBasic || !writeAllowed}
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
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="stale-threshold">
                    {t("threshold.fields.staleDays")}
                  </Label>
                  <Input
                    id="stale-threshold"
                    data-testid="space-settings-threshold-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={threshold}
                    onChange={(event) => {
                      setThreshold(event.target.value);
                      if (thresholdError) setThresholdError(null);
                    }}
                    className="w-32"
                    aria-invalid={thresholdError ? "true" : undefined}
                    aria-describedby={
                      thresholdError
                        ? "space-settings-threshold-error"
                        : "space-settings-threshold-hint"
                    }
                    disabled={!writeAllowed}
                  />
                  {thresholdError ? (
                    <p
                      id="space-settings-threshold-error"
                      data-testid="space-settings-threshold-error"
                      className="text-[11px] text-destructive"
                    >
                      {t(thresholdError)}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  className="text-xs"
                  type="button"
                  data-testid="space-settings-threshold-submit"
                  onClick={() => void onSaveThreshold()}
                  disabled={isSavingThreshold || !writeAllowed}
                >
                  {isSavingThreshold ? t("actions.saving") : t("actions.save")}
                </Button>
                {writeDisabledHint && (
                  <span className="text-[11px] text-muted-foreground">
                    {writeDisabledHint}
                  </span>
                )}
              </div>
              <p
                id="space-settings-threshold-hint"
                className="mt-2 text-[11px] text-muted-foreground"
              >
                {t("threshold.hint")}
              </p>
            </div>
          </section>

          {/* 成员管理 */}
          <section className="rounded-lg border border-border bg-card">
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
              <h2 className="text-sm font-semibold">{t("members.title")}</h2>
              <span className="text-[11px] text-muted-foreground">
                {t("overview.memberCount", { count: members.length })}
              </span>
              <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
                <Input
                  data-testid="space-settings-member-search"
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                  placeholder={t("members.searchPlaceholder")}
                  className="h-8 min-w-0 flex-1 text-xs sm:w-44 sm:flex-none"
                />
                <SelectMenu
                  data-testid="space-settings-member-role-filter"
                  className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
                  value={memberRoleFilter}
                  onChange={(event) =>
                    setMemberRoleFilter(event.target.value as SpaceRole | "ALL")
                  }
                >
                  <option value="ALL">{t("members.roleFilterAll")}</option>
                  {SPACE_ROLES.map((roleKey) => (
                    <option key={roleKey} value={roleKey}>
                      {t(`members.roles.${roleKey}`)}
                    </option>
                  ))}
                </SelectMenu>
                <Button
                  size="sm"
                  className="text-xs"
                  data-testid="space-settings-add-member-button"
                  disabled={!organizationId || !writeAllowed}
                  onClick={() => setIsAddMemberOpen(true)}
                >
                  <Plus className="h-3 w-3" />
                  {t("members.add")}
                </Button>
              </div>
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
            ) : filteredMembers.length === 0 ? (
              <EmptyState title={t("members.emptyFiltered")} />
            ) : (
              <ul
                data-testid="space-settings-members-list"
                className="divide-y divide-border"
              >
                {filteredMembers.map((member) => {
                  const isOwner =
                    ownerMember?.userId === member.userId &&
                    Boolean(space.ownerId);
                  const identity = getSpaceMemberIdentity(member);
                  return (
                    <li
                      key={member.id}
                      data-testid={`space-settings-member-${member.id}`}
                      className={cn(
                        "flex min-w-0 flex-wrap items-center gap-3 px-5 py-2.5",
                        member.status === "DISABLED" && "opacity-60",
                      )}
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarFallback>
                          {initialOf(identity.displayName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] font-medium">
                          {identity.displayName}
                          {isOwner && (
                            <Badge variant="primary" className="text-[10px]">
                              {t("members.ownerBadge")}
                            </Badge>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          <span aria-hidden="true">@</span>
                          <span
                            data-testid={`space-settings-member-username-${member.id}`}
                          >
                            {identity.username}
                          </span>
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
                          !writeAllowed ||
                          pendingMemberId === member.id ||
                          member.status === "DISABLED"
                        }
                        onClick={() => setEditRoleMember(member)}
                        aria-label={t("members.actions.changeRole", {
                          username: identity.username,
                        })}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        data-testid={`space-settings-member-disable-${member.id}`}
                        disabled={
                          !writeAllowed ||
                          pendingMemberId === member.id ||
                          member.status === "DISABLED"
                        }
                        onClick={() => void onDisableMember(member)}
                        aria-label={t("members.actions.changeStatus", {
                          username: identity.username,
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </li>
                  );
                })}
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

function getSpaceMemberIdentity(member: SpaceMemberWithUser) {
  const username =
    member.user.username?.trim() || member.user.name?.trim() || member.userId;
  const displayName =
    member.user.name?.trim() || member.user.username?.trim() || member.userId;

  return { displayName, username };
}

function initialOf(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
}
