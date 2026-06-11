"use client";

import type {
  IntakeItem,
  IntakeSourceType,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  TagDto,
  UpdateIntakeItemRequest,
  Version,
} from "@project-delivery/shared";
import { IntakeSourceTypeSchema } from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toUpdateIntakeItemRequest } from "../../lib/intake-forms";
import { updateIntakeItem } from "../../lib/intake-service";
import { listRequirements } from "../../lib/requirement-service";
import { listSpaceMembers } from "../../lib/space-service";
import { replaceTagAssignments } from "../../lib/tag-service";
import { areTagIdsEqual, getTagIds } from "../../lib/tag-ui";
import { listVersions } from "../../lib/version-service";
import {
  filterTraceOptionsByVersion,
  getTraceVersionCascadeConfirmLabels,
  inheritVersionFromTraceOption,
  isTraceOptionCompatibleWithVersion,
  isTraceVersionCascadeRequiredError,
  traceVersionCascadeConfirmMessage,
} from "../../lib/versioned-trace-linking";

import { Button } from "../ui/button";
import { TraceVersionCascadeConfirmDialog } from "../trace-version-cascade-confirm-dialog";
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
import { Textarea } from "../ui/textarea";
import { SelectMenu } from "../ui/select-menu";
import { useSession } from "../providers/session-provider";
import { TagSelectionField } from "../tag";
import { getApiErrorDetailLines } from "../work-item/api-error-details";
type EditIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
  spaceId: string;
  intakeItem: IntakeItem | null;
  onUpdated?: (item: IntakeItem) => void;
};

const SOURCE_TYPES: IntakeSourceType[] = IntakeSourceTypeSchema.options;

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
type OptionsLoadState = "idle" | "loading" | "ready" | "failed";

export function EditIntakeDialog({
  open,
  onOpenChange,
  organizationId: explicitOrganizationId,
  spaceId,
  intakeItem,
  onUpdated,
}: EditIntakeDialogProps) {
  const t = useTranslations("intake.dialog");
  const tSourceType = useTranslations("intakeItems.sourceType");
  const tPriority = useTranslations("intakeItems.priority");
  const tTags = useTranslations("tags.field");
  const tRoot = useTranslations();
  const requestIdLabel = tRoot("errors.apiDetails.requestId");
  const { currentOrganization, session } = useSession();
  const organizationId =
    explicitOrganizationId ??
    session?.defaultOrganizationId ??
    currentOrganization?.id;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<IntakeSourceType>("AD_HOC");
  const [versionId, setVersionId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [sourceObject, setSourceObject] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [selectedTags, setSelectedTags] = useState<TagDto[]>([]);
  const [titleError, setTitleError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [pendingCascadeConfirm, setPendingCascadeConfirm] = useState<{
    request: UpdateIntakeItemRequest;
    message: string;
  } | null>(null);
  const [optionsLoadState, setOptionsLoadState] =
    useState<OptionsLoadState>("idle");
  const [optionsErrorDetails, setOptionsErrorDetails] = useState<string[]>([]);
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);

  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const filteredRequirements = useMemo(
    () => filterTraceOptionsByVersion(requirements, versionId, requirementId),
    [requirementId, requirements, versionId],
  );

  useEffect(() => {
    if (!open || !intakeItem) {
      return;
    }

    setTitle(intakeItem.title);
    setDescription(intakeItem.description ?? "");
    setSourceType(intakeItem.sourceType);
    setVersionId(intakeItem.versionId ?? "");
    setRequirementId(intakeItem.requirementId ?? "");
    setAssigneeId(intakeItem.assigneeId ?? "");
    setSourceObject(
      intakeItem.sourceObject
        ? JSON.stringify(intakeItem.sourceObject, null, 2)
        : "",
    );
    setPriority(intakeItem.priority ?? "");
    setSelectedTags(intakeItem.tags ?? []);
    setTitleError(false);
    setErrorKey(null);
    setErrorDetails([]);
    setSubmitting(false);
  }, [intakeItem, open]);

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;
    setOptionsLoadState("loading");
    setOptionsErrorDetails([]);

    void (async () => {
      try {
        const [versionPage, requirementPage, memberPage] = await Promise.all([
          listVersions({ organizationId, spaceId, page: 1, pageSize: 100 }),
          listRequirements({ organizationId, spaceId, page: 1, pageSize: 100 }),
          listSpaceMembers(spaceId, { status: "ACTIVE" }),
        ]);
        if (cancelled) {
          return;
        }
        setVersions(versionPage.items);
        setRequirements(requirementPage.items);
        setMembers(memberPage.items);
        setOptionsLoadState("ready");
      } catch (error) {
        if (!cancelled) {
          setOptionsLoadState("failed");
          setOptionsErrorDetails(
            getApiErrorDetailLines(error, {
              requestIdLabel,
            }),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, optionsReloadKey, organizationId, requestIdLabel, spaceId]);

  function reset() {
    setTitle("");
    setDescription("");
    setSourceType("AD_HOC");
    setVersionId("");
    setRequirementId("");
    setAssigneeId("");
    setSourceObject("");
    setPriority("");
    setSelectedTags([]);
    setTitleError(false);
    setErrorKey(null);
    setErrorDetails([]);
    setOptionsLoadState("idle");
    setOptionsErrorDetails([]);
    setOptionsReloadKey(0);
    setSubmitting(false);
    setPendingCascadeConfirm(null);
  }

  function retryOptionsLoad() {
    setOptionsLoadState("loading");
    setOptionsErrorDetails([]);
    setOptionsReloadKey((value) => value + 1);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  function handleVersionChange(nextVersionId: string) {
    setVersionId(nextVersionId);

    if (!requirementId) {
      return;
    }

    const selectedRequirement = requirements.find(
      (requirement) => requirement.id === requirementId,
    );

    if (
      !isTraceOptionCompatibleWithVersion(selectedRequirement, nextVersionId)
    ) {
      setRequirementId("");
    }
  }

  function handleRequirementChange(nextRequirementId: string) {
    setRequirementId(nextRequirementId);

    const nextRequirement = requirements.find(
      (requirement) => requirement.id === nextRequirementId,
    );
    setVersionId(inheritVersionFromTraceOption(nextRequirement, versionId));
  }

  async function applyTagSelection(updated: IntakeItem): Promise<IntakeItem> {
    const nextTagIds = getTagIds(selectedTags);
    const currentTagIds = getTagIds(intakeItem?.tags ?? []);

    if (areTagIdsEqual(nextTagIds, currentTagIds)) {
      return updated;
    }

    const result = await replaceTagAssignments({
      tagIds: nextTagIds,
      targetId: updated.id,
      targetType: "INTAKE_ITEM",
    });

    return { ...updated, tags: result.tags };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!intakeItem) {
      return;
    }

    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      return;
    }

    setSubmitting(true);
    setErrorKey(null);
    setErrorDetails([]);

    const request = toUpdateIntakeItemRequest({
      title: trimmed,
      description,
      sourceType,
      sourceObject,
      versionId,
      requirementId,
      assigneeId,
      priority,
    });

    try {
      const updated = await updateIntakeItem(
        { intakeItemId: intakeItem.id, organizationId, spaceId },
        request,
      );
      onUpdated?.(await applyTagSelection(updated));
      handleOpenChange(false);
    } catch (error) {
      if (isTraceVersionCascadeRequiredError(error)) {
        setPendingCascadeConfirm({
          request,
          message: traceVersionCascadeConfirmMessage(
            {
              body: tRoot("errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE"),
              labels: getTraceVersionCascadeConfirmLabels(tRoot),
              suffix: tRoot(
                "errors.api.TRACE_VERSION_CHANGE_REQUIRES_CASCADE_CONFIRM_SUFFIX",
              ),
            },
            error,
          ),
        });
        return;
      }
      setErrorKey(getApiErrorMessageKey(error));
      setErrorDetails(
        getApiErrorDetailLines(error, {
          requestIdLabel,
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmCascadeVersionChange() {
    if (!intakeItem || !pendingCascadeConfirm) {
      return;
    }

    setSubmitting(true);
    setErrorKey(null);
    setErrorDetails([]);

    try {
      const updated = await updateIntakeItem(
        { intakeItemId: intakeItem.id, organizationId, spaceId },
        {
          ...pendingCascadeConfirm.request,
          cascadeVersionChange: true,
        },
      );
      setPendingCascadeConfirm(null);
      onUpdated?.(await applyTagSelection(updated));
      handleOpenChange(false);
    } catch (error) {
      setPendingCascadeConfirm(null);
      setErrorKey(getApiErrorMessageKey(error));
      setErrorDetails(
        getApiErrorDetailLines(error, {
          requestIdLabel,
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent data-testid="edit-intake-dialog">
          <DialogHeader>
            <DialogTitle>{t("edit.title")}</DialogTitle>
            <DialogDescription>{t("edit.description")}</DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3"
            noValidate
          >
            {errorKey && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <p>{tRoot(errorKey)}</p>
                {errorDetails.map((detail) => (
                  <p
                    key={detail}
                    className="mt-1 break-words text-[11px] text-destructive/90"
                  >
                    {detail}
                  </p>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-intake-title">{t("fields.title")}</Label>
              <Input
                id="edit-intake-title"
                data-testid="edit-intake-title-input"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (titleError) {
                    setTitleError(false);
                  }
                }}
                maxLength={200}
                autoFocus
                aria-invalid={titleError}
              />
              {titleError && (
                <span className="text-[11px] text-destructive" role="alert">
                  {t("fields.titleError")}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-intake-description">
                {t("fields.description")}
              </Label>
              <Textarea
                id="edit-intake-description"
                data-testid="edit-intake-description-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={8000}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <OptionsLoadNotice
                status={optionsLoadState}
                errorDetails={optionsErrorDetails}
                onRetry={retryOptionsLoad}
                t={tRoot}
                errorTestId="edit-intake-options-error"
                retryTestId="edit-intake-options-retry"
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-intake-source">
                  {t("fields.sourceType")}
                </Label>
                <SelectMenu
                  aria-label={t("fields.sourceType")}
                  id="edit-intake-source"
                  data-testid="edit-intake-source-select"
                  value={sourceType}
                  onChange={(event) =>
                    setSourceType(event.target.value as IntakeSourceType)
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {SOURCE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {tSourceType(s)}
                    </option>
                  ))}
                </SelectMenu>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-intake-priority">
                  {t("fields.priority")}
                </Label>
                <SelectMenu
                  aria-label={t("fields.priority")}
                  id="edit-intake-priority"
                  data-testid="edit-intake-priority-select"
                  value={priority}
                  onChange={(event) =>
                    setPriority(event.target.value as Priority | "")
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{t("fields.noPriority")}</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {tPriority(p)}
                    </option>
                  ))}
                </SelectMenu>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-intake-version">
                  {t("fields.version")}
                </Label>
                <SelectMenu
                  aria-label={t("fields.version")}
                  id="edit-intake-version"
                  data-testid="edit-intake-version-select"
                  value={versionId}
                  onChange={(event) => handleVersionChange(event.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{t("fields.noVersion")}</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.name}
                    </option>
                  ))}
                </SelectMenu>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-intake-requirement">
                  {t("fields.requirement")}
                </Label>
                <SelectMenu
                  aria-label={t("fields.requirement")}
                  id="edit-intake-requirement"
                  data-testid="edit-intake-requirement-select"
                  value={requirementId}
                  onChange={(event) =>
                    handleRequirementChange(event.target.value)
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{t("fields.noRequirement")}</option>
                  {filteredRequirements.map((req) => (
                    <option key={req.id} value={req.id}>
                      {req.title || t("fields.untitledRequirement")}
                    </option>
                  ))}
                </SelectMenu>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-intake-assignee">
                  {t("fields.assignee")}
                </Label>
                <SelectMenu
                  aria-label={t("fields.assignee")}
                  id="edit-intake-assignee"
                  data-testid="edit-intake-assignee-select"
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{t("fields.unassigned")}</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.user.name || member.user.username}
                    </option>
                  ))}
                </SelectMenu>
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="edit-intake-source-object">
                  {t("fields.sourceObject")}
                </Label>
                <Textarea
                  id="edit-intake-source-object"
                  data-testid="edit-intake-source-object-input"
                  value={sourceObject}
                  onChange={(event) => setSourceObject(event.target.value)}
                  maxLength={2000}
                  rows={2}
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>{tTags("label")}</Label>
                <TagSelectionField
                  disabled={submitting}
                  onSelectedTagsChange={setSelectedTags}
                  organizationId={organizationId}
                  selectedTags={selectedTags}
                  spaceId={spaceId}
                  testId="edit-intake-tags"
                />
              </div>
            </div>

            <DialogFooter className="mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                data-testid="edit-intake-submit"
                disabled={submitting}
              >
                {submitting ? t("actions.saving") : t("actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TraceVersionCascadeConfirmDialog
        message={pendingCascadeConfirm?.message ?? ""}
        onCancel={() => setPendingCascadeConfirm(null)}
        onConfirm={() => void handleConfirmCascadeVersionChange()}
        open={pendingCascadeConfirm !== null}
        submitting={submitting}
      />
    </>
  );
}

function OptionsLoadNotice({
  errorDetails,
  errorTestId,
  onRetry,
  retryTestId,
  status,
  t,
}: {
  errorDetails: string[];
  errorTestId: string;
  onRetry: () => void;
  retryTestId: string;
  status: OptionsLoadState;
  t: (key: string) => string;
}) {
  if (status === "idle" || status === "ready") {
    return null;
  }

  if (status === "loading") {
    return (
      <div
        role="status"
        className="col-span-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        {t("common.states.optionsLoading")}
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid={errorTestId}
      className="col-span-2 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <div className="min-w-0">
        <p>{t("common.states.optionsLoadFailed")}</p>
        {errorDetails.map((detail) => (
          <p
            key={detail}
            className="mt-1 break-words text-[11px] text-destructive/90"
          >
            {detail}
          </p>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        data-testid={retryTestId}
      >
        {t("common.states.retry")}
      </Button>
    </div>
  );
}
