"use client";

import type {
  Priority,
  WorkItemType,
  WorkflowBinding,
  WorkflowVersion,
} from "@project-delivery/shared";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createWorkflowBinding,
  updateWorkflowBinding,
  type WorkflowSpaceContext,
} from "../../lib/workflow-service";

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
import { Label } from "../ui/label";

const WORK_ITEM_TYPE_OPTIONS: WorkItemType[] = ["TASK", "BUG"];
const PRIORITY_OPTIONS: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export type WorkflowBindingListProps = {
  bindings: WorkflowBinding[];
  currentVersion: WorkflowVersion;
  onCreate: () => void;
  onEdit: (binding: WorkflowBinding) => void;
  readOnly?: boolean;
};

export function WorkflowBindingList({
  bindings,
  currentVersion,
  onCreate,
  onEdit,
  readOnly = false,
}: WorkflowBindingListProps) {
  const t = useTranslations("workflow.config.bindings");
  const tType = useTranslations("workflow.workItemType");
  const tPriority = useTranslations("workflow.priority");
  const tStatus = useTranslations("workflow.versionStatus");

  const sorted = [...bindings].sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    const typeCompare = a.workItemType.localeCompare(b.workItemType);
    if (typeCompare !== 0) {
      return typeCompare;
    }
    return (a.priority ?? "").localeCompare(b.priority ?? "");
  });

  return (
    <section
      aria-label={t("title")}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <p className="text-[11px] text-muted-foreground">
            {t("description", {
              version: currentVersion.version,
              status: tStatus(currentVersion.status),
            })}
          </p>
        </div>
        <Button
          className="h-7 text-xs"
          disabled={readOnly}
          onClick={onCreate}
          size="sm"
          variant="outline"
        >
          <Plus className="h-3 w-3" />
          {t("create")}
        </Button>
      </header>

      {sorted.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            aria-label={t("title")}
            className="w-full text-xs"
            data-testid="workflow-binding-table"
          >
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">
                  {t("columns.workItemType")}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t("columns.priority")}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t("columns.version")}
                </th>
                <th className="px-2 py-1.5 font-medium">
                  {t("columns.default")}
                </th>
                <th className="px-2 py-1.5 text-right font-medium">
                  {t("columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((binding) => {
                const isCurrentVersion =
                  binding.workflowVersionId === currentVersion.id;
                return (
                  <tr
                    className="border-b border-border/60"
                    data-testid={`workflow-binding-row-${binding.id}`}
                    key={binding.id}
                  >
                    <td className="px-2 py-1.5">
                      {tType(binding.workItemType)}
                    </td>
                    <td className="px-2 py-1.5">
                      {binding.priority ? tPriority(binding.priority) : t("anyPriority")}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge variant={isCurrentVersion ? "primary" : "outline"}>
                        {isCurrentVersion
                          ? t("currentVersion", {
                              version: currentVersion.version,
                            })
                          : t("otherVersion")}
                      </Badge>
                    </td>
                    <td className="px-2 py-1.5">
                      {binding.isDefault ? (
                        <Badge variant="success">{t("defaultYes")}</Badge>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("defaultNo")}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button
                        aria-label={t("actions.edit")}
                        className="h-6 w-6"
                        disabled={readOnly}
                        onClick={() => onEdit(binding)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export type WorkflowBindingDialogMode =
  | { kind: "create" }
  | { kind: "edit"; binding: WorkflowBinding };

export type WorkflowBindingDialogProps = {
  context: WorkflowSpaceContext;
  workflowId: string;
  workflowVersionId: string;
  mode: WorkflowBindingDialogMode;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function WorkflowBindingDialog({
  context,
  workflowId,
  workflowVersionId,
  mode,
  open,
  onClose,
  onSuccess,
}: WorkflowBindingDialogProps) {
  const t = useTranslations("workflow.config.bindingDialog");
  const tType = useTranslations("workflow.workItemType");
  const tPriority = useTranslations("workflow.priority");
  const tRoot = useTranslations();

  const [workItemType, setWorkItemType] = useState<WorkItemType>("TASK");
  const [priority, setPriority] = useState<Priority | "">("");
  const [isDefault, setIsDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setErrorKey(null);
    setIsSubmitting(false);
    if (mode.kind === "edit") {
      setWorkItemType(mode.binding.workItemType);
      setPriority(mode.binding.priority ?? "");
      setIsDefault(mode.binding.isDefault);
    } else {
      setWorkItemType("TASK");
      setPriority("");
      setIsDefault(false);
    }
  }, [mode, open]);

  const isEdit = mode.kind === "edit";

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorKey(null);
    try {
      const input = {
        workflowId,
        workflowVersionId,
        workItemType,
        ...(priority ? { priority } : {}),
        isDefault,
      };
      if (mode.kind === "edit") {
        await updateWorkflowBinding(
          {
            bindingId: mode.binding.id,
            organizationId: context.organizationId,
            spaceId: context.spaceId,
          },
          input,
        );
      } else {
        await createWorkflowBinding(context, input);
      }
      onSuccess();
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(isEdit ? "edit.title" : "create.title")}</DialogTitle>
          <DialogDescription>
            {t(isEdit ? "edit.description" : "create.description")}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-binding-dialog-work-item-type">
                {t("fields.workItemType")}
              </Label>
              <select
                aria-label={t("fields.workItemType")}
                className="rounded-md border border-input bg-background px-3 py-2 text-xs"
                id="workflow-binding-dialog-work-item-type"
                onChange={(event) =>
                  setWorkItemType(event.target.value as WorkItemType)
                }
                value={workItemType}
              >
                {WORK_ITEM_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {tType(option)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-binding-dialog-priority">
                {t("fields.priority")}
              </Label>
              <select
                aria-label={t("fields.priority")}
                className="rounded-md border border-input bg-background px-3 py-2 text-xs"
                id="workflow-binding-dialog-priority"
                onChange={(event) => setPriority(event.target.value as Priority | "")}
                value={priority}
              >
                <option value="">{t("fields.anyPriority")}</option>
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {tPriority(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
            <input
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              type="checkbox"
            />
            {t("fields.isDefault")}
          </label>

          {errorKey ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {tRoot(errorKey)}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              className="text-xs"
              disabled={isSubmitting}
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("cancel")}
            </Button>
            <Button
              className="text-xs"
              disabled={isSubmitting}
              size="sm"
              type="submit"
            >
              {isSubmitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
