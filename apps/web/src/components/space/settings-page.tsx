"use client";

import type {
  Space,
  SpaceMemberWithUser,
  SpaceRole,
  TagDto,
  UpdateSpaceRequest,
} from "@project-delivery/shared";
import { Merge, Plus, ShieldCheck, Trash2 } from "lucide-react";
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
import {
  deleteTag,
  listTags,
  mergeTags,
  type MergeTagsResponse,
} from "../../lib/tag-service";
import { cn } from "../../lib/utils";
import { TagBadge, TagPicker } from "../tag";
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

const TAG_MERGE_SOURCE_LIMIT = 20;

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
  const requestIdLabel = tRoot("errors.apiDetails.requestId");
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
  const [error, setError] = useState<ApiErrorDisplayState | null>(null);
  const [isSavingBasic, setIsSavingBasic] = useState(false);
  const [isSavingThreshold, setIsSavingThreshold] = useState(false);
  const [saveError, setSaveError] = useState<ApiErrorDisplayState | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [editRoleMember, setEditRoleMember] =
    useState<SpaceMemberWithUser | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] =
    useState<ApiErrorDisplayState | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberRoleFilter, setMemberRoleFilter] = useState<SpaceRole | "ALL">(
    "ALL",
  );
  const [tags, setTags] = useState<TagDto[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [tagError, setTagError] = useState<ApiErrorDisplayState | null>(null);
  const [tagActionError, setTagActionError] =
    useState<ApiErrorDisplayState | null>(null);
  const [pendingTagId, setPendingTagId] = useState<string | null>(null);
  const [tagDeleteCandidate, setTagDeleteCandidate] = useState<TagDto | null>(
    null,
  );
  const [isTagMergeDialogOpen, setIsTagMergeDialogOpen] = useState(false);
  const [tagMergeSources, setTagMergeSources] = useState<TagDto[]>([]);
  const [tagMergeTarget, setTagMergeTarget] = useState<TagDto | null>(null);
  const [tagMergePreview, setTagMergePreview] =
    useState<MergeTagsResponse | null>(null);
  const [tagMergeError, setTagMergeError] =
    useState<ApiErrorDisplayState | null>(null);
  const [isLoadingTagMergePreview, setIsLoadingTagMergePreview] =
    useState(false);
  const [isMergingTag, setIsMergingTag] = useState(false);
  const loadSequenceRef = useRef(0);
  const tagLoadSequenceRef = useRef(0);
  const tagMergeRequestSequenceRef = useRef(0);

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
      setMemberActionError(getApiErrorDisplay(error, requestIdLabel));
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
      setTagError(null);
      return;
    }

    setIsLoadingTags(true);
    setTagError(null);

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
      setTagError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      if (tagLoadSequenceRef.current === sequence) {
        setIsLoadingTags(false);
      }
    }
  }, [organizationId, requestIdLabel, spaceId, tagSearch]);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;

    if (!spaceId) {
      setSpace(null);
      setMembers([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

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
      setError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      if (loadSequenceRef.current === sequence) {
        setIsLoading(false);
      }
    }
  }, [requestIdLabel, spaceId]);

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
    setError(null);
    setSaveError(null);
    setNameError(null);
    setCodeError(null);
    setDescriptionError(null);
    setOwnerError(null);
    setThresholdError(null);
    setIsAddMemberOpen(false);
    setEditRoleMember(null);
    setPendingMemberId(null);
    setMemberActionError(null);
    setMemberSearch("");
    setMemberRoleFilter("ALL");
    setTagSearch("");
    setIsLoadingTags(false);
    setTagError(null);
    setTagActionError(null);
    setPendingTagId(null);
    setTagDeleteCandidate(null);
    setIsTagMergeDialogOpen(false);
    setTagMergeSources([]);
    setTagMergeTarget(null);
    setTagMergePreview(null);
    setTagMergeError(null);
    setIsLoadingTagMergePreview(false);
    setIsMergingTag(false);
    tagMergeRequestSequenceRef.current += 1;
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
    setSaveError(null);
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
      setSaveError(getApiErrorDisplay(error, requestIdLabel));
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
        setSaveError(getApiErrorDisplay(error, requestIdLabel));
      }
    } catch (error) {
      setSpace(previous);
      setName(previous.name);
      setCode(previous.code);
      setDescription(previous.description ?? "");
      setOwnerId(previous.ownerId ?? "");
      if (error instanceof ApiClientError && error.error.code === "CONFLICT") {
        setCodeError("spaceSettings.basic.codeConflict");
        setSaveError(getApiErrorDisplay(error, requestIdLabel));
      } else {
        setSaveError(getApiErrorDisplay(error, requestIdLabel));
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
    setSaveError(null);
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
      setSaveError(getApiErrorDisplay(error, requestIdLabel));
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
    setMemberActionError(null);
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
      setMemberActionError(getApiErrorDisplay(error, requestIdLabel));
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
    setTagActionError(null);

    try {
      await deleteTag(tag.id);
      await loadTags();
    } catch (error) {
      setTagActionError(getApiErrorDisplay(error, requestIdLabel));
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

  function openTagMergeDialog(tag: TagDto) {
    tagMergeRequestSequenceRef.current += 1;
    setIsTagMergeDialogOpen(true);
    setTagMergeSources([tag]);
    setTagMergeTarget(null);
    setTagMergePreview(null);
    setTagMergeError(null);
    setIsLoadingTagMergePreview(false);
    setIsMergingTag(false);
  }

  function onTagMergeDialogOpenChange(open: boolean) {
    if (open || isMergingTag) {
      return;
    }

    tagMergeRequestSequenceRef.current += 1;
    setIsTagMergeDialogOpen(false);
    setTagMergeSources([]);
    setTagMergeTarget(null);
    setTagMergePreview(null);
    setTagMergeError(null);
    setIsLoadingTagMergePreview(false);
  }

  function addTagMergeSource(tag: TagDto) {
    if (
      tagMergeSources.length >= TAG_MERGE_SOURCE_LIMIT ||
      tagMergeSources.some((item) => item.id === tag.id) ||
      tagMergeTarget?.id === tag.id
    ) {
      return;
    }

    const nextSources = [...tagMergeSources, tag];
    setTagMergeSources(nextSources);

    if (tagMergeTarget) {
      void previewTagMerge(tagMergeTarget, nextSources);
      return;
    }

    tagMergeRequestSequenceRef.current += 1;
    setTagMergePreview(null);
    setTagMergeError(null);
    setIsLoadingTagMergePreview(false);
  }

  function removeTagMergeSource(tagId: string) {
    const nextSources = tagMergeSources.filter((tag) => tag.id !== tagId);
    setTagMergeSources(nextSources);

    if (nextSources.length === 0) {
      tagMergeRequestSequenceRef.current += 1;
      setTagMergePreview(null);
      setTagMergeError(null);
      setIsLoadingTagMergePreview(false);
      return;
    }

    if (tagMergeTarget) {
      void previewTagMerge(tagMergeTarget, nextSources);
      return;
    }

    tagMergeRequestSequenceRef.current += 1;
    setTagMergePreview(null);
    setTagMergeError(null);
    setIsLoadingTagMergePreview(false);
  }

  async function previewTagMerge(
    targetTag: TagDto,
    sourceTags = tagMergeSources,
  ) {
    const sourceTagIds = sourceTags.map((tag) => tag.id);
    if (!spaceId) {
      return;
    }

    const sequence = ++tagMergeRequestSequenceRef.current;
    setTagMergeTarget(targetTag);
    setTagMergePreview(null);
    setTagMergeError(null);

    if (sourceTagIds.length === 0) {
      setIsLoadingTagMergePreview(false);
      return;
    }

    setIsLoadingTagMergePreview(true);

    try {
      const preview = await mergeTags({
        dryRun: true,
        organizationId,
        sourceTagIds,
        targetTagId: targetTag.id,
        spaceId,
      });
      if (tagMergeRequestSequenceRef.current !== sequence) return;
      setTagMergePreview(preview);
    } catch (error) {
      if (tagMergeRequestSequenceRef.current !== sequence) return;
      setTagMergeError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      if (tagMergeRequestSequenceRef.current === sequence) {
        setIsLoadingTagMergePreview(false);
      }
    }
  }

  async function onConfirmMergeTag() {
    const targetTag = tagMergeTarget;
    const sourceTagIds = tagMergeSources.map((tag) => tag.id);
    if (sourceTagIds.length === 0 || !targetTag || !spaceId) {
      return;
    }

    setIsMergingTag(true);
    setTagMergeError(null);

    try {
      await mergeTags({
        dryRun: false,
        organizationId,
        sourceTagIds,
        targetTagId: targetTag.id,
        spaceId,
      });
      await loadTags();
      tagMergeRequestSequenceRef.current += 1;
      setIsTagMergeDialogOpen(false);
      setTagMergeSources([]);
      setTagMergeTarget(null);
      setTagMergePreview(null);
    } catch (error) {
      setTagMergeError(getApiErrorDisplay(error, requestIdLabel));
    } finally {
      setIsMergingTag(false);
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

  if (error) {
    return (
      <div
        data-testid="space-settings-page"
        className="flex h-full min-w-0 flex-col bg-background"
      >
        {headerNode}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <ErrorState
            message={formatApiErrorDisplayMessage(
              tRoot(error.messageKey),
              error.detailLines,
              " · ",
            )}
            onRetry={() => void load()}
          />
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
  const canMergeTags = writeAllowed;
  const activeMemberCount = members.filter(
    (member) => member.status === "ACTIVE",
  ).length;
  const ownerMember = space.ownerId
    ? members.find((member) => member.userId === space.ownerId)
    : undefined;
  const emptyValue = tRoot("common.emptyValue");
  const tagMergeSourceIds = tagMergeSources.map((tag) => tag.id);
  const canAddTagMergeSource =
    tagMergeSources.length < TAG_MERGE_SOURCE_LIMIT && !isMergingTag;
  const canSubmitTagMerge =
    tagMergeSources.length > 0 &&
    tagMergeTarget !== null &&
    tagMergePreview !== null &&
    !isLoadingTagMergePreview &&
    !isMergingTag;
  const tagMergeTargetTypeLabels: Record<string, string> = {
    BUG: t("dialog.mergeTag.targetTypes.BUG"),
    DOCUMENT: t("dialog.mergeTag.targetTypes.DOCUMENT"),
    INTAKE_ITEM: t("dialog.mergeTag.targetTypes.INTAKE_ITEM"),
    REQUIREMENT: t("dialog.mergeTag.targetTypes.REQUIREMENT"),
    WORK_ITEM: t("dialog.mergeTag.targetTypes.WORK_ITEM"),
  };

  return (
    <div
      data-testid="space-settings-page"
      className="flex h-full min-w-0 flex-col bg-background"
    >
      {headerNode}

      <div className="min-w-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-12">
          {saveError ? (
            <div
              role="alert"
              className="whitespace-pre-wrap rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {formatApiErrorDisplayMessage(
                tRoot(saveError.messageKey),
                saveError.detailLines,
              )}
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

              {tagActionError ? (
                <div
                  className="whitespace-pre-wrap rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {formatApiErrorDisplayMessage(
                    tRoot(tagActionError.messageKey),
                    tagActionError.detailLines,
                  )}
                </div>
              ) : null}

              {tagError ? (
                <ErrorState
                  className="h-48"
                  message={formatApiErrorDisplayMessage(
                    tRoot(tagError.messageKey),
                    tagError.detailLines,
                    " · ",
                  )}
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
                          {canMergeTags ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              data-testid={`space-settings-tag-merge-${tag.id}`}
                              disabled={pendingTagId === tag.id}
                              onClick={() => openTagMergeDialog(tag)}
                              aria-label={t("tags.actions.mergeAria", {
                                name: tag.displayName,
                              })}
                            >
                              <Merge className="h-4 w-4" />
                              {t("tags.actions.merge")}
                            </Button>
                          ) : null}
                          {canDeleteOrphanTags && isOrphan ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              data-testid={`space-settings-tag-delete-${tag.id}`}
                              disabled={pendingTagId === tag.id}
                              onClick={() => {
                                setTagActionError(null);
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
              {memberActionError && (
                <div
                  className="whitespace-pre-wrap rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {formatApiErrorDisplayMessage(
                    tRoot(memberActionError.messageKey),
                    memberActionError.detailLines,
                  )}
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
        onOpenChange={onTagMergeDialogOpenChange}
        open={isTagMergeDialogOpen}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("dialog.mergeTag.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.mergeTag.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-muted/20 px-4 py-3">
              <Label
                htmlFor="space-tag-merge-source"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("dialog.mergeTag.sourceLabel")}
              </Label>
              <div className="flex min-h-7 flex-wrap items-center gap-2">
                {tagMergeSources.length > 0 ? (
                  tagMergeSources.map((tag) => (
                    <TagBadge
                      key={tag.id}
                      data-testid={`space-settings-tag-merge-source-${tag.id}`}
                      disabled={isMergingTag}
                      onRemove={() => removeTagMergeSource(tag.id)}
                      tag={tag}
                    />
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("dialog.mergeTag.sourceEmpty")}
                  </span>
                )}
              </div>
              <TagPicker
                allowCreate={false}
                data-testid="space-settings-tag-merge-source-picker"
                disabled={!canAddTagMergeSource}
                excludeTagIds={tagMergeTarget ? [tagMergeTarget.id] : []}
                inputId="space-tag-merge-source"
                onSelect={addTagMergeSource}
                organizationId={organizationId}
                placeholder={
                  canAddTagMergeSource
                    ? t("dialog.mergeTag.sourcePlaceholder")
                    : t("dialog.mergeTag.sourceLimit")
                }
                selectedTags={tagMergeSources}
                spaceId={spaceId}
              />
            </div>

            <p className="rounded-md bg-warning/10 px-4 py-3 text-sm leading-6 text-foreground">
              {t("dialog.mergeTag.warning")}
            </p>

            <div className="flex min-w-0 flex-col gap-2">
              <Label
                htmlFor="space-tag-merge-target"
                className="text-sm font-medium"
              >
                {t("dialog.mergeTag.targetLabel")}
              </Label>
              {tagMergeTarget ? (
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("dialog.mergeTag.selectedTarget")}</span>
                  <TagBadge tag={tagMergeTarget} />
                </div>
              ) : null}
              <TagPicker
                allowCreate={false}
                data-testid="space-settings-tag-merge-target-picker"
                excludeTagIds={tagMergeSourceIds}
                inputId="space-tag-merge-target"
                onSelect={(tag) => void previewTagMerge(tag)}
                organizationId={organizationId}
                placeholder={t("dialog.mergeTag.targetPlaceholder")}
                selectedTags={tagMergeTarget ? [tagMergeTarget] : []}
                spaceId={spaceId}
              />
            </div>

            {tagMergeError ? (
              <div
                className="whitespace-pre-wrap rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                {formatApiErrorDisplayMessage(
                  tRoot(tagMergeError.messageKey),
                  tagMergeError.detailLines,
                )}
              </div>
            ) : null}

            <div
              className="rounded-md border border-border px-4 py-3"
              data-testid="space-settings-tag-merge-preview"
            >
              <div className="text-sm font-medium text-foreground">
                {t("dialog.mergeTag.previewTitle")}
              </div>
              {isLoadingTagMergePreview ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("dialog.mergeTag.previewLoading")}
                </p>
              ) : tagMergePreview ? (
                <div className="mt-3 flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <TagMergePreviewMetric
                      label={t("dialog.mergeTag.metrics.removed")}
                      value={tagMergePreview.sourceAssignmentsRemoved}
                    />
                    <TagMergePreviewMetric
                      label={t("dialog.mergeTag.metrics.created")}
                      value={tagMergePreview.targetAssignmentsCreated}
                    />
                    <TagMergePreviewMetric
                      label={t("dialog.mergeTag.metrics.duplicates")}
                      value={tagMergePreview.duplicateAssignmentsSkipped}
                    />
                    <TagMergePreviewMetric
                      label={t("dialog.mergeTag.metrics.deletedTags")}
                      value={tagMergePreview.deletedSourceTags}
                    />
                  </div>
                  {tagMergePreview.affectedTargetsByType.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {tagMergePreview.affectedTargetsByType.map((item) => (
                        <Badge
                          key={item.targetType}
                          variant="outline"
                          className="font-normal"
                        >
                          {tagMergeTargetTypeLabels[item.targetType] ??
                            item.targetType}
                          : {item.count}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("dialog.mergeTag.noAffectedTargets")}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("dialog.mergeTag.previewEmpty")}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              disabled={isMergingTag}
              onClick={() => onTagMergeDialogOpenChange(false)}
              type="button"
              variant="secondary"
            >
              {t("dialog.mergeTag.cancel")}
            </Button>
            <Button
              disabled={!canSubmitTagMerge}
              onClick={() => void onConfirmMergeTag()}
              type="button"
              data-testid="space-settings-tag-merge-submit"
            >
              {isMergingTag
                ? t("dialog.mergeTag.submitting")
                : t("dialog.mergeTag.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function TagMergePreviewMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md bg-muted/30 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
        {label}
      </div>
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
