"use client";

import type {
  ActionFormFieldSummary,
  WorkflowActionSummary,
  WorkflowDefinition,
  WorkflowState,
  WorkflowVersion,
} from "@project-delivery/shared";
import { ArrowLeft, GitBranch, Plus, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createWorkflowVersion,
  deleteActionFormField,
  deleteWorkflowAction,
  deleteWorkflowState,
  getWorkflow,
  getWorkflowVersion,
  listWorkflowVersions,
  publishWorkflowVersion,
  updateWorkflowVersion,
} from "../../lib/workflow-service";
import { useSession } from "../providers/session-provider";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";

import { WorkflowActionDialog } from "./workflow-action-dialog";
import { WorkflowActionList } from "./workflow-action-list";
import { WorkflowFormFieldDialog } from "./workflow-form-field-dialog";
import { WorkflowStateDialog } from "./workflow-state-dialog";
import { WorkflowStateList } from "./workflow-state-list";

export type WorkflowConfigPageProps = {
  workflowId: string;
};

type DialogState =
  | { kind: "closed" }
  | { kind: "createState" }
  | { kind: "editState"; state: WorkflowState }
  | { kind: "createAction" }
  | { kind: "editAction"; action: WorkflowActionSummary }
  | { kind: "createField"; actionId: string }
  | { kind: "editField"; actionId: string; field: ActionFormFieldSummary };

type PublishIssue =
  | "noStates"
  | "noStartState"
  | "noEndState"
  | "missingFromState"
  | "missingToState";

function validateForPublish(version: WorkflowVersion): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (version.states.length === 0) {
    issues.push("noStates");
  }
  if (!version.states.some((state) => state.isStart)) {
    issues.push("noStartState");
  }
  if (!version.states.some((state) => state.isEnd)) {
    issues.push("noEndState");
  }
  const stateIds = new Set(version.states.map((state) => state.id));
  for (const action of version.actions) {
    if (!stateIds.has(action.fromStateId)) {
      issues.push("missingFromState");
      break;
    }
  }
  for (const action of version.actions) {
    if (!stateIds.has(action.toStateId)) {
      issues.push("missingToState");
      break;
    }
  }
  return issues;
}

const versionStatusVariant: Record<
  WorkflowVersion["status"],
  "success" | "warning" | "default"
> = {
  PUBLISHED: "success",
  DRAFT: "warning",
  DISABLED: "default",
};

export function WorkflowConfigPage({ workflowId }: WorkflowConfigPageProps) {
  const t = useTranslations("workflow.config");
  const tStatus = useTranslations("workflow.versionStatus");
  const tShell = useTranslations("shell.nav");
  const tRoot = useTranslations();
  const { currentSpace, session, status } = useSession();
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;
  const organizationId = currentSpace?.organizationId ?? session?.defaultOrganizationId;

  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [version, setVersion] = useState<WorkflowVersion | null>(null);
  const [isLoadingShell, setIsLoadingShell] = useState(false);
  const [isLoadingVersion, setIsLoadingVersion] = useState(false);
  const [shellErrorKey, setShellErrorKey] = useState<string | null>(null);
  const [versionErrorKey, setVersionErrorKey] = useState<string | null>(null);
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [publishIssues, setPublishIssues] = useState<PublishIssue[]>([]);
  const [busy, setBusy] = useState<"none" | "publish" | "disable" | "copy">("none");
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });

  const loadShell = useCallback(async () => {
    if (!spaceId) {
      return;
    }
    setIsLoadingShell(true);
    setShellErrorKey(null);
    try {
      const [definition, versionPage] = await Promise.all([
        getWorkflow({ organizationId, spaceId, workflowId }),
        listWorkflowVersions({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          workflowId,
        }),
      ]);
      const sortedVersions = [...versionPage.items].sort(
        (a, b) => b.version - a.version,
      );
      setWorkflow(definition);
      setVersions(sortedVersions);
      setSelectedVersionId((current) => {
        if (current && sortedVersions.some((item) => item.id === current)) {
          return current;
        }
        const draft = sortedVersions.find((item) => item.status === "DRAFT");
        return draft?.id ?? sortedVersions[0]?.id ?? "";
      });
    } catch (error) {
      setShellErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoadingShell(false);
    }
  }, [organizationId, spaceId, workflowId]);

  const loadVersion = useCallback(
    async (versionId: string) => {
      if (!spaceId || !versionId) {
        return;
      }
      setIsLoadingVersion(true);
      setVersionErrorKey(null);
      try {
        const result = await getWorkflowVersion({
          organizationId,
          spaceId,
          workflowVersionId: versionId,
        });
        setVersion(result);
      } catch (error) {
        setVersionErrorKey(getApiErrorMessageKey(error));
      } finally {
        setIsLoadingVersion(false);
      }
    },
    [organizationId, spaceId],
  );

  useEffect(() => {
    if (status !== "authenticated" || !spaceId) {
      return;
    }
    void loadShell();
  }, [loadShell, spaceId, status]);

  useEffect(() => {
    if (!selectedVersionId) {
      setVersion(null);
      return;
    }
    setPublishIssues([]);
    void loadVersion(selectedVersionId);
  }, [loadVersion, selectedVersionId]);

  const isReadOnly = useMemo(() => {
    if (!version) {
      return true;
    }
    return version.status !== "DRAFT";
  }, [version]);

  const handleRefreshVersion = useCallback(() => {
    if (selectedVersionId) {
      void loadVersion(selectedVersionId);
    }
  }, [loadVersion, selectedVersionId]);

  async function handlePublish() {
    if (!version || !spaceId) {
      return;
    }
    const issues = validateForPublish(version);
    if (issues.length > 0) {
      setPublishIssues(issues);
      return;
    }
    setPublishIssues([]);
    setActionErrorKey(null);
    setBusy("publish");
    try {
      const updated = await publishWorkflowVersion({
        organizationId,
        spaceId,
        workflowVersionId: version.id,
      });
      setVersion(updated);
      await loadShell();
    } catch (error) {
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setBusy("none");
    }
  }

  async function handleDisable() {
    if (!version || !spaceId) {
      return;
    }
    setActionErrorKey(null);
    setBusy("disable");
    try {
      const updated = await updateWorkflowVersion(
        {
          organizationId,
          spaceId,
          workflowVersionId: version.id,
        },
        { status: "DISABLED" },
      );
      setVersion(updated);
      await loadShell();
    } catch (error) {
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setBusy("none");
    }
  }

  async function handleCopyDraft() {
    if (!spaceId || !version) {
      return;
    }
    setActionErrorKey(null);
    setBusy("copy");
    try {
      const draft = await createWorkflowVersion(
        { organizationId, spaceId, workflowId },
        { sourceWorkflowVersionId: version.id },
      );
      setSelectedVersionId(draft.id);
      await loadShell();
    } catch (error) {
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setBusy("none");
    }
  }

  async function handleDeleteState(state: WorkflowState) {
    if (!spaceId) {
      return;
    }
    setActionErrorKey(null);
    try {
      await deleteWorkflowState({
        organizationId,
        spaceId,
        stateId: state.id,
      });
      handleRefreshVersion();
    } catch (error) {
      setActionErrorKey(getApiErrorMessageKey(error));
    }
  }

  async function handleDeleteAction(action: WorkflowActionSummary) {
    if (!spaceId) {
      return;
    }
    setActionErrorKey(null);
    try {
      await deleteWorkflowAction({
        actionId: action.id,
        organizationId,
        spaceId,
      });
      handleRefreshVersion();
    } catch (error) {
      setActionErrorKey(getApiErrorMessageKey(error));
    }
  }

  async function handleDeleteField(
    _action: WorkflowActionSummary,
    field: ActionFormFieldSummary,
  ) {
    if (!spaceId) {
      return;
    }
    setActionErrorKey(null);
    try {
      await deleteActionFormField({
        fieldId: field.id,
        organizationId,
        spaceId,
      });
      handleRefreshVersion();
    } catch (error) {
      setActionErrorKey(getApiErrorMessageKey(error));
    }
  }

  const headerNode = (
    <PageHeader
      eyebrow={tShell("group.configure")}
      title={workflow?.name ?? t("loading")}
      description={workflow?.description ?? t("description")}
      actions={
        <div className="flex items-center gap-2">
          <Button
            asChild
            className="h-7 text-xs"
            size="sm"
            variant="ghost"
          >
            <Link href="/workflow">
              <ArrowLeft className="h-3 w-3" />
              {t("backToList")}
            </Link>
          </Button>
        </div>
      }
    />
  );

  if (status === "loading" || (isLoadingShell && !workflow)) {
    return (
      <div className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 px-6 py-5">
          <ListSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (shellErrorKey) {
    return (
      <div className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 px-6 py-5">
          <ErrorState message={tRoot(shellErrorKey)} onRetry={() => void loadShell()} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {headerNode}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <Label htmlFor="workflow-config-version-select">
            {t("toolbar.versionLabel")}
          </Label>
          <select
            aria-label={t("toolbar.versionLabel")}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            data-testid="workflow-config-version-select"
            id="workflow-config-version-select"
            onChange={(event) => setSelectedVersionId(event.target.value)}
            value={selectedVersionId}
          >
            {versions.length === 0 ? (
              <option value="">{t("toolbar.noVersions")}</option>
            ) : null}
            {versions.map((item) => (
              <option key={item.id} value={item.id}>
                {t("toolbar.versionOption", {
                  version: item.version,
                  status: tStatus(item.status),
                })}
              </option>
            ))}
          </select>
          {version ? (
            <Badge
              data-testid="workflow-config-version-status"
              variant={versionStatusVariant[version.status]}
            >
              {tStatus(version.status)}
            </Badge>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              className="h-7 text-xs"
              data-testid="workflow-config-publish"
              disabled={
                !version || version.status !== "DRAFT" || busy !== "none"
              }
              onClick={handlePublish}
              size="sm"
            >
              <Send className="h-3 w-3" />
              {busy === "publish" ? t("toolbar.publishing") : t("toolbar.publish")}
            </Button>
            <Button
              className="h-7 text-xs"
              data-testid="workflow-config-disable"
              disabled={
                !version || version.status !== "PUBLISHED" || busy !== "none"
              }
              onClick={handleDisable}
              size="sm"
              variant="outline"
            >
              <X className="h-3 w-3" />
              {busy === "disable" ? t("toolbar.disabling") : t("toolbar.disable")}
            </Button>
            <Button
              className="h-7 text-xs"
              data-testid="workflow-config-copy-draft"
              disabled={!version || busy !== "none"}
              onClick={handleCopyDraft}
              size="sm"
              variant="outline"
            >
              <Plus className="h-3 w-3" />
              {busy === "copy" ? t("toolbar.copying") : t("toolbar.copyDraft")}
            </Button>
          </div>
        </div>

        {isReadOnly && version ? (
          <div
            className="mb-3 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-info"
            data-testid="workflow-config-readonly-hint"
            role="note"
          >
            {t("readonlyHint")}
          </div>
        ) : null}

        {publishIssues.length > 0 ? (
          <div
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="workflow-config-publish-issues"
            role="alert"
          >
            <p className="font-medium">{t("publishValidation.title")}</p>
            <ul className="mt-1 list-inside list-disc">
              {publishIssues.map((issue) => (
                <li key={issue}>{t(`publishValidation.issues.${issue}`)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {actionErrorKey ? (
          <div
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {tRoot(actionErrorKey)}
          </div>
        ) : null}

        {versionErrorKey ? (
          <ErrorState
            message={tRoot(versionErrorKey)}
            onRetry={() => loadVersion(selectedVersionId)}
          />
        ) : isLoadingVersion ? (
          <ListSkeleton rows={3} />
        ) : version ? (
          <div className="flex flex-col gap-4">
            <WorkflowStateList
              onCreate={() => setDialog({ kind: "createState" })}
              onDelete={(state) => void handleDeleteState(state)}
              onEdit={(state) => setDialog({ kind: "editState", state })}
              readOnly={isReadOnly}
              states={version.states}
            />
            <WorkflowActionList
              actions={version.actions}
              onCreate={() => setDialog({ kind: "createAction" })}
              onCreateField={(action) =>
                setDialog({ actionId: action.id, kind: "createField" })
              }
              onDelete={(action) => void handleDeleteAction(action)}
              onDeleteField={(action, field) => void handleDeleteField(action, field)}
              onEdit={(action) => setDialog({ action, kind: "editAction" })}
              onEditField={(action, field) =>
                setDialog({ actionId: action.id, field, kind: "editField" })
              }
              readOnly={isReadOnly}
              states={version.states}
            />
          </div>
        ) : (
          <p className="px-6 py-8 text-center text-xs text-muted-foreground">
            {t("noVersionSelected")}
          </p>
        )}
      </div>

      {spaceId && version ? (
        <>
          {dialog.kind === "createState" || dialog.kind === "editState" ? (
            <WorkflowStateDialog
              context={{ organizationId, spaceId }}
              mode={
                dialog.kind === "editState"
                  ? { kind: "edit", state: dialog.state }
                  : { kind: "create" }
              }
              onClose={() => setDialog({ kind: "closed" })}
              onSuccess={() => {
                setDialog({ kind: "closed" });
                handleRefreshVersion();
              }}
              open
              workflowVersionId={version.id}
            />
          ) : null}
          {dialog.kind === "createAction" || dialog.kind === "editAction" ? (
            <WorkflowActionDialog
              context={{ organizationId, spaceId }}
              mode={
                dialog.kind === "editAction"
                  ? { action: dialog.action, kind: "edit" }
                  : { kind: "create" }
              }
              onClose={() => setDialog({ kind: "closed" })}
              onSuccess={() => {
                setDialog({ kind: "closed" });
                handleRefreshVersion();
              }}
              open
              states={version.states}
              workflowVersionId={version.id}
            />
          ) : null}
          {dialog.kind === "createField" || dialog.kind === "editField" ? (
            <WorkflowFormFieldDialog
              actionId={dialog.actionId}
              context={{ organizationId, spaceId }}
              mode={
                dialog.kind === "editField"
                  ? { field: dialog.field, kind: "edit" }
                  : { kind: "create" }
              }
              onClose={() => setDialog({ kind: "closed" })}
              onSuccess={() => {
                setDialog({ kind: "closed" });
                handleRefreshVersion();
              }}
              open
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Label({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="text-xs font-medium text-muted-foreground" htmlFor={htmlFor}>
      {children}
    </label>
  );
}
