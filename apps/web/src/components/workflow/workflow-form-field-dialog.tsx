"use client";

import type {
  ActionFormFieldSummary,
  ActionFormFieldType,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createActionFormField,
  updateActionFormField,
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
import { Textarea } from "../ui/textarea";

const FIELD_TYPE_OPTIONS: ActionFormFieldType[] = [
  "TEXT",
  "TEXTAREA",
  "SELECT",
  "USER",
  "DATE",
  "NUMBER",
];

export type WorkflowFormFieldDialogMode =
  | { kind: "create" }
  | { kind: "edit"; field: ActionFormFieldSummary };

export type WorkflowFormFieldDialogProps = {
  context: WorkflowSpaceContext;
  actionId: string;
  mode: WorkflowFormFieldDialogMode;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function WorkflowFormFieldDialog({
  context,
  actionId,
  mode,
  open,
  onClose,
  onSuccess,
}: WorkflowFormFieldDialogProps) {
  const t = useTranslations("workflow.config.fieldDialog");
  const tType = useTranslations("workflow.fieldType");
  const tRoot = useTranslations();

  const [label, setLabel] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [fieldType, setFieldType] = useState<ActionFormFieldType>("TEXT");
  const [required, setRequired] = useState(false);
  const [order, setOrder] = useState<string>("0");
  const [optionsText, setOptionsText] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setErrorKey(null);
    setIsSubmitting(false);
    if (mode.kind === "edit") {
      setLabel(mode.field.label);
      setKeyValue(mode.field.key);
      setFieldType(mode.field.fieldType);
      setRequired(mode.field.required);
      setOrder(String(mode.field.order));
      setOptionsText((mode.field.options ?? []).join("\n"));
    } else {
      setLabel("");
      setKeyValue("");
      setFieldType("TEXT");
      setRequired(false);
      setOrder("0");
      setOptionsText("");
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
      const trimmedLabel = label.trim();
      const trimmedKey = keyValue.trim();
      const parsedOrder = Number.parseInt(order, 10);
      const orderValue = Number.isFinite(parsedOrder) ? Math.max(0, parsedOrder) : 0;
      const options =
        fieldType === "SELECT"
          ? optionsText
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter((item) => item.length > 0)
          : undefined;

      if (mode.kind === "edit") {
        await updateActionFormField(
          {
            fieldId: mode.field.id,
            organizationId: context.organizationId,
            spaceId: context.spaceId,
          },
          {
            label: trimmedLabel,
            key: trimmedKey,
            fieldType,
            required,
            order: orderValue,
            options,
          },
        );
      } else {
        await createActionFormField(
          {
            actionId,
            organizationId: context.organizationId,
            spaceId: context.spaceId,
          },
          {
            label: trimmedLabel,
            key: trimmedKey,
            fieldType,
            required,
            order: orderValue,
            options,
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

  const canSubmit =
    label.trim().length > 0 && keyValue.trim().length > 0 && !isSubmitting;

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
              <Label htmlFor="workflow-field-dialog-label">
                {t("fields.label")}
              </Label>
              <Input
                autoFocus
                id="workflow-field-dialog-label"
                maxLength={120}
                onChange={(event) => setLabel(event.target.value)}
                required
                value={label}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-field-dialog-key">{t("fields.key")}</Label>
              <Input
                id="workflow-field-dialog-key"
                maxLength={80}
                onChange={(event) => setKeyValue(event.target.value)}
                pattern="[A-Za-z0-9_]+"
                required
                value={keyValue}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-field-dialog-type">
                {t("fields.fieldType")}
              </Label>
              <select
                aria-label={t("fields.fieldType")}
                className="rounded-md border border-input bg-background px-3 py-2 text-xs"
                id="workflow-field-dialog-type"
                onChange={(event) =>
                  setFieldType(event.target.value as ActionFormFieldType)
                }
                value={fieldType}
              >
                {FIELD_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {tType(option)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-field-dialog-order">
                {t("fields.order")}
              </Label>
              <Input
                id="workflow-field-dialog-order"
                inputMode="numeric"
                min={0}
                onChange={(event) => setOrder(event.target.value)}
                type="number"
                value={order}
              />
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
            <input
              checked={required}
              onChange={(event) => setRequired(event.target.checked)}
              type="checkbox"
            />
            {t("fields.required")}
          </label>

          {fieldType === "SELECT" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-field-dialog-options">
                {t("fields.options")}
              </Label>
              <Textarea
                id="workflow-field-dialog-options"
                onChange={(event) => setOptionsText(event.target.value)}
                placeholder={t("fields.optionsPlaceholder")}
                value={optionsText}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("fields.optionsHint")}
              </p>
            </div>
          ) : null}

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
              disabled={!canSubmit}
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
