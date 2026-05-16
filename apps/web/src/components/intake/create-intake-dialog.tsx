"use client";

import type {
  IntakeSourceType,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  Version,
} from "@project-delivery/shared";
import { IntakeSourceTypeSchema } from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toCreateIntakeItemRequest } from "../../lib/intake-forms";
import { createIntakeItem } from "../../lib/intake-service";
import { listRequirements } from "../../lib/requirement-service";
import { listSpaceMembers } from "../../lib/space-service";
import { listVersions } from "../../lib/version-service";
import {
  filterTraceOptionsByVersion,
  inheritVersionFromTraceOption,
  isTraceOptionCompatibleWithVersion,
} from "../../lib/versioned-trace-linking";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { SelectMenu } from "../ui/select-menu";
import { useSession } from "../providers/session-provider";
type CreateIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
  spaceId: string;
  onCreated?: () => void;
};

const SOURCE_TYPES: IntakeSourceType[] = IntakeSourceTypeSchema.options;

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
type OptionsLoadState = "idle" | "loading" | "ready" | "failed";

export function CreateIntakeDialog({
  open,
  onOpenChange,
  organizationId: explicitOrganizationId,
  spaceId,
  onCreated,
}: CreateIntakeDialogProps) {
  const t = useTranslations("intake.dialog");
  const tSourceType = useTranslations("intakeItems.sourceType");
  const tPriority = useTranslations("intakeItems.priority");
  const tRoot = useTranslations();
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
  const [titleError, setTitleError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [optionsLoadState, setOptionsLoadState] =
    useState<OptionsLoadState>("idle");
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);

  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);

  const optionFieldsDisabled = submitting || optionsLoadState !== "ready";
  const submitDisabled = submitting || optionsLoadState !== "ready";
  const filteredRequirements = useMemo(
    () => filterTraceOptionsByVersion(requirements, versionId, requirementId),
    [requirementId, requirements, versionId],
  );

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;
    setOptionsLoadState("loading");

    void (async () => {
      try {
        const [versionPage, requirementPage, memberPage] = await Promise.all([
          listVersions({ organizationId, spaceId, page: 1, pageSize: 100 }),
          listRequirements({ organizationId, spaceId, page: 1, pageSize: 100 }),
          listSpaceMembers(spaceId),
        ]);
        if (cancelled) {
          return;
        }
        setVersions(versionPage.items);
        setRequirements(requirementPage.items);
        setMembers(memberPage.items);
        setOptionsLoadState("ready");
      } catch {
        if (!cancelled) {
          setOptionsLoadState("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, optionsReloadKey, organizationId, spaceId]);

  function reset() {
    setTitle("");
    setDescription("");
    setSourceType("AD_HOC");
    setVersionId("");
    setRequirementId("");
    setAssigneeId("");
    setSourceObject("");
    setPriority("");
    setTitleError(false);
    setErrorKey(null);
    setOptionsLoadState("idle");
    setOptionsReloadKey(0);
    setSubmitting(false);
  }

  function retryOptionsLoad() {
    setOptionsLoadState("loading");
    setOptionsReloadKey((value) => value + 1);
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

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    try {
      await createIntakeItem(
        { organizationId, spaceId },
        toCreateIntakeItemRequest({
          assigneeId: assigneeId || undefined,
          title: trimmed,
          description: description.trim() || undefined,
          sourceType,
          sourceObject,
          versionId: versionId || undefined,
          requirementId: requirementId || undefined,
          priority: priority || undefined,
        }),
      );
      onCreated?.();
      handleOpenChange(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="create-intake-dialog">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
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
              {tRoot(errorKey)}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-intake-title">{t("fields.title")}</Label>
            <Input
              id="create-intake-title"
              data-testid="create-intake-title-input"
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
            <Label htmlFor="create-intake-description">
              {t("fields.description")}
            </Label>
            <Textarea
              id="create-intake-description"
              data-testid="create-intake-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={8000}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <OptionsLoadNotice
              status={optionsLoadState}
              onRetry={retryOptionsLoad}
              t={tRoot}
              errorTestId="create-intake-options-error"
              retryTestId="create-intake-options-retry"
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-intake-source">
                {t("fields.sourceType")}
              </Label>
              <SelectMenu
                aria-label={t("fields.sourceType")}
                id="create-intake-source"
                data-testid="create-intake-source-select"
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
              <Label htmlFor="create-intake-priority">
                {t("fields.priority")}
              </Label>
              <SelectMenu
                aria-label={t("fields.priority")}
                id="create-intake-priority"
                data-testid="create-intake-priority-select"
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
              <Label htmlFor="create-intake-version">
                {t("fields.version")}
              </Label>
              <SelectMenu
                aria-label={t("fields.version")}
                id="create-intake-version"
                data-testid="create-intake-version-select"
                value={versionId}
                onChange={(event) => handleVersionChange(event.target.value)}
                disabled={optionFieldsDisabled}
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
              <Label htmlFor="create-intake-requirement">
                {t("fields.requirement")}
              </Label>
              <SelectMenu
                aria-label={t("fields.requirement")}
                id="create-intake-requirement"
                data-testid="create-intake-requirement-select"
                value={requirementId}
                onChange={(event) =>
                  handleRequirementChange(event.target.value)
                }
                disabled={optionFieldsDisabled}
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
              <Label htmlFor="create-intake-assignee">
                {t("fields.assignee")}
              </Label>
              <SelectMenu
                aria-label={t("fields.assignee")}
                id="create-intake-assignee"
                data-testid="create-intake-assignee-select"
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                disabled={optionFieldsDisabled}
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
              <Label htmlFor="create-intake-source-object">
                {t("fields.sourceObject")}
              </Label>
              <Textarea
                id="create-intake-source-object"
                data-testid="create-intake-source-object-input"
                value={sourceObject}
                onChange={(event) => setSourceObject(event.target.value)}
                maxLength={2000}
                rows={2}
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
              data-testid="create-intake-submit"
              disabled={submitDisabled}
            >
              {submitting ? t("actions.submitting") : t("actions.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OptionsLoadNotice({
  errorTestId,
  onRetry,
  retryTestId,
  status,
  t,
}: {
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
      <span>{t("common.states.optionsLoadFailed")}</span>
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
