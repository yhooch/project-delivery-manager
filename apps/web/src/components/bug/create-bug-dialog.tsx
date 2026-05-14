"use client";

import type {
  BugSeverity,
  Priority,
  SpaceMemberWithUser,
  Version,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { createBug } from "../../lib/bug-service";
import { listSpaceMembers } from "../../lib/space-service";
import { listVersions } from "../../lib/version-service";

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

type CreateBugDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  onCreated?: () => void;
};

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const SEVERITIES: BugSeverity[] = [
  "BLOCKER",
  "CRITICAL",
  "MAJOR",
  "MINOR",
  "TRIVIAL",
];

export function CreateBugDialog({
  open,
  onOpenChange,
  spaceId,
  onCreated,
}: CreateBugDialogProps) {
  const t = useTranslations("bugs.dialog");
  const tPriority = useTranslations("bugs.priority");
  const tSeverity = useTranslations("bugs.severity");
  const tRoot = useTranslations();

  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState("");
  const [severity, setSeverity] = useState<BugSeverity>("MAJOR");
  const [versionId, setVersionId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const [versions, setVersions] = useState<Version[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [versionPage, memberPage] = await Promise.all([
          listVersions({ spaceId, page: 1, pageSize: 100 }),
          listSpaceMembers(spaceId),
        ]);
        if (cancelled) {
          return;
        }
        setVersions(versionPage.items);
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
    setTitle("");
    setSteps("");
    setSeverity("MAJOR");
    setVersionId("");
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
      await createBug(
        { spaceId },
        {
          title: trimmed,
          stepsToReproduce: steps.trim() || undefined,
          severity,
          priority,
          versionId: versionId || undefined,
          assigneeId: assigneeId || undefined,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        },
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
      <DialogContent>
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
            <Label htmlFor="create-bug-title">{t("fields.title")}</Label>
            <Input
              id="create-bug-title"
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
            <Label htmlFor="create-bug-steps">{t("fields.steps")}</Label>
            <Textarea
              id="create-bug-steps"
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
              maxLength={8000}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-bug-severity">
                {t("fields.severity")}
              </Label>
              <select
                id="create-bug-severity"
                value={severity}
                onChange={(event) =>
                  setSeverity(event.target.value as BugSeverity)
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {tSeverity(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-bug-priority">
                {t("fields.priority")}
              </Label>
              <select
                id="create-bug-priority"
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
              <Label htmlFor="create-bug-version">{t("fields.version")}</Label>
              <select
                id="create-bug-version"
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
              <Label htmlFor="create-bug-assignee">
                {t("fields.assignee")}
              </Label>
              <select
                id="create-bug-assignee"
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
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="create-bug-duedate">{t("fields.dueDate")}</Label>
              <Input
                id="create-bug-duedate"
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
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? t("actions.submitting") : t("actions.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
