"use client";

import type {
  IntakeItem,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  Version,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { listIntakeItems } from "../../lib/intake-service";
import { listRequirements } from "../../lib/requirement-service";
import { listSpaceMembers } from "../../lib/space-service";
import { listVersions } from "../../lib/version-service";
import { toCreateTaskRequest } from "../../lib/work-item-forms";
import { createWorkItem } from "../../lib/work-item-service";

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
import { useSession } from "../providers/session-provider";

type CreateTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
  spaceId: string;
  initialVersionId?: string;
  onCreated?: () => void;
};

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export function CreateTaskDialog({
  open,
  onOpenChange,
  organizationId: explicitOrganizationId,
  spaceId,
  initialVersionId,
  onCreated,
}: CreateTaskDialogProps) {
  const t = useTranslations("tasks.dialog");
  const tPriority = useTranslations("workItems.priority");
  const tRoot = useTranslations();
  const { currentOrganization, session } = useSession();
  const organizationId =
    explicitOrganizationId ??
    session?.defaultOrganizationId ??
    currentOrganization?.id;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [versionId, setVersionId] = useState(initialVersionId ?? "");
  const [requirementId, setRequirementId] = useState("");
  const [intakeItemId, setIntakeItemId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [intakeItems, setIntakeItems] = useState<IntakeItem[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);

  useEffect(() => {
    if (open) {
      setVersionId(initialVersionId ?? "");
    }
  }, [open, initialVersionId]);

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [versionPage, requirementPage, intakePage, memberPage] =
          await Promise.all([
            listVersions({ organizationId, spaceId, page: 1, pageSize: 100 }),
            listRequirements({ organizationId, spaceId, page: 1, pageSize: 100 }),
            listIntakeItems({ organizationId, spaceId, page: 1, pageSize: 100 }),
            listSpaceMembers(spaceId),
          ]);
        if (cancelled) {
          return;
        }
        setVersions(versionPage.items);
        setRequirements(requirementPage.items);
        setIntakeItems(intakePage.items);
        setMembers(memberPage.items);
      } catch {
        // swallow option load errors; dropdowns simply stay empty
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, organizationId, spaceId]);

  function reset() {
    setTitle("");
    setDescription("");
    setVersionId(initialVersionId ?? "");
    setRequirementId("");
    setIntakeItemId("");
    setAssigneeId("");
    setPriority("MEDIUM");
    setDueDate("");
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
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    try {
      await createWorkItem(
        { organizationId, spaceId },
        toCreateTaskRequest({
          title: trimmed,
          description,
          priority,
          versionId,
          requirementId,
          intakeItemId,
          assigneeId,
          dueDate: toDateInputRequestValue(dueDate),
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
      <DialogContent
        data-testid="create-task-dialog"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
          {errorKey && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {tRoot(errorKey)}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-task-title">{t("fields.title")}</Label>
            <Input
              id="create-task-title"
              data-testid="create-task-title-input"
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
            <Label htmlFor="create-task-description">
              {t("fields.description")}
            </Label>
            <Textarea
              id="create-task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={8000}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-task-version">{t("fields.version")}</Label>
              <select
                id="create-task-version"
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
              <Label htmlFor="create-task-requirement">
                {tRoot("workItems.form.requirement")}
              </Label>
              <select
                id="create-task-requirement"
                data-testid="create-task-requirement-select"
                value={requirementId}
                onChange={(event) => setRequirementId(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">
                  {tRoot("workItems.form.noRequirement")}
                </option>
                {requirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirement.title ||
                      tRoot("intake.dialog.fields.untitledRequirement")}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-task-intake">
                {tRoot("workItems.trace.intakeItem")}
              </Label>
              <select
                id="create-task-intake"
                data-testid="create-task-intake-select"
                value={intakeItemId}
                onChange={(event) => setIntakeItemId(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">
                  {tRoot("workItems.trace.noIntakeItem")}
                </option>
                {intakeItems.map((intakeItem) => (
                  <option key={intakeItem.id} value={intakeItem.id}>
                    {intakeItem.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-task-assignee">
                {t("fields.assignee")}
              </Label>
              <select
                id="create-task-assignee"
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-task-priority">
                {t("fields.priority")}
              </Label>
              <select
                id="create-task-priority"
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as Priority)
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {tPriority(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-task-duedate">
                {t("fields.dueDate")}
              </Label>
              <Input
                id="create-task-duedate"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
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
              data-testid="create-task-submit"
              disabled={submitting}
            >
              {submitting ? t("actions.submitting") : t("actions.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toDateInputRequestValue(value: string): string {
  return value ? new Date(`${value}T00:00:00`).toISOString() : value;
}
