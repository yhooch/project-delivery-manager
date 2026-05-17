"use client";

import type {
  ActionFormFieldSummary,
  WorkflowBinding,
  WorkflowActionConfigSummary,
  WorkflowDefinition,
  WorkflowState,
  WorkflowVersion,
} from "@project-delivery/shared";
import { ArrowLeft, GitBranch, Plus, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Link } from "../../i18n/routing";
import { ApiClientError } from "../../lib/api-client";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { canManageWorkflow as canManageWorkflowForRole } from "../../lib/permission-gates";
import {
  translateWorkflowActionName,
  translateWorkflowDefinitionDescription,
  translateWorkflowDefinitionName,
  translateWorkflowFieldLabel,
  translateWorkflowStateName,
} from "../../lib/workflow-display";
import {
  createWorkflowVersion,
  deleteActionFormField,
  deleteWorkflowAction,
  deleteWorkflowState,
  getWorkflow,
  getWorkflowVersion,
  listWorkflowBindings,
  listWorkflowVersions,
  publishWorkflowVersion,
  updateWorkflowVersion,
} from "../../lib/workflow-service";
import { useSession } from "../providers/session-provider";

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
import { SelectMenu } from "../ui/select-menu";
import { ErrorState, ListSkeleton } from "../v2/states";
import { PageHeader } from "../v2/page-header";

import { WorkflowActionDialog } from "./workflow-action-dialog";
import { WorkflowActionList } from "./workflow-action-list";
import {
  WorkflowBindingDialog,
  WorkflowBindingList,
} from "./workflow-binding-list";
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
  | { kind: "editAction"; action: WorkflowActionConfigSummary }
  | { kind: "createField"; actionId: string }
  | { kind: "editField"; actionId: string; field: ActionFormFieldSummary }
  | { kind: "createBinding" }
  | { kind: "editBinding"; binding: WorkflowBinding };

type DeleteConfirmState =
  | {
      actionLabel: string;
      kind: "state";
      targetId: string;
      targetName: string;
    }
  | {
      actionLabel: string;
      kind: "action";
      targetId: string;
      targetName: string;
    }
  | {
      actionLabel: string;
      kind: "field";
      targetId: string;
      targetName: string;
    };

type PublishIssue =
  | "noStates"
  | "multipleStartStates"
  | "noStartState"
  | "noEndState"
  | "missingOutgoingAction"
  | "missingFromState"
  | "missingToState"
  | "unreachableState";

type BackendPublishIssue = {
  actionId?: string;
  code?: string;
  message?: string;
  stateId?: string;
};

const backendPublishIssueMessageKeys = {
  ACTION_SOURCE_STATE_NOT_FOUND:
    "workflow.publishIssues.codes.ACTION_SOURCE_STATE_NOT_FOUND",
  ACTION_TARGET_STATE_NOT_FOUND:
    "workflow.publishIssues.codes.ACTION_TARGET_STATE_NOT_FOUND",
  END_STATE_REQUIRED: "workflow.publishIssues.codes.END_STATE_REQUIRED",
  ISOLATED_STATE: "workflow.publishIssues.codes.ISOLATED_STATE",
  NON_END_STATE_ACTION_REQUIRED:
    "workflow.publishIssues.codes.NON_END_STATE_ACTION_REQUIRED",
  START_STATE_COUNT_INVALID:
    "workflow.publishIssues.codes.START_STATE_COUNT_INVALID",
  STATE_CATEGORY_REQUIRED:
    "workflow.publishIssues.codes.STATE_CATEGORY_REQUIRED",
} as const;

function validateForPublish(version: WorkflowVersion): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (version.states.length === 0) {
    issues.push("noStates");
  }
  const startStates = version.states.filter((state) => state.isStart);
  if (startStates.length === 0) {
    issues.push("noStartState");
  }
  if (startStates.length > 1) {
    issues.push("multipleStartStates");
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
  const outgoingStateIds = new Set(
    version.actions
      .filter((action) => stateIds.has(action.fromStateId))
      .map((action) => action.fromStateId),
  );
  if (
    version.states.some(
      (state) => !state.isEnd && !outgoingStateIds.has(state.id),
    )
  ) {
    issues.push("missingOutgoingAction");
  }
  if (startStates.length === 1) {
    const reachable = new Set<string>();
    const queue = [startStates[0]!.id];
    while (queue.length > 0) {
      const stateId = queue.shift();
      if (!stateId || reachable.has(stateId)) {
        continue;
      }
      reachable.add(stateId);
      for (const action of version.actions) {
        if (
          action.fromStateId === stateId &&
          stateIds.has(action.toStateId) &&
          !reachable.has(action.toStateId)
        ) {
          queue.push(action.toStateId);
        }
      }
    }
    if (version.states.some((state) => !reachable.has(state.id))) {
      issues.push("unreachableState");
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
  const tWorkItemType = useTranslations("workflow.workItemType");
  const tRoot = useTranslations();
  const { currentSpace, session, status } = useSession();
  const spaceId = session?.defaultSpaceId ?? currentSpace?.id;
  const sessionSpace = session?.spaces?.find((space) => space.id === spaceId);
  const organizationId =
    currentSpace?.organizationId ??
    sessionSpace?.organizationId ??
    session?.defaultOrganizationId;
  const currentSpaceRole = currentSpace?.role ?? sessionSpace?.role;
  const currentSpaceStatus = currentSpace?.status ?? sessionSpace?.status;
  const canManageWorkflow = canManageWorkflowForRole(
    currentSpaceRole,
    currentSpaceStatus,
  );
  const workflowConfigContextKey = `${status}:${organizationId ?? ""}:${
    spaceId ?? ""
  }:${workflowId}`;
  const workflowConfigContextKeyRef = useRef(workflowConfigContextKey);
  workflowConfigContextKeyRef.current = workflowConfigContextKey;
  const shellRequestRef = useRef(0);
  const versionRequestRef = useRef(0);
  const bindingRequestRef = useRef(0);
  const actionRequestRef = useRef(0);
  const selectedVersionContextRef = useRef("");

  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [bindings, setBindings] = useState<WorkflowBinding[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [version, setVersion] = useState<WorkflowVersion | null>(null);
  const [isLoadingShell, setIsLoadingShell] = useState(false);
  const [isLoadingVersion, setIsLoadingVersion] = useState(false);
  const [shellErrorKey, setShellErrorKey] = useState<string | null>(null);
  const [versionErrorKey, setVersionErrorKey] = useState<string | null>(null);
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [publishIssues, setPublishIssues] = useState<PublishIssue[]>([]);
  const [publishServerIssues, setPublishServerIssues] = useState<
    BackendPublishIssue[]
  >([]);
  const [busy, setBusy] = useState<"none" | "publish" | "disable" | "copy">(
    "none",
  );
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(
    null,
  );

  const loadShell = useCallback(async () => {
    if (!spaceId) {
      return;
    }
    const requestId = ++shellRequestRef.current;
    const requestContextKey = workflowConfigContextKey;
    const isCurrentRequest = () =>
      shellRequestRef.current === requestId &&
      workflowConfigContextKeyRef.current === requestContextKey;

    setIsLoadingShell(true);
    setShellErrorKey(null);
    try {
      const [definition, versionPage, bindingPage] = await Promise.all([
        getWorkflow({ organizationId, spaceId, workflowId }),
        listWorkflowVersions({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          workflowId,
        }),
        listWorkflowBindings({
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
      if (!isCurrentRequest()) {
        return;
      }
      setWorkflow(definition);
      setVersions(sortedVersions);
      setBindings(bindingPage.items);
      setSelectedVersionId((current) => {
        const canKeepCurrent =
          selectedVersionContextRef.current === requestContextKey &&
          current.length > 0 &&
          sortedVersions.some((item) => item.id === current);
        selectedVersionContextRef.current = requestContextKey;
        if (canKeepCurrent) {
          return current;
        }
        const draft = sortedVersions.find((item) => item.status === "DRAFT");
        return draft?.id ?? sortedVersions[0]?.id ?? "";
      });
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setShellErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (isCurrentRequest()) {
        setIsLoadingShell(false);
      }
    }
  }, [organizationId, spaceId, workflowConfigContextKey, workflowId]);

  const loadVersion = useCallback(
    async (versionId: string) => {
      if (!spaceId || !versionId) {
        return;
      }
      const requestId = ++versionRequestRef.current;
      const requestContextKey = workflowConfigContextKey;
      const isCurrentRequest = () =>
        versionRequestRef.current === requestId &&
        workflowConfigContextKeyRef.current === requestContextKey;

      setIsLoadingVersion(true);
      setVersionErrorKey(null);
      try {
        const result = await getWorkflowVersion({
          organizationId,
          spaceId,
          workflowVersionId: versionId,
        });
        if (!isCurrentRequest()) {
          return;
        }
        setVersion(result);
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        setVersionErrorKey(getApiErrorMessageKey(error));
      } finally {
        if (isCurrentRequest()) {
          setIsLoadingVersion(false);
        }
      }
    },
    [organizationId, spaceId, workflowConfigContextKey],
  );

  useEffect(() => {
    shellRequestRef.current += 1;
    versionRequestRef.current += 1;
    bindingRequestRef.current += 1;
    actionRequestRef.current += 1;
    selectedVersionContextRef.current = "";
    setWorkflow(null);
    setVersions([]);
    setBindings([]);
    setSelectedVersionId("");
    setVersion(null);
    setIsLoadingShell(false);
    setIsLoadingVersion(false);
    setShellErrorKey(null);
    setVersionErrorKey(null);
    setActionErrorKey(null);
    setPublishIssues([]);
    setPublishServerIssues([]);
    setBusy("none");
    setDialog({ kind: "closed" });
  }, [workflowConfigContextKey]);

  useEffect(() => {
    if (status !== "authenticated" || !spaceId) {
      return;
    }
    void loadShell();
  }, [loadShell, spaceId, status]);

  useEffect(() => {
    actionRequestRef.current += 1;
    setBusy("none");
    setDialog({ kind: "closed" });
    setActionErrorKey(null);
    if (
      !selectedVersionId ||
      selectedVersionContextRef.current !== workflowConfigContextKey
    ) {
      versionRequestRef.current += 1;
      setVersion(null);
      setVersionErrorKey(null);
      setIsLoadingVersion(false);
      return;
    }
    setPublishIssues([]);
    setPublishServerIssues([]);
    void loadVersion(selectedVersionId);
  }, [loadVersion, selectedVersionId, workflowConfigContextKey]);

  const isReadOnly = useMemo(() => {
    if (!version) {
      return true;
    }
    return !canManageWorkflow || version.status !== "DRAFT";
  }, [canManageWorkflow, version]);

  const canBindCurrentVersion = Boolean(
    canManageWorkflow && version?.status === "PUBLISHED",
  );
  const bindingWorkItemTypes = useMemo(
    () => [...new Set(bindings.map((binding) => binding.workItemType))].sort(),
    [bindings],
  );
  const defaultBindingWorkItemTypes = useMemo(
    () =>
      [
        ...new Set(
          bindings
            .filter((binding) => binding.isDefault)
            .map((binding) => binding.workItemType),
        ),
      ].sort(),
    [bindings],
  );

  const handleRefreshVersion = useCallback(() => {
    if (selectedVersionId) {
      void loadVersion(selectedVersionId);
    }
  }, [loadVersion, selectedVersionId]);

  const handleRefreshBindings = useCallback(async () => {
    if (!spaceId) {
      return;
    }
    const requestId = ++bindingRequestRef.current;
    const requestContextKey = workflowConfigContextKey;
    const isCurrentRequest = () =>
      bindingRequestRef.current === requestId &&
      workflowConfigContextKeyRef.current === requestContextKey;

    setActionErrorKey(null);
    try {
      const bindingPage = await listWorkflowBindings({
        organizationId,
        page: 1,
        pageSize: 100,
        spaceId,
        workflowId,
      });
      if (!isCurrentRequest()) {
        return;
      }
      setBindings(bindingPage.items);
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setActionErrorKey(getApiErrorMessageKey(error));
    }
  }, [organizationId, spaceId, workflowConfigContextKey, workflowId]);

  async function handlePublish() {
    if (!version || !spaceId) {
      return;
    }
    const issues = validateForPublish(version);
    if (issues.length > 0) {
      setPublishIssues(issues);
      setPublishServerIssues([]);
      return;
    }
    setPublishIssues([]);
    setPublishServerIssues([]);
    setActionErrorKey(null);
    setBusy("publish");
    const requestId = ++actionRequestRef.current;
    const requestContextKey = workflowConfigContextKey;
    const isCurrentRequest = () =>
      actionRequestRef.current === requestId &&
      workflowConfigContextKeyRef.current === requestContextKey;
    try {
      const updated = await publishWorkflowVersion({
        organizationId,
        spaceId,
        workflowVersionId: version.id,
      });
      if (!isCurrentRequest()) {
        return;
      }
      setVersion(updated);
      await loadShell();
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setActionErrorKey(getApiErrorMessageKey(error));
      setPublishServerIssues(extractPublishIssueDetails(error));
    } finally {
      if (isCurrentRequest()) {
        setBusy("none");
      }
    }
  }

  async function handleDisable() {
    if (!version || !spaceId) {
      return;
    }
    setActionErrorKey(null);
    setBusy("disable");
    const requestId = ++actionRequestRef.current;
    const requestContextKey = workflowConfigContextKey;
    const isCurrentRequest = () =>
      actionRequestRef.current === requestId &&
      workflowConfigContextKeyRef.current === requestContextKey;
    try {
      const updated = await updateWorkflowVersion(
        {
          organizationId,
          spaceId,
          workflowVersionId: version.id,
        },
        { status: "DISABLED" },
      );
      if (!isCurrentRequest()) {
        return;
      }
      setVersion(updated);
      await loadShell();
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (isCurrentRequest()) {
        setBusy("none");
      }
    }
  }

  async function handleCopyDraft() {
    if (!spaceId || !version || version.status !== "PUBLISHED") {
      return;
    }
    setActionErrorKey(null);
    setBusy("copy");
    const requestId = ++actionRequestRef.current;
    const requestContextKey = workflowConfigContextKey;
    const isCurrentRequest = () =>
      actionRequestRef.current === requestId &&
      workflowConfigContextKeyRef.current === requestContextKey;
    try {
      const draft = await createWorkflowVersion(
        { organizationId, spaceId, workflowId },
        { sourceWorkflowVersionId: version.id },
      );
      if (!isCurrentRequest()) {
        return;
      }
      selectedVersionContextRef.current = requestContextKey;
      setSelectedVersionId(draft.id);
      await loadShell();
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      if (isCurrentRequest()) {
        setBusy("none");
      }
    }
  }

  function handleDeleteState(state: WorkflowState) {
    if (!spaceId) {
      return;
    }
    setDeleteConfirm({
      actionLabel: t("states.actions.delete"),
      kind: "state",
      targetId: state.id,
      targetName: translateWorkflowStateName(tRoot, state),
    });
  }

  function handleDeleteAction(action: WorkflowActionConfigSummary) {
    if (!spaceId) {
      return;
    }
    setDeleteConfirm({
      actionLabel: t("actions.actions.delete"),
      kind: "action",
      targetId: action.id,
      targetName: translateWorkflowActionName(tRoot, action),
    });
  }

  function handleDeleteField(
    _action: WorkflowActionConfigSummary,
    field: ActionFormFieldSummary,
  ) {
    if (!spaceId) {
      return;
    }
    setDeleteConfirm({
      actionLabel: t("fields.actions.delete"),
      kind: "field",
      targetId: field.id,
      targetName: translateWorkflowFieldLabel(tRoot, field),
    });
  }

  async function handleConfirmDelete() {
    if (!spaceId || !deleteConfirm) {
      return;
    }
    const pending = deleteConfirm;
    setDeleteConfirm(null);
    setActionErrorKey(null);
    const requestId = ++actionRequestRef.current;
    const requestContextKey = workflowConfigContextKey;
    const isCurrentRequest = () =>
      actionRequestRef.current === requestId &&
      workflowConfigContextKeyRef.current === requestContextKey;
    try {
      if (pending.kind === "state") {
        await deleteWorkflowState({
          organizationId,
          spaceId,
          stateId: pending.targetId,
        });
      } else if (pending.kind === "action") {
        await deleteWorkflowAction({
          actionId: pending.targetId,
          organizationId,
          spaceId,
        });
      } else {
        await deleteActionFormField({
          fieldId: pending.targetId,
          organizationId,
          spaceId,
        });
      }
      if (!isCurrentRequest()) {
        return;
      }
      handleRefreshVersion();
    } catch (error) {
      if (!isCurrentRequest()) {
        return;
      }
      setActionErrorKey(getApiErrorMessageKey(error));
    }
  }

  const headerNode = (
    <PageHeader
      eyebrow={tShell("group.configure")}
      title={
        workflow ? translateWorkflowDefinitionName(tRoot, workflow) : t("loading")
      }
      description={
        workflow
          ? translateWorkflowDefinitionDescription(tRoot, workflow) ??
            t("description")
          : t("description")
      }
      actions={
        <div className="flex items-center gap-2">
          <Button asChild className="h-7 text-xs" size="sm" variant="ghost">
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
      <div data-testid="workflow-config-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 px-6 py-5">
          <ListSkeleton rows={4} />
        </div>
      </div>
    );
  }

  if (shellErrorKey) {
    return (
      <div data-testid="workflow-config-page" className="flex h-full flex-col">
        {headerNode}
        <div className="flex-1 px-6 py-5">
          <ErrorState
            message={tRoot(shellErrorKey)}
            onRetry={() => void loadShell()}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="workflow-config-page" className="flex h-full flex-col">
      {headerNode}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <Label htmlFor="workflow-config-version-select">
            {t("toolbar.versionLabel")}
          </Label>
          <SelectMenu
            aria-label={t("toolbar.versionLabel")}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            data-testid="workflow-config-version-select"
            id="workflow-config-version-select"
            onChange={(event) => {
              selectedVersionContextRef.current = workflowConfigContextKey;
              setSelectedVersionId(event.target.value);
            }}
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
          </SelectMenu>
          {version ? (
            <Badge
              data-testid="workflow-config-version-status"
              variant={versionStatusVariant[version.status]}
            >
              {tStatus(version.status)}
            </Badge>
          ) : null}
          <div
            className="flex flex-wrap items-center gap-1"
            data-testid="workflow-config-list-summary"
          >
            <Badge variant="outline">
              {t("toolbar.versionCount", { count: versions.length })}
            </Badge>
            <Badge variant="outline">
              {bindingWorkItemTypes.length > 0
                ? t("toolbar.targetTypes", {
                    types: bindingWorkItemTypes
                      .map((type) => tWorkItemType(type))
                      .join(", "),
                  })
                : t("toolbar.noTargetTypes")}
            </Badge>
            <Badge
              variant={
                defaultBindingWorkItemTypes.length > 0 ? "success" : "outline"
              }
            >
              {defaultBindingWorkItemTypes.length > 0
                ? t("toolbar.defaultBindings", {
                    types: defaultBindingWorkItemTypes
                      .map((type) => tWorkItemType(type))
                      .join(", "),
                  })
                : t("toolbar.noDefaultBinding")}
            </Badge>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              className="h-7 text-xs"
              data-testid="workflow-config-publish"
              disabled={
                !canManageWorkflow ||
                !version ||
                version.status !== "DRAFT" ||
                busy !== "none"
              }
              onClick={handlePublish}
              size="sm"
            >
              <Send className="h-3 w-3" />
              {busy === "publish"
                ? t("toolbar.publishing")
                : t("toolbar.publish")}
            </Button>
            <Button
              className="h-7 text-xs"
              data-testid="workflow-config-disable"
              disabled={
                !canManageWorkflow ||
                !version ||
                version.status !== "PUBLISHED" ||
                busy !== "none"
              }
              onClick={handleDisable}
              size="sm"
              variant="outline"
            >
              <X className="h-3 w-3" />
              {busy === "disable"
                ? t("toolbar.disabling")
                : t("toolbar.disable")}
            </Button>
            <Button
              className="h-7 text-xs"
              data-testid="workflow-config-copy-draft"
              disabled={
                !canManageWorkflow ||
                !version ||
                version.status !== "PUBLISHED" ||
                busy !== "none"
              }
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
            <p>{tRoot(actionErrorKey)}</p>
            {publishServerIssues.length > 0 ? (
              <ul
                className="mt-1 list-inside list-disc"
                data-testid="workflow-config-publish-server-issues"
              >
                {publishServerIssues.map((issue, index) => (
                  <li key={`${issue.code ?? "issue"}-${index}`}>
                    {formatBackendPublishIssue(issue, tRoot)}
                  </li>
                ))}
              </ul>
            ) : null}
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
              onDelete={handleDeleteState}
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
              onDelete={handleDeleteAction}
              onDeleteField={handleDeleteField}
              onEdit={(action) => setDialog({ action, kind: "editAction" })}
              onEditField={(action, field) =>
                setDialog({ actionId: action.id, field, kind: "editField" })
              }
              readOnly={isReadOnly}
              states={version.states}
            />
            <WorkflowBindingList
              bindings={bindings}
              currentVersion={version}
              onCreate={() => setDialog({ kind: "createBinding" })}
              onEdit={(binding) => setDialog({ binding, kind: "editBinding" })}
              readOnly={!canBindCurrentVersion}
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
          {dialog.kind === "createBinding" || dialog.kind === "editBinding" ? (
            <WorkflowBindingDialog
              context={{ organizationId, spaceId }}
              mode={
                dialog.kind === "editBinding"
                  ? { binding: dialog.binding, kind: "edit" }
                  : { kind: "create" }
              }
              onClose={() => setDialog({ kind: "closed" })}
              onSuccess={() => {
                setDialog({ kind: "closed" });
                void handleRefreshBindings();
              }}
              open={canBindCurrentVersion}
              workflowId={workflowId}
              workflowVersionId={version.id}
            />
          ) : null}
        </>
      ) : null}
      <WorkflowDeleteConfirmDialog
        actionLabel={deleteConfirm?.actionLabel ?? ""}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => void handleConfirmDelete()}
        open={deleteConfirm !== null}
        t={t}
        targetName={deleteConfirm?.targetName ?? ""}
      />
    </div>
  );
}

function extractPublishIssueDetails(error: unknown): BackendPublishIssue[] {
  if (!(error instanceof ApiClientError)) {
    return [];
  }

  const details = error.error.details;
  if (!isRecord(details) || !Array.isArray(details.issues)) {
    return [];
  }

  return details.issues
    .map((issue): BackendPublishIssue | null => {
      if (typeof issue === "string") {
        return { message: issue };
      }

      if (!isRecord(issue)) {
        return null;
      }

      return {
        actionId: getStringValue(issue.actionId),
        code: getStringValue(issue.code),
        message: getStringValue(issue.message),
        stateId: getStringValue(issue.stateId),
      };
    })
    .filter((issue): issue is BackendPublishIssue => issue !== null);
}

function formatBackendPublishIssue(
  issue: BackendPublishIssue,
  tRoot: ReturnType<typeof useTranslations>,
): string {
  const code = issue.code?.trim();
  const messageKey =
    code &&
    backendPublishIssueMessageKeys[
      code as keyof typeof backendPublishIssueMessageKeys
    ];
  const message = messageKey
    ? tRoot(messageKey)
    : issue.message?.trim() || tRoot("workflow.publishIssues.unknownMessage");
  const targetId = issue.stateId ?? issue.actionId;

  if (!code) {
    return targetId ? `${message} (${targetId})` : message;
  }

  return targetId ? `${code}: ${message} (${targetId})` : `${code}: ${message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function WorkflowDeleteConfirmDialog({
  actionLabel,
  onCancel,
  onConfirm,
  open,
  t,
  targetName,
}: {
  actionLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  t: ReturnType<typeof useTranslations<"workflow.config">>;
  targetName: string;
}) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={open}
    >
      <DialogContent data-testid="workflow-delete-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{t("deleteConfirm.title")}</DialogTitle>
          <DialogDescription>
            {t("deleteConfirm.description", {
              action: actionLabel,
              target: targetName,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            data-testid="workflow-delete-cancel"
            onClick={onCancel}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("deleteConfirm.cancel")}
          </Button>
          <Button
            data-testid="workflow-delete-confirm"
            onClick={onConfirm}
            size="sm"
            type="button"
            variant="destructive"
          >
            {t("deleteConfirm.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <label
      className="text-xs font-medium text-muted-foreground"
      htmlFor={htmlFor}
    >
      {children}
    </label>
  );
}
