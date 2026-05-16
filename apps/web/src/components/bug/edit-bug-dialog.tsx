"use client";

import type {
  BugSeverity,
  BugView,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toUpdateBugRequest } from "../../lib/bug-forms";
import { updateBug } from "../../lib/bug-service";
import { listRequirements } from "../../lib/requirement-service";
import { listSpaceMembers } from "../../lib/space-service";
import { listVersions } from "../../lib/version-service";
import {
  filterTraceOptionsByVersion,
  isTraceOptionCompatibleWithVersion,
} from "../../lib/versioned-trace-linking";
import { listWorkItems } from "../../lib/work-item-service";

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

type EditBugDialogProps = {
  bug: BugView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
  spaceId: string;
  onUpdated?: (bug: BugView) => void;
};

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const SEVERITIES: BugSeverity[] = [
  "BLOCKER",
  "CRITICAL",
  "MAJOR",
  "MINOR",
  "TRIVIAL",
];
type OptionsLoadState = "idle" | "loading" | "ready" | "failed";

export function EditBugDialog({
  bug,
  open,
  onOpenChange,
  organizationId,
  spaceId,
  onUpdated,
}: EditBugDialogProps) {
  const t = useTranslations("bugs.dialog");
  const tEdit = useTranslations("bugs.edit");
  const tForm = useTranslations("bugs.form");
  const tPriority = useTranslations("bugs.priority");
  const tSeverity = useTranslations("bugs.severity");
  const tRoot = useTranslations();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [actualResult, setActualResult] = useState("");
  const [fixNote, setFixNote] = useState("");
  const [regressionResult, setRegressionResult] = useState("");
  const [regressionBy, setRegressionBy] = useState("");
  const [regressionAt, setRegressionAt] = useState("");
  const [severity, setSeverity] = useState<BugSeverity>("MAJOR");
  const [versionId, setVersionId] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [relatedTaskId, setRelatedTaskId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [optionsLoadState, setOptionsLoadState] =
    useState<OptionsLoadState>("idle");
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);

  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [tasks, setTasks] = useState<WorkItem[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);

  const optionFieldsDisabled = submitting || optionsLoadState !== "ready";
  const submitDisabled = submitting || optionsLoadState !== "ready";
  const selectedRequirement = useMemo(
    () => requirements.find((requirement) => requirement.id === requirementId),
    [requirementId, requirements],
  );
  const selectedRelatedTask = useMemo(
    () => tasks.find((task) => task.id === relatedTaskId),
    [relatedTaskId, tasks],
  );
  const filteredRequirements = useMemo(
    () => filterTraceOptionsByVersion(requirements, versionId),
    [requirements, versionId],
  );
  const filteredTasks = useMemo(
    () => filterTraceOptionsByVersion(tasks, versionId),
    [tasks, versionId],
  );

  useEffect(() => {
    if (!open || !bug) {
      return;
    }

    setTitle(bug.title);
    setDescription(bug.description ?? "");
    setSteps(bug.bugDetail.stepsToReproduce ?? "");
    setExpectedResult(bug.bugDetail.expectedResult ?? "");
    setActualResult(bug.bugDetail.actualResult ?? "");
    setFixNote(bug.bugDetail.fixNote ?? "");
    setRegressionResult(bug.bugDetail.regressionResult ?? "");
    setRegressionBy(bug.bugDetail.regressionBy ?? "");
    setRegressionAt(toDateTimeInputValue(bug.bugDetail.regressionAt));
    setSeverity(bug.bugDetail.severity);
    setVersionId(bug.versionId ?? "");
    setRequirementId(bug.requirementId ?? "");
    setRelatedTaskId(bug.bugDetail.relatedTaskId ?? "");
    setAssigneeId(bug.assigneeId ?? "");
    setPriority(bug.priority);
    setDueDate(toDateInputValue(bug.dueDate));
    setTitleError(false);
    setErrorKey(null);
    setSubmitting(false);
  }, [bug, open]);

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;
    setOptionsLoadState("loading");

    void (async () => {
      try {
        const [versionPage, requirementPage, taskPage, memberPage] =
          await Promise.all([
            listVersions({ organizationId, spaceId, page: 1, pageSize: 100 }),
            listRequirements({
              organizationId,
              spaceId,
              page: 1,
              pageSize: 100,
            }),
            listWorkItems({
              organizationId,
              spaceId,
              page: 1,
              pageSize: 100,
              type: "TASK",
            }),
            listSpaceMembers(spaceId),
          ]);
        if (cancelled) {
          return;
        }
        setVersions(versionPage.items);
        setRequirements(requirementPage.items);
        setTasks(taskPage.items);
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
  }, [open, organizationId, optionsReloadKey, spaceId]);

  useEffect(() => {
    if (optionsLoadState !== "ready") {
      return;
    }

    const nextVersionId =
      versionId ||
      selectedRequirement?.versionId ||
      selectedRelatedTask?.versionId ||
      "";

    if (nextVersionId && !versionId) {
      setVersionId(nextVersionId);
    }

    if (
      !isTraceOptionCompatibleWithVersion(
        selectedRequirement,
        nextVersionId,
      )
    ) {
      setRequirementId("");
    }
    if (
      !isTraceOptionCompatibleWithVersion(
        selectedRelatedTask,
        nextVersionId,
      )
    ) {
      setRelatedTaskId("");
    }
  }, [
    optionsLoadState,
    selectedRelatedTask,
    selectedRequirement,
    versionId,
  ]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setErrorKey(null);
      setTitleError(false);
      setOptionsLoadState("idle");
      setOptionsReloadKey(0);
      setSubmitting(false);
    }
    onOpenChange(next);
  }

  function retryOptionsLoad() {
    setOptionsLoadState("loading");
    setOptionsReloadKey((value) => value + 1);
  }

  function handleVersionChange(nextVersionId: string) {
    setVersionId(nextVersionId);

    if (
      !isTraceOptionCompatibleWithVersion(
        selectedRequirement,
        nextVersionId,
      )
    ) {
      setRequirementId("");
    }
    if (
      !isTraceOptionCompatibleWithVersion(
        selectedRelatedTask,
        nextVersionId,
      )
    ) {
      setRelatedTaskId("");
    }
  }

  function handleRequirementChange(nextRequirementId: string) {
    setRequirementId(nextRequirementId);

    const nextRequirement = requirements.find(
      (requirement) => requirement.id === nextRequirementId,
    );
    const nextVersionId = nextRequirement?.versionId;

    if (nextVersionId) {
      setVersionId(nextVersionId);
      if (
        !isTraceOptionCompatibleWithVersion(
          selectedRelatedTask,
          nextVersionId,
        )
      ) {
        setRelatedTaskId("");
      }
    }
  }

  function handleRelatedTaskChange(nextRelatedTaskId: string) {
    setRelatedTaskId(nextRelatedTaskId);

    const nextRelatedTask = tasks.find((task) => task.id === nextRelatedTaskId);
    const nextVersionId = nextRelatedTask?.versionId;

    if (nextVersionId) {
      setVersionId(nextVersionId);
      if (
        !isTraceOptionCompatibleWithVersion(
          selectedRequirement,
          nextVersionId,
        )
      ) {
        setRequirementId("");
      }
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!bug) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError(true);
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    try {
      const updated = await updateBug(
        { bugId: bug.id, organizationId, spaceId },
        toUpdateBugRequest({
          title: trimmedTitle,
          description,
          stepsToReproduce: steps,
          expectedResult,
          actualResult,
          fixNote,
          regressionResult,
          regressionBy,
          regressionAt: regressionAt
            ? new Date(regressionAt).toISOString()
            : null,
          severity,
          priority,
          versionId,
          requirementId,
          relatedTaskId,
          assigneeId,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
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
      <DialogContent
        data-testid="edit-bug-dialog"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{tEdit("title")}</DialogTitle>
          <DialogDescription>{tEdit("submit")}</DialogDescription>
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
            <Label htmlFor="edit-bug-title">{t("fields.title")}</Label>
            <Input
              id="edit-bug-title"
              data-testid="edit-bug-title-input"
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
            <Label htmlFor="edit-bug-description">
              {tForm("description")}
            </Label>
            <Textarea
              id="edit-bug-description"
              data-testid="edit-bug-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={8000}
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-bug-steps">{t("fields.steps")}</Label>
            <Textarea
              id="edit-bug-steps"
              data-testid="edit-bug-steps-input"
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
              maxLength={8000}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-bug-expected">
                {tRoot("bugs.form.expectedResult")}
              </Label>
              <Textarea
                id="edit-bug-expected"
                data-testid="edit-bug-expected-input"
                value={expectedResult}
                onChange={(event) => setExpectedResult(event.target.value)}
                maxLength={8000}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-bug-actual">
                {tRoot("bugs.form.actualResult")}
              </Label>
              <Textarea
                id="edit-bug-actual"
                data-testid="edit-bug-actual-input"
                value={actualResult}
                onChange={(event) => setActualResult(event.target.value)}
                maxLength={8000}
                rows={3}
              />
            </div>
          </div>

          <OptionsLoadNotice
            status={optionsLoadState}
            onRetry={retryOptionsLoad}
            t={tRoot}
            errorTestId="edit-bug-options-error"
            retryTestId="edit-bug-options-retry"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-bug-fix-note">
                {tForm("fixNote")}
              </Label>
              <Textarea
                id="edit-bug-fix-note"
                data-testid="edit-bug-fix-note-input"
                value={fixNote}
                onChange={(event) => setFixNote(event.target.value)}
                maxLength={8000}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-bug-regression-result">
                {tForm("regressionResult")}
              </Label>
              <Textarea
                id="edit-bug-regression-result"
                data-testid="edit-bug-regression-result-input"
                value={regressionResult}
                onChange={(event) => setRegressionResult(event.target.value)}
                maxLength={8000}
                rows={3}
              />
            </div>
            <SelectField
              label={tForm("regressionBy")}
              htmlFor="edit-bug-regression-by"
            >
              <select
                id="edit-bug-regression-by"
                data-testid="edit-bug-regression-by-select"
                value={regressionBy}
                onChange={(event) => setRegressionBy(event.target.value)}
                disabled={optionFieldsDisabled}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{tForm("unassigned")}</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name || member.user.username}
                  </option>
                ))}
              </select>
            </SelectField>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-bug-regression-at">
                {tForm("regressionAt")}
              </Label>
              <Input
                id="edit-bug-regression-at"
                data-testid="edit-bug-regression-at-input"
                type="datetime-local"
                value={regressionAt}
                onChange={(event) => setRegressionAt(event.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t("fields.severity")} htmlFor="edit-bug-severity">
              <select
                id="edit-bug-severity"
                data-testid="edit-bug-severity-select"
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
            </SelectField>
            <SelectField label={t("fields.priority")} htmlFor="edit-bug-priority">
              <select
                id="edit-bug-priority"
                data-testid="edit-bug-priority-select"
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
            </SelectField>
            <SelectField label={t("fields.version")} htmlFor="edit-bug-version">
              <select
                id="edit-bug-version"
                data-testid="edit-bug-version-select"
                value={versionId}
                onChange={(event) => handleVersionChange(event.target.value)}
                disabled={optionFieldsDisabled}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{tRoot("bugs.form.noVersion")}</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.name}
                  </option>
                ))}
              </select>
            </SelectField>
            <SelectField
              label={tRoot("bugs.form.requirement")}
              htmlFor="edit-bug-requirement"
            >
              <select
                id="edit-bug-requirement"
                data-testid="edit-bug-requirement-select"
                value={requirementId}
                onChange={(event) =>
                  handleRequirementChange(event.target.value)
                }
                disabled={optionFieldsDisabled}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{tRoot("bugs.form.noRequirement")}</option>
                {filteredRequirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirement.title ||
                      tRoot("intake.dialog.fields.untitledRequirement")}
                  </option>
                ))}
              </select>
            </SelectField>
            <SelectField
              label={tRoot("bugs.form.relatedTask")}
              htmlFor="edit-bug-related-task"
            >
              <select
                id="edit-bug-related-task"
                data-testid="edit-bug-related-task-select"
                value={relatedTaskId}
                onChange={(event) =>
                  handleRelatedTaskChange(event.target.value)
                }
                disabled={optionFieldsDisabled}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{tRoot("bugs.form.noRelatedTask")}</option>
                {filteredTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </SelectField>
            <SelectField label={t("fields.assignee")} htmlFor="edit-bug-assignee">
              <select
                id="edit-bug-assignee"
                data-testid="edit-bug-assignee-select"
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
              </select>
            </SelectField>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="edit-bug-duedate">{t("fields.dueDate")}</Label>
              <Input
                id="edit-bug-duedate"
                data-testid="edit-bug-duedate-input"
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
              data-testid="edit-bug-submit"
              disabled={submitDisabled}
            >
              {submitting ? tEdit("submitting") : tEdit("submit")}
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

function SelectField({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function toDateInputValue(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function toDateTimeInputValue(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 16);
}
