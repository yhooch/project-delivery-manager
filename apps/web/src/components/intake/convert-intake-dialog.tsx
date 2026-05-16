"use client";

import type {
  ConvertIntakeItemToWorkItemsResponse,
  IntakeItem,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  Version,
  WorkflowBinding,
  WorkflowDefinition,
} from "@project-delivery/shared";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toConvertIntakeItemRequest } from "../../lib/intake-forms";
import { convertIntakeItemToWorkItems } from "../../lib/intake-service";
import { listRequirements } from "../../lib/requirement-service";
import { listSpaceMembers } from "../../lib/space-service";
import { listVersions } from "../../lib/version-service";
import {
  filterTraceOptionsByVersion,
  inheritVersionFromTraceOption,
  isTraceOptionCompatibleWithVersion,
} from "../../lib/versioned-trace-linking";
import {
  listWorkflowBindings,
  listWorkflows,
} from "../../lib/workflow-service";

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

type ConvertIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
  spaceId: string;
  intakeItem: IntakeItem | null;
  onConverted?: (result: ConvertIntakeItemToWorkItemsResponse) => void;
};

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
type OptionsLoadState = "idle" | "loading" | "ready" | "failed";

type TaskRow = {
  assigneeId: string;
  description: string;
  dueDate: string;
  priority: Priority;
  requirementId: string;
  title: string;
  versionId: string;
  workflowVersionId: string;
};

type WorkflowOption = {
  binding: WorkflowBinding;
  workflowName?: string;
};

function makeRow(intakeItem: IntakeItem | null, includeTitle = false): TaskRow {
  return {
    assigneeId: intakeItem?.assigneeId ?? "",
    description: intakeItem?.description ?? "",
    dueDate: "",
    priority: intakeItem?.priority ?? "MEDIUM",
    requirementId: intakeItem?.requirementId ?? "",
    title: includeTitle ? (intakeItem?.title ?? "") : "",
    versionId: intakeItem?.versionId ?? "",
    workflowVersionId: "",
  };
}

export function ConvertIntakeDialog({
  open,
  onOpenChange,
  organizationId: explicitOrganizationId,
  spaceId,
  intakeItem,
  onConverted,
}: ConvertIntakeDialogProps) {
  const t = useTranslations("intake.dialog");
  const tIntakeItems = useTranslations("intakeItems");
  const tPriority = useTranslations("intakeItems.priority");
  const tRoot = useTranslations();
  const { currentOrganization, session } = useSession();
  const organizationId =
    explicitOrganizationId ??
    session?.defaultOrganizationId ??
    currentOrganization?.id;

  const [rows, setRows] = useState<TaskRow[]>([makeRow(null)]);
  const [errors, setErrors] = useState<boolean[]>([false]);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [optionsLoadState, setOptionsLoadState] =
    useState<OptionsLoadState>("idle");
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);

  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowOption[]>([]);

  const optionFieldsDisabled = submitting || optionsLoadState !== "ready";
  const submitDisabled =
    submitting || intakeItem?.status !== "ACCEPTED";

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;
    setOptionsLoadState("loading");

    void (async () => {
      try {
        const [
          memberPage,
          versionPage,
          requirementPage,
          workflowPage,
          bindingPage,
        ] = await Promise.all([
          listSpaceMembers(spaceId, { status: "ACTIVE" }),
          listVersions({ organizationId, spaceId, page: 1, pageSize: 100 }),
          listRequirements({ organizationId, spaceId, page: 1, pageSize: 100 }),
          listWorkflows({ organizationId, spaceId, page: 1, pageSize: 100 }),
          listWorkflowBindings({
            organizationId,
            page: 1,
            pageSize: 100,
            spaceId,
            workItemType: "TASK",
          }),
        ]);
        if (cancelled) {
          return;
        }
        setMembers(memberPage.items);
        setVersions(versionPage.items);
        setRequirements(requirementPage.items);
        setWorkflowOptions(
          toWorkflowOptions(bindingPage.items, workflowPage.items),
        );
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
  }, [open, organizationId, optionsReloadKey, spaceId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setRows([makeRow(intakeItem, true)]);
    setErrors([false]);
  }, [intakeItem, open]);

  function reset() {
    setRows([makeRow(intakeItem)]);
    setErrors([false]);
    setErrorKey(null);
    setOptionsLoadState("idle");
    setOptionsReloadKey(0);
    setSubmitting(false);
  }

  function retryOptionsLoad() {
    setOptionsLoadState("loading");
    setOptionsReloadKey((value) => value + 1);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  function updateRow(index: number, patch: Partial<TaskRow>) {
    setRows((prev) =>
      prev.map((row, idx) =>
        idx === index
          ? applyLinkedRequirementPatch(row, patch, requirements)
          : row,
      ),
    );
    if (patch.title !== undefined) {
      setErrors((prev) =>
        prev.map((value, idx) => (idx === index ? false : value)),
      );
    }
  }

  function addRow() {
    setRows((prev) => [...prev, makeRow(intakeItem)]);
    setErrors((prev) => [...prev, false]);
  }

  function removeRow(index: number) {
    setRows((prev) =>
      prev.length === 1 ? prev : prev.filter((_, idx) => idx !== index),
    );
    setErrors((prev) =>
      prev.length === 1 ? prev : prev.filter((_, idx) => idx !== index),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!intakeItem) {
      return;
    }

    if (intakeItem.status !== "ACCEPTED") {
      setErrorKey("intake.dialog.convert.invalidStatus");
      return;
    }

    const nextErrors = rows.map((row) => row.title.trim().length === 0);
    setErrors(nextErrors);
    if (nextErrors.some(Boolean)) {
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    try {
      const result = await convertIntakeItemToWorkItems(
        { intakeItemId: intakeItem.id, organizationId, spaceId },
        toConvertIntakeItemRequest({
          tasks: rows.map((row) => ({
            assigneeId: row.assigneeId || undefined,
            description: row.description,
            dueDate: row.dueDate
              ? new Date(row.dueDate).toISOString()
              : undefined,
            priority: row.priority,
            requirementId: row.requirementId || undefined,
            title: row.title,
            versionId: row.versionId || undefined,
            workflowVersionId: row.workflowVersionId || undefined,
          })),
        }),
      );
      onConverted?.(result);
      handleOpenChange(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("convert.title")}</DialogTitle>
          <DialogDescription>{t("convert.description")}</DialogDescription>
        </DialogHeader>

        {intakeItem && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <div className="font-medium uppercase tracking-wider text-muted-foreground">
              {t("convert.intakeLabel")}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">
              {intakeItem.title}
            </div>
          </div>
        )}

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

          <div className="flex flex-col gap-2">
            <Label>{t("convert.tasksLabel")}</Label>
            <OptionsLoadNotice
              status={optionsLoadState}
              onRetry={retryOptionsLoad}
              t={tRoot}
              errorTestId="convert-intake-options-error"
              retryTestId="convert-intake-options-retry"
            />
            {rows.map((row, index) => (
              <div
                key={index}
                className="flex flex-col gap-3 rounded-md border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {tIntakeItems("convert.taskLegend", { index: index + 1 })}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeRow(index)}
                    disabled={rows.length === 1 || submitting}
                    aria-label={t("convert.removeTask")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor={`convert-task-title-${index}`}>
                      {tIntakeItems("taskForm.title")}
                    </Label>
                    <Input
                      id={`convert-task-title-${index}`}
                      data-testid={`convert-task-title-${index}`}
                      placeholder={t("convert.taskTitlePlaceholder")}
                      value={row.title}
                      onChange={(event) =>
                        updateRow(index, { title: event.target.value })
                      }
                      maxLength={200}
                      aria-invalid={errors[index]}
                    />
                    {errors[index] && (
                      <span
                        className="text-[11px] text-destructive"
                        role="alert"
                      >
                        {t("convert.taskTitleError")}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor={`convert-task-description-${index}`}>
                      {tIntakeItems("taskForm.description")}
                    </Label>
                    <Textarea
                      id={`convert-task-description-${index}`}
                      data-testid={`convert-task-description-${index}`}
                      value={row.description}
                      onChange={(event) =>
                        updateRow(index, { description: event.target.value })
                      }
                      maxLength={8000}
                      rows={3}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`convert-task-version-${index}`}>
                      {tIntakeItems("taskForm.version")}
                    </Label>
                    <SelectMenu
                      id={`convert-task-version-${index}`}
                      data-testid={`convert-task-version-${index}`}
                      value={row.versionId}
                      onChange={(event) =>
                        updateRow(index, { versionId: event.target.value })
                      }
                      disabled={optionFieldsDisabled}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">
                        {tIntakeItems("taskForm.noVersion")}
                      </option>
                      {versions.map((version) => (
                        <option key={version.id} value={version.id}>
                          {version.name}
                        </option>
                      ))}
                    </SelectMenu>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`convert-task-requirement-${index}`}>
                      {tIntakeItems("taskForm.requirement")}
                    </Label>
                    <SelectMenu
                      id={`convert-task-requirement-${index}`}
                      data-testid={`convert-task-requirement-${index}`}
                      value={row.requirementId}
                      onChange={(event) =>
                        updateRow(index, { requirementId: event.target.value })
                      }
                      disabled={optionFieldsDisabled}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">
                        {tIntakeItems("taskForm.noRequirement")}
                      </option>
                      {filterTraceOptionsByVersion(
                        requirements,
                        row.versionId,
                        row.requirementId,
                      ).map((requirement) => (
                        <option key={requirement.id} value={requirement.id}>
                          {requirement.title || t("fields.untitledRequirement")}
                        </option>
                      ))}
                    </SelectMenu>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`convert-task-assignee-${index}`}>
                      {tIntakeItems("taskForm.assignee")}
                    </Label>
                    <SelectMenu
                      id={`convert-task-assignee-${index}`}
                      data-testid={`convert-task-assignee-${index}`}
                      value={row.assigneeId}
                      onChange={(event) =>
                        updateRow(index, { assigneeId: event.target.value })
                      }
                      disabled={optionFieldsDisabled}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("convert.taskAssignee")}
                    >
                      <option value="">{t("convert.unassigned")}</option>
                      {members.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.user.name || member.user.username}
                        </option>
                      ))}
                    </SelectMenu>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`convert-task-priority-${index}`}>
                      {tIntakeItems("taskForm.priority")}
                    </Label>
                    <SelectMenu
                      id={`convert-task-priority-${index}`}
                      data-testid={`convert-task-priority-${index}`}
                      value={row.priority}
                      onChange={(event) =>
                        updateRow(index, {
                          priority: event.target.value as Priority,
                        })
                      }
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("convert.taskPriority")}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {tPriority(p)}
                        </option>
                      ))}
                    </SelectMenu>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`convert-task-due-date-${index}`}>
                      {tIntakeItems("taskForm.dueDate")}
                    </Label>
                    <Input
                      id={`convert-task-due-date-${index}`}
                      data-testid={`convert-task-due-date-${index}`}
                      type="date"
                      value={row.dueDate}
                      onChange={(event) =>
                        updateRow(index, { dueDate: event.target.value })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`convert-task-workflow-${index}`}>
                      {tRoot("workflow.eyebrow")}
                    </Label>
                    <SelectMenu
                      id={`convert-task-workflow-${index}`}
                      data-testid={`convert-task-workflow-${index}`}
                      value={row.workflowVersionId}
                      onChange={(event) =>
                        updateRow(index, {
                          workflowVersionId: event.target.value,
                        })
                      }
                      disabled={optionFieldsDisabled}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">
                        {tRoot("workflow.bindingsPanel.fields.isDefault")}
                      </option>
                      {workflowOptions.map((option) => (
                        <option
                          key={option.binding.id}
                          value={option.binding.workflowVersionId}
                        >
                          {formatWorkflowOption(option, tRoot)}
                        </option>
                      ))}
                    </SelectMenu>
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={addRow}
              disabled={submitting}
            >
              <Plus className="h-3 w-3" />
              {t("convert.addTask")}
            </Button>
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
              disabled={submitDisabled}
              title={
                intakeItem?.status && intakeItem.status !== "ACCEPTED"
                  ? t("convert.invalidStatus")
                  : undefined
              }
            >
              {submitting ? t("convert.submitting") : t("convert.submit")}
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
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        {t("common.states.optionsLoading")}
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid={errorTestId}
      className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
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

function toWorkflowOptions(
  bindings: WorkflowBinding[],
  workflows: WorkflowDefinition[],
): WorkflowOption[] {
  const workflowNameById = new Map(
    workflows.map((workflow) => [workflow.id, workflow.name]),
  );

  return bindings
    .filter((binding) => binding.workItemType === "TASK")
    .map((binding) => ({
      binding,
      workflowName: workflowNameById.get(binding.workflowId),
    }));
}

function formatWorkflowOption(
  option: WorkflowOption,
  t: (key: string) => string,
): string {
  const name = option.workflowName ?? t("workflow.workItemType.TASK");
  const defaultMark = option.binding.isDefault
    ? ` · ${t("workflow.bindingsPanel.fields.isDefault")}`
    : "";

  return `${name}${defaultMark}`;
}

function applyLinkedRequirementPatch(
  row: TaskRow,
  patch: Partial<TaskRow>,
  requirements: Requirement[],
): TaskRow {
  const next = { ...row, ...patch };

  if (patch.requirementId !== undefined) {
    const selectedRequirement = requirements.find(
      (requirement) => requirement.id === patch.requirementId,
    );
    next.versionId = inheritVersionFromTraceOption(
      selectedRequirement,
      next.versionId,
    );
  }

  if (patch.versionId !== undefined && next.requirementId) {
    const selectedRequirement = requirements.find(
      (requirement) => requirement.id === next.requirementId,
    );

    if (
      !isTraceOptionCompatibleWithVersion(selectedRequirement, next.versionId)
    ) {
      next.requirementId = "";
    }
  }

  return next;
}
