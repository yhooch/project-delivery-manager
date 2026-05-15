"use client";

import type {
  IntakeItem,
  IntakeSourceType,
  Priority,
  Requirement,
  Version,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toUpdateIntakeItemRequest } from "../../lib/intake-forms";
import { updateIntakeItem } from "../../lib/intake-service";
import { listRequirements } from "../../lib/requirement-service";
import { listVersions } from "../../lib/version-service";

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
import { Textarea } from "../ui/textarea";

type EditIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  intakeItem: IntakeItem | null;
  onUpdated?: (item: IntakeItem) => void;
};

const SOURCE_TYPES: IntakeSourceType[] = [
  "REQUIREMENT_CHANGE",
  "DEFECT_PROBLEM",
  "PROJECT_PLAN",
  "MEETING_DECISION",
  "AD_HOC",
  "IMPLEMENTATION",
  "OPERATIONS",
  "RELEASE",
  "EXTERNAL_COLLABORATION",
];

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export function EditIntakeDialog({
  open,
  onOpenChange,
  spaceId,
  intakeItem,
  onUpdated,
}: EditIntakeDialogProps) {
  const t = useTranslations("intake.dialog");
  const tSourceType = useTranslations("intakeItems.sourceType");
  const tPriority = useTranslations("intakeItems.priority");
  const tRoot = useTranslations();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<IntakeSourceType>("AD_HOC");
  const [versionId, setVersionId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [titleError, setTitleError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);

  useEffect(() => {
    if (!open || !intakeItem) {
      return;
    }

    setTitle(intakeItem.title);
    setDescription(intakeItem.description ?? "");
    setSourceType(intakeItem.sourceType);
    setVersionId(intakeItem.versionId ?? "");
    setRequirementId(intakeItem.requirementId ?? "");
    setPriority(intakeItem.priority ?? "");
    setTitleError(false);
    setErrorKey(null);
    setSubmitting(false);
  }, [intakeItem, open]);

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [versionPage, requirementPage] = await Promise.all([
          listVersions({ spaceId, page: 1, pageSize: 100 }),
          listRequirements({ spaceId, page: 1, pageSize: 100 }),
        ]);
        if (cancelled) {
          return;
        }
        setVersions(versionPage.items);
        setRequirements(requirementPage.items);
      } catch {
        // Option load failures should not block editing the base fields.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, spaceId]);

  function reset() {
    setTitle("");
    setDescription("");
    setSourceType("AD_HOC");
    setVersionId("");
    setRequirementId("");
    setPriority("");
    setTitleError(false);
    setErrorKey(null);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
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

    try {
      const updated = await updateIntakeItem(
        { intakeItemId: intakeItem.id, spaceId },
        toUpdateIntakeItemRequest({
          title: trimmed,
          description,
          sourceType,
          versionId,
          requirementId,
          priority,
        }),
      );
      onUpdated?.(updated);
      handleOpenChange(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
              {tRoot(errorKey)}
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-intake-source">
                {t("fields.sourceType")}
              </Label>
              <select
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-intake-priority">
                {t("fields.priority")}
              </Label>
              <select
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-intake-version">
                {t("fields.version")}
              </Label>
              <select
                id="edit-intake-version"
                data-testid="edit-intake-version-select"
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("fields.noVersion")}</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-intake-requirement">
                {t("fields.requirement")}
              </Label>
              <select
                id="edit-intake-requirement"
                data-testid="edit-intake-requirement-select"
                value={requirementId}
                onChange={(event) => setRequirementId(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("fields.noRequirement")}</option>
                {requirements.map((req) => (
                  <option key={req.id} value={req.id}>
                    {req.title || t("fields.untitledRequirement")}
                  </option>
                ))}
              </select>
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
              {submitting
                ? t("actions.saving")
                : t("actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
