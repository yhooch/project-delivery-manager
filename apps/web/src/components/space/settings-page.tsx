"use client";

import type {
  Space,
  SpaceMemberWithUser,
  SpaceRole,
  TagDto,
  UpdateSpaceRequest,
} from "@project-delivery/shared";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ZodIssue } from "zod";

import { ApiClientError } from "../../lib/api-client";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { canManageSpace } from "../../lib/permission-gates";
import {
  toUpdateSpaceRequest,
  updateSpaceFormSchema,
} from "../../lib/space-forms";
import {
  getSpace,
  listSpaceMembers,
  updateSpace,
  updateSpaceMember,
} from "../../lib/space-service";
import { deleteTag, listTags } from "../../lib/tag-service";
import { cn } from "../../lib/utils";
import { TagBadge } from "../tag";
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
import { SelectMenu } from "../ui/select-menu";
import { Textarea } from "../ui/textarea";
import { Tip } from "../ui/tooltip";
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

type BasicField = "code" | "description" | "name" | "ownerId";
type BasicFieldErrors = Partial<Record<BasicField, string>>;

export function SpaceSettingsPage() {
  const t = useTranslations("spaceSettings");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { currentOrganization, currentSpace, refreshSession, session, status } =
    useSession();
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;
  const writeAllowed = canManageSpace(currentSpace?.role, currentSpace?.status);
  const canDeleteOrphanTags = writeAllowed;
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
  const [nameError, setNameError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
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
  const [tags, setTags] = useState<TagDto[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [tagErrorKey, setTagErrorKey] = useState<string | null>(null);
  const [tagActionErrorKey, setTagActionErrorKey] = useState<string | null>(
    null,
  );
  const [pendingTagId, setPendingTagId] = useState<string | null>(null);
  const [tagDeleteCandidate, setTagDeleteCandidate] = useState<TagDto | null>(
    null,
  );
  const loadSequenceRef = useRef(0);
  const tagLoadSequenceRef = useRef(0);

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

  function refreshAfterCurrentUserMemberChange(member: SpaceMemberWithUser) {
    if (member.userId !== session?.user.id) {
      return;
    }

    const recentSpaceId =
      member.status === "ACTIVE" ? member.spaceId : undefined;

    void refreshSession(member.organizationId, recentSpaceId).catch((error) => {
      setMemberActionErrorKey(getApiErrorMessageKey(error));
    });
  }

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

  const loadTags = useCallback(async () => {
    const sequence = ++tagLoadSequenceRef.current;

    if (!spaceId) {
      setTags([]);
      setIsLoadingTags(false);
      setTagErrorKey(null);
      return;
    }

    setIsLoadingTags(true);
    setTagErrorKey(null);

    try {
      const page = await listTags({
        includeUsage: true,
        organizationId,
        page: 1,
        pageSize: 100,
        query: tagSearch.trim() || undefined,
        spaceId,
      });
      if (tagLoadSequenceRef.current !== sequence) return;
      setTags(page.items);
    } catch (error) {
      if (tagLoadSequenceRef.current !== sequence) return;
      setTagErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (tagLoadSequenceRef.current === sequence) {
        setIsLoadingTags(false);
      }
    }
  }, [organizationId, spaceId, tagSearch]);

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
    tagLoadSequenceRef.current += 1;
    setSpace(null);
    setMembers([]);
    setTags([]);
    setName("");
    setCode("");
    setDescription("");
    setOwnerId("");
    setThreshold("3");
    setIsLoading(false);
    setErrorKey(null);
    setSaveErrorKey(null);
    setNameError(null);
    setCodeError(null);
    setDescriptionError(null);
    setOwnerError(null);
    setThresholdError(null);
    setIsAddMemberOpen(false);
    setEditRoleMember(null);
    setPendingMemberId(null);
    setMemberActionErrorKey(null);
    setMemberSearch("");
    setMemberRoleFilter("ALL");
    setTagSearch("");
    setIsLoadingTags(false);
    setTagErrorKey(null);
    setTagActionErrorKey(null);
    setPendingTagId(null);
    setTagDeleteCandidate(null);
  }, [spaceId]);

  useEffect(() => {
    if (status !== "authenticated" || !spaceId) {
      return;
    }
    void load();
  }, [load, spaceId, status]);

  useEffect(() => {
    if (status !== "authenticated" || !spaceId) {
      return;
    }
    void loadTags();
  }, [loadTags, spaceId, status]);

  async function onSaveBasic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!space || !spaceId || !writeAllowed) {
      return;
    }

    setIsSavingBasic(true);
    setSaveErrorKey(null);
    setNameError(null);
    setCodeError(null);
    setDescriptionError(null);
    setOwnerError(null);

    const basicFieldErrors = validateBasicForm({
      code,
      description,
      name,
      ownerId,
    });
    if (hasBasicFieldErrors(basicFieldErrors)) {
      setNameError(basicFieldErrors.name ?? null);
      setCodeError(basicFieldErrors.code ?? null);
      setDescriptionError(basicFieldErrors.description ?? null);
      setOwnerError(basicFieldErrors.ownerId ?? null);
      setIsSavingBasic(false);
      return;
    }

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
      description: request.description ?? undefined,
      ownerId: request.ownerId ?? undefined,
    };
    setSpace(optimistic);

    try {
      const updated = await updateSpace(spaceId, request as UpdateSpaceRequest);
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
      const updated = await updateSpace(spaceId, request as UpdateSpaceRequest);
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
      refreshAfterCurrentUserMemberChange(updated);
    } catch (error) {
      setMembers(previous);
      setMemberActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPendingMemberId(null);
    }
  }

  async function onConfirmDeleteTag() {
    const tag = tagDeleteCandidate;
    if (!tag || !canDeleteOrphanTags || !isTagOrphan(tag)) {
      return;
    }

    setPendingTagId(tag.id);
    setTagActionErrorKey(null);

    try {
      await deleteTag(tag.id);
      await loadTags();
    } catch (error) {
      setTagActionErrorKey(getApiErrorMessageKey(error));
      await loadTags();
    } finally {
      setPendingTagId(null);
      setTagDeleteCandidate(null);
    }
  }

  function onTagDeleteDialogOpenChange(open: boolean) {
    if (open || pendingTagId) {
      return;
    }

    setTagDeleteCandidate(null);
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
  const activeMemberCount = members.filter(
    (member) => member.status === "ACTIVE",
  ).length;
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
                    {activeMemberCount}
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
              className="flex min-w-0 flex-col gap-6"
            >
              <div className="grid min-w-0 gap-5 md:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="space-name" className="text-sm font-medium">
                    {t("basic.fields.name")}
                  </Label>
                  <Input
                    id="space-name"
                    data-testid="space-settings-name-input"
                    value={name}
                    maxLength={120}
                    onChange={(event) => {
                      setName(event.target.value);
                      if (nameError) setNameError(null);
                    }}
                    aria-invalid={nameError ? "true" : undefined}
                    aria-describedby={
                      nameError ? "space-name-error" : undefined
                    }
                    disabled={!writeAllowed}
                    className="max-w-full bg-transparent md:max-w-md"
                    required
                  />
                  {nameError ? (
                    <p
                      id="space-name-error"
                      data-testid="space-settings-name-error"
                      className="text-[11px] text-destructive mt-1"
                    >
                      {tRoot(nameError)}
                    </p>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-2">
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
                    className="max-w-full bg-transparent md:max-w-md"
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
                <div className="flex min-w-0 flex-col gap-2 md:col-span-2">
                  <Label htmlFor="space-owner" className="text-sm font-medium">
                    {t("basic.fields.owner")}
                  </Label>
                  <SelectMenu
                    id="space-owner"
                    data-testid="space-settings-owner-input"
                    className="flex h-9 w-full max-w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:max-w-md"
                    value={ownerId}
                    onChange={(event) => {
                      setOwnerId(event.target.value);
                      if (ownerError) setOwnerError(null);
                    }}
                    aria-invalid={ownerError ? "true" : undefined}
                    aria-describedby={
                      ownerError ? "space-owner-error" : undefined
                    }
                    disabled={!writeAllowed}
                  >
                    <option value="">{t("basic.fields.ownerNone")}</option>
                    {ownerCandidates.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.user.name} (@{member.user.username})
                      </option>
                    ))}
                  </SelectMenu>
                  {ownerError ? (
                    <p
                      id="space-owner-error"
                      data-testid="space-settings-owner-error"
                      className="text-[11px] text-destructive mt-1"
                    >
                      {tRoot(ownerError)}
                    </p>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-2 md:col-span-2">
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
                    onChange={(event) => {
                      setDescription(event.target.value);
                      if (descriptionError) setDescriptionError(null);
                    }}
                    aria-invalid={descriptionError ? "true" : undefined}
                    aria-describedby={
                      descriptionError ? "space-description-error" : undefined
                    }
                    disabled={!writeAllowed}
                    className="min-h-[100px] max-w-full resize-y bg-transparent md:max-w-2xl"
                  />
                  {descriptionError ? (
                    <p
                      id="space-description-error"
                      data-testid="space-settings-description-error"
                      className="text-[11px] text-destructive mt-1"
                    >
                      {tRoot(descriptionError)}
                    </p>
                  ) : null}
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

          {/* 标签字典 */}
          <section
            data-testid="space-settings-tags-section"
            className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8"
          >
            <div>
              <h2 className="text-base font-medium text-foreground">
                {t("tags.title")}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {t("tags.description")}
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex max-w-sm min-w-0 flex-col gap-2">
                <Label
                  htmlFor="space-tags-search"
                  className="text-sm font-medium"
                >
                  {t("tags.searchLabel")}
                </Label>
                <Input
                  id="space-tags-search"
                  data-testid="space-settings-tag-search"
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                  placeholder={t("tags.searchPlaceholder")}
                  className="h-9 bg-transparent"
                />
              </div>

              {tagActionErrorKey ? (
                <div
                  className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {tRoot(tagActionErrorKey)}
                </div>
              ) : null}

              {tagErrorKey ? (
                <ErrorState
                  className="h-48"
                  message={tRoot(tagErrorKey)}
                  onRetry={() => void loadTags()}
                />
              ) : isLoadingTags && tags.length === 0 ? (
                <ListSkeleton rows={3} />
              ) : tags.length === 0 ? (
                <EmptyState
                  title={
                    tagSearch.trim() ? t("tags.emptyFiltered") : t("tags.empty")
                  }
                />
              ) : (
                <ul
                  data-testid="space-settings-tags-list"
                  className="flex flex-col gap-2"
                >
                  {tags.map((tag) => {
                    const isOrphan = isTagOrphan(tag);
                    const usageLabel =
                      typeof tag.usageCount === "number"
                        ? t("tags.usage", { count: tag.usageCount })
                        : emptyValue;
                    const createdAtLabel =
                      formatTagCreatedAt(tag.createdAt, locale) ?? emptyValue;

                    return (
                      <li
                        key={tag.id}
                        data-testid={`space-settings-tag-${tag.id}`}
                        className="group flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <TagBadge tag={tag} className="max-w-full" />
                        </div>
                        <div className="grid min-w-0 gap-1 text-xs text-muted-foreground sm:min-w-[260px] sm:grid-cols-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span>{t("tags.usageLabel")}:</span>
                            <span className="font-medium text-foreground">
                              {usageLabel}
                            </span>
                          </div>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span>{t("tags.createdAtLabel")}:</span>
                            <span className="truncate font-medium text-foreground">
                              {createdAtLabel}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:pl-2">
                          <Badge
                            variant={isOrphan ? "warning" : "default"}
                            className="font-normal"
                          >
                            {isOrphan
                              ? t("tags.status.orphan")
                              : t("tags.status.inUse")}
                          </Badge>
                          {canDeleteOrphanTags && isOrphan ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              data-testid={`space-settings-tag-delete-${tag.id}`}
                              disabled={pendingTagId === tag.id}
                              onClick={() => {
                                setTagActionErrorKey(null);
                                setTagDeleteCandidate(tag);
                              }}
                              aria-label={t("tags.actions.delete", {
                                name: tag.displayName,
                              })}
                              className="hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
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
                  aria-label={t("members.searchLabel")}
                  placeholder={t("members.searchPlaceholder")}
                  className="h-9 min-w-0 flex-1 max-w-sm text-sm bg-transparent"
                />
                <SelectMenu
                  data-testid="space-settings-member-role-filter"
                  className="h-9 w-40 min-w-0 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={memberRoleFilter}
                  aria-label={t("members.roleFilterLabel")}
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
                      const changeRoleLabel = t("members.actions.changeRole", {
                        username: identity.username,
                      });
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
                              <Tip content={changeRoleLabel}>
                                <span className="inline-flex">
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
                                    aria-label={changeRoleLabel}
                                    className="hover:bg-muted"
                                  >
                                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </span>
                              </Tip>
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
          refreshAfterCurrentUserMemberChange(updated);
        }}
        open={editRoleMember !== null}
        spaceId={spaceId}
      />

      <Dialog
        onOpenChange={onTagDeleteDialogOpenChange}
        open={tagDeleteCandidate !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialog.deleteOrphanTag.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.deleteOrphanTag.description", {
                name: tagDeleteCandidate?.displayName ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={pendingTagId !== null}
              onClick={() => setTagDeleteCandidate(null)}
              type="button"
              variant="secondary"
            >
              {t("dialog.deleteOrphanTag.cancel")}
            </Button>
            <Button
              disabled={pendingTagId !== null}
              onClick={() => void onConfirmDeleteTag()}
              type="button"
              variant="destructive"
            >
              {pendingTagId
                ? t("dialog.deleteOrphanTag.submitting")
                : t("dialog.deleteOrphanTag.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isTagOrphan(tag: TagDto) {
  if (typeof tag.isOrphan === "boolean") {
    return tag.isOrphan;
  }

  return typeof tag.usageCount === "number" ? tag.usageCount === 0 : false;
}

function formatTagCreatedAt(value: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return undefined;
  }
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

function validateBasicForm(input: {
  code: string;
  description: string;
  name: string;
  ownerId: string;
}): BasicFieldErrors {
  const errors: BasicFieldErrors = {};
  const trimmedName = input.name.trim();
  const trimmedCode = input.code.trim();

  if (trimmedName.length < 1) {
    errors.name = "spaceSettings.basic.errors.nameRequired";
  } else if (trimmedName.length > 120) {
    errors.name = "spaceSettings.basic.errors.nameTooLong";
  }

  if (trimmedCode.length < 1) {
    errors.code = "spaceSettings.basic.errors.codeRequired";
  }

  const result = updateSpaceFormSchema.safeParse(input);
  if (!result.success) {
    Object.assign(errors, mapBasicFormErrors(result.error.issues, errors));
  }

  return errors;
}

function mapBasicFormErrors(
  issues: ZodIssue[],
  existingErrors: BasicFieldErrors,
): BasicFieldErrors {
  const errors: BasicFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (
      field !== "name" &&
      field !== "code" &&
      field !== "description" &&
      field !== "ownerId"
    ) {
      continue;
    }
    if (existingErrors[field] || errors[field]) {
      continue;
    }

    if (field === "name") {
      errors.name =
        issue.code === "too_big"
          ? "spaceSettings.basic.errors.nameTooLong"
          : "spaceSettings.basic.errors.nameRequired";
    } else if (field === "code") {
      errors.code = "spaceSettings.basic.errors.codeInvalid";
    } else if (field === "description") {
      errors.description = "spaceSettings.basic.errors.descriptionTooLong";
    } else {
      errors.ownerId = "spaceSettings.basic.errors.ownerInvalid";
    }
  }

  return errors;
}

function hasBasicFieldErrors(errors: BasicFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}
