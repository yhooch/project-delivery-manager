"use client";

import type {
  IntakeItem,
  Priority,
  SpaceMemberWithUser,
} from "@project-delivery/shared";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { convertIntakeItemToWorkItems } from "../../lib/intake-service";
import { listSpaceMembers } from "../../lib/space-service";

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

type ConvertIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  intakeItem: IntakeItem | null;
  onConverted?: () => void;
};

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

type TaskRow = {
  title: string;
  assigneeId: string;
  priority: Priority;
};

function makeRow(): TaskRow {
  return { title: "", assigneeId: "", priority: "MEDIUM" };
}

export function ConvertIntakeDialog({
  open,
  onOpenChange,
  spaceId,
  intakeItem,
  onConverted,
}: ConvertIntakeDialogProps) {
  const t = useTranslations("intake.dialog");
  const tPriority = useTranslations("intakeItems.priority");
  const tRoot = useTranslations();

  const [rows, setRows] = useState<TaskRow[]>([makeRow()]);
  const [errors, setErrors] = useState<boolean[]>([false]);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const memberPage = await listSpaceMembers(spaceId);
        if (cancelled) {
          return;
        }
        setMembers(memberPage.items);
      } catch {
        // swallow option load errors
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, spaceId]);

  function reset() {
    setRows([makeRow()]);
    setErrors([false]);
    setErrorKey(null);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  function updateRow(index: number, patch: Partial<TaskRow>) {
    setRows((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)),
    );
    if (patch.title !== undefined) {
      setErrors((prev) =>
        prev.map((value, idx) => (idx === index ? false : value)),
      );
    }
  }

  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
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

    const nextErrors = rows.map((row) => row.title.trim().length === 0);
    setErrors(nextErrors);
    if (nextErrors.some(Boolean)) {
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    try {
      await convertIntakeItemToWorkItems(
        { intakeItemId: intakeItem.id, spaceId },
        {
          tasks: rows.map((row) => ({
            title: row.title.trim(),
            assigneeId: row.assigneeId || undefined,
            priority: row.priority,
          })),
        },
      );
      onConverted?.();
      handleOpenChange(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
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
            {rows.map((row, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-end"
              >
                <div className="flex-1 flex-col gap-1">
                  <Input
                    placeholder={t("convert.taskTitlePlaceholder")}
                    value={row.title}
                    onChange={(event) =>
                      updateRow(index, { title: event.target.value })
                    }
                    maxLength={200}
                    aria-invalid={errors[index]}
                  />
                  {errors[index] && (
                    <span className="mt-1 text-[11px] text-destructive" role="alert">
                      {t("convert.taskTitleError")}
                    </span>
                  )}
                </div>
                <select
                  value={row.assigneeId}
                  onChange={(event) =>
                    updateRow(index, { assigneeId: event.target.value })
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40"
                  aria-label={t("convert.taskAssignee")}
                >
                  <option value="">{t("convert.unassigned")}</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.user.name || member.user.username}
                    </option>
                  ))}
                </select>
                <select
                  value={row.priority}
                  onChange={(event) =>
                    updateRow(index, {
                      priority: event.target.value as Priority,
                    })
                  }
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
                  aria-label={t("convert.taskPriority")}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {tPriority(p)}
                    </option>
                  ))}
                </select>
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
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting
                ? t("convert.submitting")
                : t("convert.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
