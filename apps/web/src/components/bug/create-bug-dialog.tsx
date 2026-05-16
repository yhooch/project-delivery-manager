"use client";

import type {
  BugSeverity,
  Priority,
  Requirement,
  SpaceMemberWithUser,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toCreateBugRequest } from "../../lib/bug-forms";
import { createBug } from "../../lib/bug-service";
import { listRequirements } from "../../lib/requirement-service";
import { listSpaceMembers } from "../../lib/space-service";
import { listVersions } from "../../lib/version-service";
import {
  filterTraceOptionsByVersion,
  isTraceOptionCompatibleWithVersion,
} from "../../lib/versioned-trace-linking";
import { listWorkItems } from "../../lib/work-item-service";

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

type CreateBugDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId?: string;
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
type OptionsLoadState = "idle" | "loading" | "ready" | "failed";

export function CreateBugDialog({
  open,
  onOpenChange,
  organizationId: explicitOrganizationId,
  spaceId,
  onCreated,
}: CreateBugDialogProps) {
  const t = useTranslations("bugs.dialog");
  const tPriority = useTranslations("bugs.priority");
  const tSeverity = useTranslations("bugs.severity");
  const tRoot = useTranslations();
  const { currentOrganization, session } = useSession();
  const organizationId =
    explicitOrganizationId ??
    session?.defaultOrganizationId ??
    currentOrganization?.id;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [actualResult, setActualResult] = useState("");
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
            listRequirements({ organizationId, spaceId, page: 1, pageSize: 100 }),
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

  function reset() {
    setTitle("");
    setDescription("");
    setSteps("");
    setExpectedResult("");
    setActualResult("");
    setSeverity("MAJOR");
    setVersionId("");
    setRequirementId("");
    setRelatedTaskId("");
    setAssigneeId("");
    setPriority("MEDIUM");
    setDueDate("");
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
        { organizationId, spaceId },
        toCreateBugRequest({
          title: trimmed,
          description,
          stepsToReproduce: steps,
          expectedResult,
          actualResult,
          severity,
          priority,
          versionId,
          requirementId,
          relatedTaskId,
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
        data-testid="create-bug-dialog"
        className="max-h-[90vh] overflow-y-auto"
      >
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
            <Label htmlFor="create-bug-title">{t("fields.title")}</Label>
            <Input
              id="create-bug-title"
              data-testid="create-bug-title-input"
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
            <Label htmlFor="create-bug-description">
              {t("fields.description")}
            </Label>
            <Textarea
              id="create-bug-description"
              data-testid="create-bug-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={8000}
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-bug-steps">{t("fields.steps")}</Label>
            <Textarea
              id="create-bug-steps"
              data-testid="create-bug-steps-input"
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
              maxLength={8000}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-bug-expected">
                {tRoot("bugs.form.expectedResult")}
              </Label>
              <Textarea
                id="create-bug-expected"
                data-testid="create-bug-expected-input"
                value={expectedResult}
                onChange={(event) => setExpectedResult(event.target.value)}
                maxLength={8000}
                rows={3}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-bug-actual">
                {tRoot("bugs.form.actualResult")}
              </Label>
              <Textarea
                id="create-bug-actual"
                data-testid="create-bug-actual-input"
                value={actualResult}
                onChange={(event) => setActualResult(event.target.value)}
                maxLength={8000}
                rows={3}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <OptionsLoadNotice
              status={optionsLoadState}
              onRetry={retryOptionsLoad}
              t={tRoot}
              errorTestId="create-bug-options-error"
              retryTestId="create-bug-options-retry"
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-bug-severity">
                {t("fields.severity")}
              </Label>
              <select
                id="create-bug-severity"
                data-testid="create-bug-severity-select"
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
                data-testid="create-bug-priority-select"
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
                data-testid="create-bug-version-select"
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-bug-requirement">
                {tRoot("bugs.form.requirement")}
              </Label>
              <select
                id="create-bug-requirement"
                data-testid="create-bug-requirement-select"
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-bug-related-task">
                {tRoot("bugs.form.relatedTask")}
              </Label>
              <select
                id="create-bug-related-task"
                data-testid="create-bug-related-task-select"
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-bug-assignee">
                {t("fields.assignee")}
              </Label>
              <select
                id="create-bug-assignee"
                data-testid="create-bug-assignee-select"
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
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="create-bug-duedate">{t("fields.dueDate")}</Label>
              <Input
                id="create-bug-duedate"
                data-testid="create-bug-duedate-input"
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
              data-testid="create-bug-submit"
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

function toDateInputRequestValue(value: string): string {
  return value ? new Date(`${value}T00:00:00`).toISOString() : value;
}
