"use client";

import type {
  StatusCategory,
  WorkflowState,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createWorkflowState,
  updateWorkflowState,
  type WorkflowSpaceContext,
} from "../../lib/workflow-service";

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

const CATEGORY_OPTIONS: StatusCategory[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
];

export type WorkflowStateDialogMode =
  | { kind: "create" }
  | { kind: "edit"; state: WorkflowState };

export type WorkflowStateDialogProps = {
  context: WorkflowSpaceContext;
  workflowVersionId: string;
  mode: WorkflowStateDialogMode;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function WorkflowStateDialog({
  context,
  workflowVersionId,
  mode,
  open,
  onClose,
  onSuccess,
}: WorkflowStateDialogProps) {
  const t = useTranslations("workflow.config.stateDialog");
  const tCategory = useTranslations("workflow.statusCategory");
  const tRoot = useTranslations();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState<StatusCategory>("NOT_STARTED");
  const [order, setOrder] = useState<string>("0");
  const [isStart, setIsStart] = useState(false);
  const [isEnd, setIsEnd] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setErrorKey(null);
    setIsSubmitting(false);
    if (mode.kind === "edit") {
      setName(mode.state.name);
      setCode(mode.state.code);
      setCategory(mode.state.category);
      setOrder(String(mode.state.order));
      setIsStart(mode.state.isStart);
      setIsEnd(mode.state.isEnd);
    } else {
      setName("");
      setCode("");
      setCategory("NOT_STARTED");
      setOrder("0");
      setIsStart(false);
      setIsEnd(false);
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
      const trimmedName = name.trim();
      const trimmedCode = code.trim();
      const parsedOrder = Number.parseInt(order, 10);
      const orderValue = Number.isFinite(parsedOrder) ? Math.max(0, parsedOrder) : 0;
      if (mode.kind === "edit") {
        await updateWorkflowState(
          {
            organizationId: context.organizationId,
            spaceId: context.spaceId,
            stateId: mode.state.id,
          },
          {
            name: trimmedName,
            code: trimmedCode,
            category,
            order: orderValue,
            isStart,
            isEnd,
          },
        );
      } else {
        await createWorkflowState(
          {
            organizationId: context.organizationId,
            spaceId: context.spaceId,
            workflowVersionId,
          },
          {
            name: trimmedName,
            code: trimmedCode,
            category,
            order: orderValue,
            isStart,
            isEnd,
          },
        );
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workflow-state-dialog-name">{t("fields.name")}</Label>
            <Input
              autoFocus
              id="workflow-state-dialog-name"
              maxLength={120}
              minLength={1}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workflow-state-dialog-code">{t("fields.code")}</Label>
            <Input
              id="workflow-state-dialog-code"
              maxLength={80}
              minLength={1}
              onChange={(event) => setCode(event.target.value)}
              pattern="[A-Za-z0-9_-]+"
              required
              value={code}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workflow-state-dialog-category">
              {t("fields.category")}
            </Label>
            <select
              aria-label={t("fields.category")}
              className="rounded-md border border-input bg-background px-3 py-2 text-xs"
              id="workflow-state-dialog-category"
              onChange={(event) =>
                setCategory(event.target.value as StatusCategory)
              }
              value={category}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {tCategory(option)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workflow-state-dialog-order">{t("fields.order")}</Label>
            <Input
              id="workflow-state-dialog-order"
              inputMode="numeric"
              min={0}
              onChange={(event) => setOrder(event.target.value)}
              type="number"
              value={order}
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
              <input
                checked={isStart}
                onChange={(event) => setIsStart(event.target.checked)}
                type="checkbox"
              />
              {t("fields.isStart")}
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
              <input
                checked={isEnd}
                onChange={(event) => setIsEnd(event.target.checked)}
                type="checkbox"
              />
              {t("fields.isEnd")}
            </label>
          </div>

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
              disabled={
                isSubmitting || name.trim().length === 0 || code.trim().length === 0
              }
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
