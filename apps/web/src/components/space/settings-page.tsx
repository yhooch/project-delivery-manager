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
        className="flex h-full min-w-0 flex-col bg-background"
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
        className="flex h-full min-w-0 flex-col bg-background"
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
        className="flex h-full min-w-0 flex-col bg-background"
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
        className="flex h-full min-w-0 flex-col bg-background"
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
      className="flex h-full min-w-0 flex-col bg-background"
    >
      {headerNode}

      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-12">
          {saveErrorKey ? (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {tRoot(saveErrorKey)}
            </div>
          ) : null}

          {/* 概览区 */}
          <section
            data-testid="space-settings-overview"
            className="flex min-w-0 items-center gap-6"
          >
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-xl bg-primary/10 text-primary font-medium">
                {space.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h2 className="min-w-0 truncate text-xl font-medium tracking-tight">
                  {space.name}
                </h2>
                <span className="font-mono text-xs text-muted-foreground mt-0.5">
                  {space.code}
                </span>
                <Badge
                  variant={spaceStatus === "DISABLED" ? "warning" : "primary"}
                  data-testid="space-settings-status-badge"
                  className="font-normal"
                >
                  {spaceStatus === "DISABLED"
                    ? t("overview.statusDisabled")
                    : t("overview.statusActive")}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="opacity-80">
                    {t("overview.organizationLabel")}:
                  </span>
                  <span className="font-medium text-foreground">
                    {currentOrganization?.name ?? emptyValue}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="opacity-80">
                    {t("overview.memberCountLabel")}:
                  </span>
                  <span className="font-medium text-foreground">
                    {members.length}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="opacity-80">
                    {t("overview.yourRoleLabel")}:
                  </span>
                  <span className="font-medium text-foreground">
                    {currentSpace?.role
                      ? t(`members.roles.${currentSpace.role}`)
                      : emptyValue}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <div className="h-px w-full bg-border/50" />

          {/* 基础信息 */}
          <section className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
            <div>
              <h2 className="text-base font-medium text-foreground">
                {t("basic.title")}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {t("basic.description")}
              </p>
            </div>

            <form
              id="basic-settings-form"
              onSubmit={onSaveBasic}
              className="flex flex-col gap-6"
            >
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="space-name" className="text-sm font-medium">
                    {t("basic.fields.name")}
                  </Label>
                  <Input
                    id="space-name"
                    data-testid="space-settings-name-input"
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                    disabled={!writeAllowed}
                    className="max-w-md bg-transparent"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="space-code" className="text-sm font-medium">
                    {t("basic.fields.code")}
                  </Label>
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
                    className="max-w-md bg-transparent"
                    required
                  />
                  {codeError ? (
                    <p
                      id="space-code-error"
                      data-testid="space-settings-code-error"
                      className="text-[11px] text-destructive mt-1"
                    >
                      {tRoot(codeError)}
                    </p>
                  ) : (
                    <p
                      id="space-code-hint"
                      className="text-[11px] text-muted-foreground mt-1"
                    >
                      {t("basic.fields.codeHint")}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 md:col-span-2">
                  <Label htmlFor="space-owner" className="text-sm font-medium">
                    {t("basic.fields.owner")}
                  </Label>
                  <SelectMenu
                    id="space-owner"
                    data-testid="space-settings-owner-input"
                    className="flex h-9 w-full max-w-md rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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
                <div className="flex flex-col gap-2 md:col-span-2">
                  <Label
                    htmlFor="space-description"
                    className="text-sm font-medium"
                  >
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
                    className="max-w-2xl min-h-[100px] resize-y bg-transparent"
                  />
                </div>
              </div>
              <div className="flex items-center gap-4 pt-2">
                <Button
                  size="sm"
                  type="submit"
                  form="basic-settings-form"
                  data-testid="space-settings-basic-submit"
                  disabled={isSavingBasic || !writeAllowed}
                >
                  {isSavingBasic ? t("actions.saving") : t("actions.save")}
                </Button>
                {!writeAllowed && (
                  <span className="text-sm text-muted-foreground">
                    {writeDisabledHint}
                  </span>
                )}
              </div>
            </form>
          </section>

          <div className="h-px w-full bg-border/50" />

          {/* 异常阈值 */}
          <section className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
            <div>
              <h2 className="text-base font-medium text-foreground">
                {t("threshold.title")}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {t("threshold.description")}
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="stale-threshold"
                  className="text-sm font-medium"
                >
                  {t("threshold.fields.staleDays")}
                </Label>
                <div className="flex items-center gap-3">
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
                    className="w-32 bg-transparent"
                    aria-invalid={thresholdError ? "true" : undefined}
                    aria-describedby={
                      thresholdError
                        ? "space-settings-threshold-error"
                        : "space-settings-threshold-hint"
                    }
                    disabled={!writeAllowed}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    data-testid="space-settings-threshold-submit"
                    onClick={() => void onSaveThreshold()}
                    disabled={isSavingThreshold || !writeAllowed}
                  >
                    {isSavingThreshold
                      ? t("actions.saving")
                      : t("actions.save")}
                  </Button>
                </div>
                {thresholdError && (
                  <p
                    id="space-settings-threshold-error"
                    data-testid="space-settings-threshold-error"
                    className="text-[11px] text-destructive mt-1"
                  >
                    {t(thresholdError)}
                  </p>
                )}
                <p
                  id="space-settings-threshold-hint"
                  className="mt-1 text-[11px] text-muted-foreground"
                >
                  {t("threshold.hint")}
                </p>
              </div>
            </div>
          </section>

          <div className="h-px w-full bg-border/50" />

          {/* 成员管理 */}
          <section className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8">
            <div>
              <h2 className="text-base font-medium text-foreground">
                {t("members.title")}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {t("members.description")}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-6"
                data-testid="space-settings-add-member-button"
                disabled={!organizationId || !writeAllowed}
                onClick={() => setIsAddMemberOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2 -ml-1" />
                {t("members.add")}
              </Button>
            </div>

            <div className="flex flex-col gap-4">
              {!writeAllowed && (
                <div className="w-fit rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  {writeDisabledHint}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  data-testid="space-settings-member-search"
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                  placeholder={t("members.searchPlaceholder")}
                  className="h-9 min-w-0 flex-1 max-w-sm text-sm bg-transparent"
                />
                <SelectMenu
                  data-testid="space-settings-member-role-filter"
                  className="h-9 w-40 min-w-0 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
              </div>
              {memberActionErrorKey && (
                <div
                  className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {tRoot(memberActionErrorKey)}
                </div>
              )}
              <div className="w-full pt-2">
                {members.length === 0 ? (
                  <EmptyState title={t("members.empty")} />
                ) : filteredMembers.length === 0 ? (
                  <EmptyState title={t("members.emptyFiltered")} />
                ) : (
                  <ul
                    data-testid="space-settings-members-list"
                    className="flex flex-col gap-2"
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
                            "group flex flex-col sm:flex-row sm:items-center gap-3 py-3",
                            member.status === "DISABLED" &&
                              "opacity-60 grayscale-[0.2]",
                          )}
                        >
                          <div className="flex flex-1 items-center gap-4 min-w-0">
                            <Avatar className="h-10 w-10 shrink-0">
                              <AvatarFallback className="bg-muted text-muted-foreground">
                                {initialOf(identity.displayName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="text-sm font-medium truncate text-foreground">
                                  {identity.displayName}
                                </span>
                                {isOwner && (
                                  <Badge
                                    variant="primary"
                                    className="text-[10px] font-normal leading-none h-4 px-1 shrink-0"
                                  >
                                    {t("members.ownerBadge")}
                                  </Badge>
                                )}
                              </div>
                              <div className="font-mono text-[13px] text-muted-foreground truncate">
                                <span aria-hidden="true">@</span>
                                <span
                                  data-testid={`space-settings-member-username-${member.id}`}
                                >
                                  {identity.username}
                                </span>
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
                              {member.status === "DISABLED" && (
                                <Badge
                                  variant="outline"
                                  className="font-normal text-muted-foreground"
                                >
                                  {t("members.statusDisabled")}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
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
                                className="hover:bg-muted"
                              >
                                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
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
                                className="hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
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
