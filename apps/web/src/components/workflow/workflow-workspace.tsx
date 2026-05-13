"use client";

import type {
  ActionFormFieldSummary,
  ActionFormFieldType,
  Priority,
  SpaceRole,
  StatusCategory,
  WorkflowActionSummary,
  WorkflowActorRelation,
  WorkflowBinding,
  WorkflowDefinition,
  WorkflowDefinitionStatus,
  WorkflowState,
  WorkflowVersion,
  WorkItemType,
} from "@project-delivery/shared";
import {
  CircleAlert,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { ApiClientError } from "../../lib/api-client";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createActionFormField,
  createWorkflow,
  createWorkflowAction,
  createWorkflowBinding,
  createWorkflowState,
  createWorkflowVersion,
  deleteActionFormField,
  deleteWorkflowAction,
  deleteWorkflowState,
  getWorkflowVersion,
  listWorkflowBindings,
  listWorkflows,
  publishWorkflowVersion,
  updateActionFormField,
  updateWorkflow,
  updateWorkflowAction,
  updateWorkflowBinding,
  updateWorkflowState,
} from "../../lib/workflow-service";
import { useSession } from "../providers/session-provider";

const MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);
const DEFINITION_STATUSES: WorkflowDefinitionStatus[] = [
  "DRAFT",
  "ACTIVE",
  "DISABLED",
];
const STATUS_CATEGORIES: StatusCategory[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
];
const SPACE_ROLES: SpaceRole[] = [
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
  "VIEWER",
];
const ACTOR_RELATIONS: WorkflowActorRelation[] = [
  "ASSIGNEE",
  "REPORTER",
  "CREATOR",
  "SPACE_OWNER",
];
const FIELD_TYPES: ActionFormFieldType[] = [
  "TEXT",
  "TEXTAREA",
  "SELECT",
  "USER",
  "DATE",
  "NUMBER",
];
const WORK_ITEM_TYPES: WorkItemType[] = ["TASK", "BUG"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

type WorkflowWorkspaceProps = {
  spaceId: string;
};

type WorkflowForm = {
  code: string;
  description: string;
  name: string;
  status: WorkflowDefinitionStatus;
};

type StateForm = {
  category: StatusCategory;
  code: string;
  isEnd: boolean;
  isStart: boolean;
  name: string;
  order: string;
};

type ActionForm = {
  actorRelations: WorkflowActorRelation[];
  allowedSpaceRoles: SpaceRole[];
  code: string;
  fromStateId: string;
  name: string;
  order: string;
  requiresComment: boolean;
  toStateId: string;
};

type FieldForm = {
  fieldType: ActionFormFieldType;
  key: string;
  label: string;
  optionsText: string;
  order: string;
  required: boolean;
};

type BindingForm = {
  bindingId: string;
  isDefault: boolean;
  priority: Priority | "";
  workItemType: WorkItemType;
};

type Notice = {
  kind: "error" | "success";
  key?: string;
  text?: string;
  issues?: PublishIssue[];
};

type PublishIssue = {
  actionId?: string;
  code?: string;
  message?: string;
  stateId?: string;
};

export function WorkflowWorkspace({ spaceId }: WorkflowWorkspaceProps) {
  const t = useTranslations("workflow");
  const tRoot = useTranslations();
  const { session, status } = useSession();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [bindings, setBindings] = useState<WorkflowBinding[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  );
  const [selectedVersion, setSelectedVersion] = useState<WorkflowVersion | null>(
    null,
  );
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isVersionLoading, setIsVersionLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createWorkflowForm, setCreateWorkflowForm] =
    useState<WorkflowForm>(emptyWorkflowForm);
  const [workflowForm, setWorkflowForm] =
    useState<WorkflowForm>(emptyWorkflowForm);
  const [stateForm, setStateForm] = useState<StateForm>(emptyStateForm);
  const [actionForm, setActionForm] = useState<ActionForm>(emptyActionForm);
  const [fieldForm, setFieldForm] = useState<FieldForm>(emptyFieldForm);
  const [bindingForm, setBindingForm] = useState<BindingForm>(emptyBindingForm);

  const currentSpace = useMemo(
    () => session?.spaces.find((space) => space.id === spaceId),
    [session, spaceId],
  );
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;
  const canManage =
    currentSpace !== undefined && MANAGER_ROLES.has(currentSpace.role);
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows],
  );
  const isReadOnly = !canManage || selectedVersion?.status !== "DRAFT";
  const selectedState = useMemo(
    () =>
      selectedVersion?.states.find((state) => state.id === selectedStateId) ??
      null,
    [selectedStateId, selectedVersion],
  );
  const selectedAction = useMemo(
    () =>
      selectedVersion?.actions.find((action) => action.id === selectedActionId) ??
      null,
    [selectedActionId, selectedVersion],
  );
  const selectedField = useMemo(
    () =>
      selectedAction?.formFields.find((field) => field.id === selectedFieldId) ??
      null,
    [selectedAction, selectedFieldId],
  );
  const selectedWorkflowBindings = useMemo(
    () =>
      bindings.filter((binding) => binding.workflowId === selectedWorkflow?.id),
    [bindings, selectedWorkflow?.id],
  );

  const loadWorkspace = useCallback(async () => {
    if (status !== "authenticated") {
      return;
    }

    setIsLoading(true);
    setNotice(null);

    try {
      const [workflowPage, bindingPage] = await Promise.all([
        listWorkflows({ organizationId, page: 1, pageSize: 100, spaceId }),
        listWorkflowBindings({ organizationId, page: 1, pageSize: 100, spaceId }),
      ]);

      setWorkflows(workflowPage.items);
      setBindings(bindingPage.items);
      setSelectedWorkflowId((current) => {
        if (current && workflowPage.items.some((item) => item.id === current)) {
          return current;
        }

        return workflowPage.items[0]?.id ?? null;
      });
    } catch (error) {
      setNotice({ kind: "error", key: getApiErrorMessageKey(error) });
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, spaceId, status]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!selectedWorkflow) {
      setWorkflowForm(emptyWorkflowForm());
      setSelectedVersion(null);
      return;
    }

    setWorkflowForm(workflowToForm(selectedWorkflow));
  }, [selectedWorkflow]);

  useEffect(() => {
    let isActive = true;

    async function loadSelectedVersion() {
      if (!selectedWorkflow) {
        return;
      }

      if (selectedVersion?.workflowId === selectedWorkflow.id) {
        return;
      }

      const binding = bindings.find(
        (item) =>
          item.workflowId === selectedWorkflow.id &&
          item.workflowVersionId === selectedVersion?.id,
      );
      const fallbackBinding =
        binding ??
        bindings.find(
          (item) => item.workflowId === selectedWorkflow.id && item.isDefault,
        ) ??
        bindings.find((item) => item.workflowId === selectedWorkflow.id);

      if (!fallbackBinding) {
        setSelectedVersion((current) =>
          current?.workflowId === selectedWorkflow.id ? current : null,
        );
        return;
      }

      setIsVersionLoading(true);
      try {
        const version = await getWorkflowVersion({
          organizationId,
          spaceId,
          workflowVersionId: fallbackBinding.workflowVersionId,
        });

        if (isActive) {
          setSelectedVersion(version);
        }
      } catch (error) {
        if (isActive) {
          setSelectedVersion(null);
          setNotice({ kind: "error", key: getApiErrorMessageKey(error) });
        }
      } finally {
        if (isActive) {
          setIsVersionLoading(false);
        }
      }
    }

    void loadSelectedVersion();

    return () => {
      isActive = false;
    };
  }, [
    bindings,
    organizationId,
    selectedVersion?.id,
    selectedWorkflow,
    spaceId,
  ]);

  useEffect(() => {
    setSelectedStateId((current) => {
      if (current && selectedVersion?.states.some((state) => state.id === current)) {
        return current;
      }

      return selectedVersion?.states[0]?.id ?? null;
    });
    setSelectedActionId((current) => {
      if (
        current &&
        selectedVersion?.actions.some((action) => action.id === current)
      ) {
        return current;
      }

      return selectedVersion?.actions[0]?.id ?? null;
    });
  }, [selectedVersion]);

  useEffect(() => {
    setStateForm(selectedState ? stateToForm(selectedState) : emptyStateForm());
  }, [selectedState]);

  useEffect(() => {
    setActionForm(
      selectedAction ? actionToForm(selectedAction) : emptyActionForm(),
    );
    setSelectedFieldId((current) => {
      if (current && selectedAction?.formFields.some((field) => field.id === current)) {
        return current;
      }

      return selectedAction?.formFields[0]?.id ?? null;
    });
  }, [selectedAction]);

  useEffect(() => {
    setFieldForm(selectedField ? fieldToForm(selectedField) : emptyFieldForm());
  }, [selectedField]);

  useEffect(() => {
    const binding =
      selectedWorkflowBindings.find(
        (item) => item.workflowVersionId === selectedVersion?.id,
      ) ?? selectedWorkflowBindings[0];
    setBindingForm(binding ? bindingToForm(binding) : emptyBindingForm());
  }, [selectedVersion?.id, selectedWorkflowBindings]);

  async function runBusy(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setNotice(null);

    try {
      await action();
    } catch (error) {
      setNotice(toNotice(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function onCreateWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) {
      return;
    }

    await runBusy("workflow:create", async () => {
      const created = await createWorkflow(
        { organizationId, spaceId },
        {
          code: createWorkflowForm.code.trim(),
          description: optionalText(createWorkflowForm.description),
          name: createWorkflowForm.name.trim(),
        },
      );
      setCreateWorkflowForm(emptyWorkflowForm());
      await loadWorkspace();
      setSelectedWorkflowId(created.id);
      setNotice({ kind: "success", key: "workflow.notices.workflowCreated" });
    });
  }

  async function onSaveWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !selectedWorkflow) {
      return;
    }

    await runBusy("workflow:update", async () => {
      const updated = await updateWorkflow(
        { organizationId, spaceId, workflowId: selectedWorkflow.id },
        {
          code: workflowForm.code.trim(),
          description: optionalText(workflowForm.description),
          name: workflowForm.name.trim(),
          status: workflowForm.status,
        },
      );
      setWorkflows((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice({ kind: "success", key: "workflow.notices.workflowSaved" });
    });
  }

  async function onCreateDraft() {
    if (!canManage || !selectedWorkflow) {
      return;
    }

    await runBusy("version:create", async () => {
      const version = await createWorkflowVersion(
        { organizationId, spaceId, workflowId: selectedWorkflow.id },
        {},
      );
      setSelectedVersion(version);
      setNotice({ kind: "success", key: "workflow.notices.draftCreated" });
    });
  }

  async function onCopyDraft() {
    if (!canManage || !selectedWorkflow || !selectedVersion) {
      return;
    }

    await runBusy("version:copy", async () => {
      const version = await createWorkflowVersion(
        { organizationId, spaceId, workflowId: selectedWorkflow.id },
        { sourceWorkflowVersionId: selectedVersion.id },
      );
      setSelectedVersion(version);
      setNotice({ kind: "success", key: "workflow.notices.draftCopied" });
    });
  }

  async function onPublish() {
    if (!canManage || !selectedVersion || selectedVersion.status !== "DRAFT") {
      return;
    }

    await runBusy("version:publish", async () => {
      const version = await publishWorkflowVersion({
        organizationId,
        spaceId,
        workflowVersionId: selectedVersion.id,
      });
      setSelectedVersion(version);
      setNotice({ kind: "success", key: "workflow.notices.published" });
    });
  }

  async function onSaveState(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isReadOnly || !selectedVersion) {
      return;
    }

    await runBusy("state:save", async () => {
      const payload = stateFormToPayload(stateForm);
      const state = selectedState
        ? await updateWorkflowState(
            { organizationId, spaceId, stateId: selectedState.id },
            payload,
          )
        : await createWorkflowState(
            { organizationId, spaceId, workflowVersionId: selectedVersion.id },
            payload,
          );
      setSelectedVersion(upsertVersionState(selectedVersion, state));
      setSelectedStateId(state.id);
      setNotice({ kind: "success", key: "workflow.notices.stateSaved" });
    });
  }

  async function onDeleteState() {
    if (isReadOnly || !selectedVersion || !selectedState) {
      return;
    }

    await runBusy("state:delete", async () => {
      await deleteWorkflowState({
        organizationId,
        spaceId,
        stateId: selectedState.id,
      });
      setSelectedVersion(removeVersionState(selectedVersion, selectedState.id));
      setSelectedStateId(null);
      setNotice({ kind: "success", key: "workflow.notices.stateDeleted" });
    });
  }

  async function onSaveAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isReadOnly || !selectedVersion) {
      return;
    }

    await runBusy("action:save", async () => {
      const payload = actionFormToPayload(actionForm);
      const action = selectedAction
        ? await updateWorkflowAction(
            { actionId: selectedAction.id, organizationId, spaceId },
            payload,
          )
        : await createWorkflowAction(
            { organizationId, spaceId, workflowVersionId: selectedVersion.id },
            payload,
          );
      setSelectedVersion(upsertVersionAction(selectedVersion, action));
      setSelectedActionId(action.id);
      setNotice({ kind: "success", key: "workflow.notices.actionSaved" });
    });
  }

  async function onDeleteAction() {
    if (isReadOnly || !selectedVersion || !selectedAction) {
      return;
    }

    await runBusy("action:delete", async () => {
      await deleteWorkflowAction({
        actionId: selectedAction.id,
        organizationId,
        spaceId,
      });
      setSelectedVersion(removeVersionAction(selectedVersion, selectedAction.id));
      setSelectedActionId(null);
      setNotice({ kind: "success", key: "workflow.notices.actionDeleted" });
    });
  }

  async function onSaveField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isReadOnly || !selectedVersion || !selectedAction) {
      return;
    }

    await runBusy("field:save", async () => {
      const payload = fieldFormToPayload(fieldForm);
      const field = selectedField
        ? await updateActionFormField(
            { fieldId: selectedField.id, organizationId, spaceId },
            payload,
          )
        : await createActionFormField(
            { actionId: selectedAction.id, organizationId, spaceId },
            payload,
          );
      setSelectedVersion(upsertActionField(selectedVersion, selectedAction.id, field));
      setSelectedFieldId(field.id);
      setNotice({ kind: "success", key: "workflow.notices.fieldSaved" });
    });
  }

  async function onDeleteField() {
    if (isReadOnly || !selectedVersion || !selectedAction || !selectedField) {
      return;
    }

    await runBusy("field:delete", async () => {
      await deleteActionFormField({
        fieldId: selectedField.id,
        organizationId,
        spaceId,
      });
      setSelectedVersion(
        removeActionField(selectedVersion, selectedAction.id, selectedField.id),
      );
      setSelectedFieldId(null);
      setNotice({ kind: "success", key: "workflow.notices.fieldDeleted" });
    });
  }

  async function onSaveBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !selectedWorkflow || !selectedVersion) {
      return;
    }

    await runBusy("binding:save", async () => {
      const payload = {
        isDefault: bindingForm.isDefault,
        priority: bindingForm.priority || undefined,
        workItemType: bindingForm.workItemType,
        workflowId: selectedWorkflow.id,
        workflowVersionId: selectedVersion.id,
      };
      const binding = bindingForm.bindingId
        ? await updateWorkflowBinding(
            {
              bindingId: bindingForm.bindingId,
              organizationId,
              spaceId,
            },
            payload,
          )
        : await createWorkflowBinding({ organizationId, spaceId }, payload);

      setBindings((items) => upsertById(items, binding));
      setBindingForm(bindingToForm(binding));
      setNotice({ kind: "success", key: "workflow.notices.bindingSaved" });
    });
  }

  if (status === "loading") {
    return <InlineState label={t("states.loading.title")} />;
  }

  if (status === "unauthenticated" || !session) {
    return (
      <StatePanel
        title={t("states.unauthenticated.title")}
        description={t("states.unauthenticated.description")}
      />
    );
  }

  return (
    <main className="m1-workspace">
      <header className="page-heading">
        <div>
          <p className="page-heading__eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("description")}</p>
        </div>
        <div className="page-heading__meta">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void loadWorkspace()}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 aria-hidden="true" size={16} strokeWidth={2} />
            ) : (
              <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            )}
            {isLoading ? t("actions.loading") : t("actions.refresh")}
          </button>
        </div>
      </header>

      {notice ? <NoticePanel notice={notice} /> : null}

      {!canManage ? (
        <div className="readonly-note">
          <CircleAlert aria-hidden="true" size={16} strokeWidth={2} />
          <span>{t("permissions.readonly")}</span>
        </div>
      ) : null}

      <section className="workflow-layout">
        <div className="workspace-main">
          <Panel
            icon={<GitBranch aria-hidden="true" size={18} strokeWidth={2} />}
            title={t("list.title")}
            description={t("list.description")}
          >
            {isLoading ? (
              <InlineState label={t("states.loading.title")} />
            ) : workflows.length === 0 ? (
              <EmptyState
                title={t("list.empty.title")}
                description={t("list.empty.description")}
              />
            ) : (
              <div className="workflow-table" role="table" aria-label={t("list.tableLabel")}>
                <div className="workflow-table__row workflow-table__row--head" role="row">
                  <span>{t("list.columns.name")}</span>
                  <span>{t("list.columns.code")}</span>
                  <span>{t("list.columns.status")}</span>
                  <span>{t("list.columns.bindings")}</span>
                </div>
                {workflows.map((workflow) => (
                  <button
                    aria-current={
                      workflow.id === selectedWorkflowId ? "true" : undefined
                    }
                    className="workflow-table__row workflow-table__row--button"
                    key={workflow.id}
                    type="button"
                    onClick={() => setSelectedWorkflowId(workflow.id)}
                  >
                    <span>
                      <strong>{workflow.name}</strong>
                      <small>{workflow.description || t("list.noDescription")}</small>
                    </span>
                    <span>{workflow.code}</span>
                    <span>{t(`definitionStatus.${workflow.status}`)}</span>
                    <span>
                      {
                        bindings.filter((binding) => binding.workflowId === workflow.id)
                          .length
                      }
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <VersionPanel
            actions={selectedVersion?.actions ?? []}
            bindings={selectedWorkflowBindings}
            isLoading={isVersionLoading}
            onCopyDraft={() => void onCopyDraft()}
            onCreateDraft={() => void onCreateDraft()}
            onPublish={() => void onPublish()}
            selectedVersion={selectedVersion}
            canManage={canManage}
            isBusy={busyKey !== null}
          />

          {selectedVersion ? (
            <div className="workflow-version-grid">
              <StateSection
                disabled={isReadOnly || busyKey !== null}
                form={stateForm}
                onChange={setStateForm}
                onDelete={() => void onDeleteState()}
                onNew={() => {
                  setSelectedStateId(null);
                  setStateForm(emptyStateForm());
                }}
                onSelect={setSelectedStateId}
                onSubmit={(event) => void onSaveState(event)}
                selectedStateId={selectedStateId}
                states={selectedVersion.states}
              />
              <ActionSection
                disabled={isReadOnly || busyKey !== null}
                form={actionForm}
                onChange={setActionForm}
                onDelete={() => void onDeleteAction()}
                onNew={() => {
                  setSelectedActionId(null);
                  setActionForm(emptyActionForm(selectedVersion.states));
                }}
                onSelect={setSelectedActionId}
                onSubmit={(event) => void onSaveAction(event)}
                selectedActionId={selectedActionId}
                states={selectedVersion.states}
                actions={selectedVersion.actions}
              />
              <FieldSection
                action={selectedAction}
                disabled={isReadOnly || busyKey !== null || !selectedAction}
                form={fieldForm}
                onChange={setFieldForm}
                onDelete={() => void onDeleteField()}
                onNew={() => {
                  setSelectedFieldId(null);
                  setFieldForm(emptyFieldForm());
                }}
                onSelect={setSelectedFieldId}
                onSubmit={(event) => void onSaveField(event)}
                selectedFieldId={selectedFieldId}
              />
              <BindingSection
                bindings={selectedWorkflowBindings}
                disabled={
                  !canManage ||
                  busyKey !== null ||
                  !selectedVersion ||
                  selectedVersion.status !== "PUBLISHED"
                }
                form={bindingForm}
                onChange={setBindingForm}
                onSubmit={(event) => void onSaveBinding(event)}
                selectedVersion={selectedVersion}
              />
            </div>
          ) : null}
        </div>

        <aside className="workspace-side">
          <Panel title={t("definition.title")} description={t("definition.description")}>
            <form className="business-form" onSubmit={onSaveWorkflow}>
              <WorkflowFields
                form={workflowForm}
                onChange={setWorkflowForm}
                disabled={!canManage || !selectedWorkflow || busyKey !== null}
                includeStatus
              />
              <div className="form-actions">
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={!canManage || !selectedWorkflow || busyKey !== null}
                >
                  <Save aria-hidden="true" size={16} strokeWidth={2} />
                  {busyKey === "workflow:update"
                    ? t("actions.saving")
                    : t("actions.save")}
                </button>
              </div>
            </form>
          </Panel>

          <Panel title={t("create.title")} description={t("create.description")}>
            <form className="business-form" onSubmit={onCreateWorkflow}>
              <WorkflowFields
                form={createWorkflowForm}
                onChange={setCreateWorkflowForm}
                disabled={!canManage || busyKey !== null}
              />
              <div className="form-actions">
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={!canManage || busyKey !== null}
                >
                  <Plus aria-hidden="true" size={16} strokeWidth={2} />
                  {busyKey === "workflow:create"
                    ? t("actions.creating")
                    : t("create.submit")}
                </button>
              </div>
            </form>
          </Panel>
        </aside>
      </section>
    </main>
  );

  function NoticePanel({ notice }: { notice: Notice }) {
    return (
      <div className="form-alert" role="status">
        <CircleAlert aria-hidden="true" size={16} strokeWidth={2} />
        <div>
          <strong>
            {notice.kind === "success" ? t("notices.success") : t("notices.error")}
          </strong>
          <span>
            {notice.text ?? (notice.key ? tRoot(notice.key) : t("notices.error"))}
          </span>
          {notice.issues && notice.issues.length > 0 ? (
            <ul className="workflow-issues">
              {notice.issues.map((issue, index) => (
                <li key={`${issue.code ?? "issue"}-${index}`}>
                  <span>{issue.code ?? t("publishIssues.unknownCode")}</span>
                  <small>{issue.message ?? t("publishIssues.unknownMessage")}</small>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  }
}

function Panel({
  children,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  description?: string;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <section className="form-panel">
      <div className="form-panel__header">
        {icon ?? <span aria-hidden="true" />}
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function VersionPanel({
  actions,
  bindings,
  canManage,
  isBusy,
  isLoading,
  onCopyDraft,
  onCreateDraft,
  onPublish,
  selectedVersion,
}: {
  actions: WorkflowActionSummary[];
  bindings: WorkflowBinding[];
  canManage: boolean;
  isBusy: boolean;
  isLoading: boolean;
  onCopyDraft: () => void;
  onCreateDraft: () => void;
  onPublish: () => void;
  selectedVersion: WorkflowVersion | null;
}) {
  const t = useTranslations("workflow");
  const isDraft = selectedVersion?.status === "DRAFT";

  return (
    <Panel title={t("version.title")} description={t("version.description")}>
      {isLoading ? (
        <InlineState label={t("version.loading")} />
      ) : selectedVersion ? (
        <>
          <div className="compact-metric-grid">
            <Metric
              label={t("version.metrics.version")}
              value={String(selectedVersion.version)}
            />
            <Metric
              label={t("version.metrics.status")}
              value={t(`versionStatus.${selectedVersion.status}`)}
            />
            <Metric
              label={t("version.metrics.states")}
              value={String(selectedVersion.states.length)}
            />
            <Metric
              label={t("version.metrics.actions")}
              value={String(actions.length)}
            />
          </div>
          <div className="form-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={!canManage || !isDraft || isBusy}
              onClick={onPublish}
            >
              <Send aria-hidden="true" size={16} strokeWidth={2} />
              {isBusy ? t("actions.publishing") : t("version.publish")}
            </button>
            <button
              className="button button--secondary"
              type="button"
              disabled={!canManage || isBusy || isDraft}
              onClick={onCopyDraft}
            >
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              {t("version.copyDraft")}
            </button>
          </div>
          {selectedVersion.status === "PUBLISHED" ? (
            <p className="readonly-note">
              <CircleAlert aria-hidden="true" size={16} strokeWidth={2} />
              <span>{t("version.publishedReadonly")}</span>
            </p>
          ) : null}
          <p className="panel-footnote">
            {t("version.bindingCount", { count: bindings.length })}
          </p>
        </>
      ) : (
        <div className="empty-state">
          <strong>{t("version.empty.title")}</strong>
          <span>{t("version.empty.description")}</span>
          <div className="form-actions">
            <button
              className="button button--primary"
              type="button"
              disabled={!canManage || isBusy}
              onClick={onCreateDraft}
            >
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              {t("version.createDraft")}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="compact-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkflowFields({
  disabled,
  form,
  includeStatus = false,
  onChange,
}: {
  disabled: boolean;
  form: WorkflowForm;
  includeStatus?: boolean;
  onChange: (form: WorkflowForm) => void;
}) {
  const t = useTranslations("workflow");

  return (
    <>
      <label className="field">
        <span>{t("definition.fields.name")}</span>
        <input
          value={form.name}
          disabled={disabled}
          required
          maxLength={120}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </label>
      <label className="field">
        <span>{t("definition.fields.code")}</span>
        <input
          value={form.code}
          disabled={disabled}
          required
          maxLength={80}
          onChange={(event) => onChange({ ...form, code: event.target.value })}
        />
      </label>
      {includeStatus ? (
        <label className="field">
          <span>{t("definition.fields.status")}</span>
          <select
            value={form.status}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...form,
                status: event.target.value as WorkflowDefinitionStatus,
              })
            }
          >
            {DEFINITION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`definitionStatus.${status}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        <span>{t("definition.fields.description")}</span>
        <textarea
          value={form.description}
          disabled={disabled}
          maxLength={2000}
          onChange={(event) =>
            onChange({ ...form, description: event.target.value })
          }
        />
      </label>
    </>
  );
}

function StateSection({
  disabled,
  form,
  onChange,
  onDelete,
  onNew,
  onSelect,
  onSubmit,
  selectedStateId,
  states,
}: {
  disabled: boolean;
  form: StateForm;
  onChange: (form: StateForm) => void;
  onDelete: () => void;
  onNew: () => void;
  onSelect: (stateId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selectedStateId: string | null;
  states: WorkflowState[];
}) {
  const t = useTranslations("workflow");

  return (
    <Panel title={t("statesPanel.title")} description={t("statesPanel.description")}>
      <EntityList
        empty={t("statesPanel.empty")}
        items={states.map((state) => ({
          id: state.id,
          meta: t(`statusCategory.${state.category}`),
          title: state.name,
        }))}
        onSelect={onSelect}
        selectedId={selectedStateId}
      />
      <form className="business-form" onSubmit={onSubmit}>
        <div className="form-grid form-grid--two">
          <label className="field">
            <span>{t("statesPanel.fields.name")}</span>
            <input
              value={form.name}
              disabled={disabled}
              required
              maxLength={120}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("statesPanel.fields.code")}</span>
            <input
              value={form.code}
              disabled={disabled}
              required
              maxLength={80}
              onChange={(event) => onChange({ ...form, code: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("statesPanel.fields.category")}</span>
            <select
              value={form.category}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...form,
                  category: event.target.value as StatusCategory,
                })
              }
            >
              {STATUS_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`statusCategory.${category}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("statesPanel.fields.order")}</span>
            <input
              value={form.order}
              disabled={disabled}
              type="number"
              min={0}
              onChange={(event) => onChange({ ...form, order: event.target.value })}
            />
          </label>
        </div>
        <div className="workflow-check-grid">
          <Checkbox
            checked={form.isStart}
            disabled={disabled}
            label={t("statesPanel.fields.isStart")}
            onChange={(value) => onChange({ ...form, isStart: value })}
          />
          <Checkbox
            checked={form.isEnd}
            disabled={disabled}
            label={t("statesPanel.fields.isEnd")}
            onChange={(value) => onChange({ ...form, isEnd: value })}
          />
        </div>
        <EditorActions
          disabled={disabled}
          hasSelection={Boolean(selectedStateId)}
          onDelete={onDelete}
          onNew={onNew}
        />
      </form>
    </Panel>
  );
}

function ActionSection({
  actions,
  disabled,
  form,
  onChange,
  onDelete,
  onNew,
  onSelect,
  onSubmit,
  selectedActionId,
  states,
}: {
  actions: WorkflowActionSummary[];
  disabled: boolean;
  form: ActionForm;
  onChange: (form: ActionForm) => void;
  onDelete: () => void;
  onNew: () => void;
  onSelect: (actionId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selectedActionId: string | null;
  states: WorkflowState[];
}) {
  const t = useTranslations("workflow");
  const stateName = (stateId: string) =>
    states.find((state) => state.id === stateId)?.name ?? stateId;

  return (
    <Panel title={t("actionsPanel.title")} description={t("actionsPanel.description")}>
      <EntityList
        empty={t("actionsPanel.empty")}
        items={actions.map((action) => ({
          id: action.id,
          meta: t("actionsPanel.meta", {
            from: stateName(action.fromStateId),
            to: stateName(action.toStateId),
          }),
          title: action.name,
        }))}
        onSelect={onSelect}
        selectedId={selectedActionId}
      />
      <form className="business-form" onSubmit={onSubmit}>
        <div className="form-grid form-grid--two">
          <label className="field">
            <span>{t("actionsPanel.fields.name")}</span>
            <input
              value={form.name}
              disabled={disabled}
              required
              maxLength={120}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("actionsPanel.fields.code")}</span>
            <input
              value={form.code}
              disabled={disabled}
              required
              maxLength={80}
              onChange={(event) => onChange({ ...form, code: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("actionsPanel.fields.fromState")}</span>
            <select
              value={form.fromStateId}
              disabled={disabled || states.length === 0}
              required
              onChange={(event) =>
                onChange({ ...form, fromStateId: event.target.value })
              }
            >
              <option value="">{t("actionsPanel.fields.statePlaceholder")}</option>
              {states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("actionsPanel.fields.toState")}</span>
            <select
              value={form.toStateId}
              disabled={disabled || states.length === 0}
              required
              onChange={(event) =>
                onChange({ ...form, toStateId: event.target.value })
              }
            >
              <option value="">{t("actionsPanel.fields.statePlaceholder")}</option>
              {states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("actionsPanel.fields.order")}</span>
            <input
              value={form.order}
              disabled={disabled}
              min={0}
              type="number"
              onChange={(event) => onChange({ ...form, order: event.target.value })}
            />
          </label>
        </div>
        <Checkbox
          checked={form.requiresComment}
          disabled={disabled}
          label={t("actionsPanel.fields.requiresComment")}
          onChange={(value) => onChange({ ...form, requiresComment: value })}
        />
        <CheckGroup
          disabled={disabled}
          label={t("actionsPanel.fields.allowedRoles")}
          options={SPACE_ROLES.map((role) => ({
            label: t(`spaceRole.${role}`),
            value: role,
          }))}
          values={form.allowedSpaceRoles}
          onChange={(values) =>
            onChange({ ...form, allowedSpaceRoles: values as SpaceRole[] })
          }
        />
        <CheckGroup
          disabled={disabled}
          label={t("actionsPanel.fields.actorRelations")}
          options={ACTOR_RELATIONS.map((relation) => ({
            label: t(`actorRelation.${relation}`),
            value: relation,
          }))}
          values={form.actorRelations}
          onChange={(values) =>
            onChange({
              ...form,
              actorRelations: values as WorkflowActorRelation[],
            })
          }
        />
        <EditorActions
          disabled={disabled}
          hasSelection={Boolean(selectedActionId)}
          onDelete={onDelete}
          onNew={onNew}
        />
      </form>
    </Panel>
  );
}

function FieldSection({
  action,
  disabled,
  form,
  onChange,
  onDelete,
  onNew,
  onSelect,
  onSubmit,
  selectedFieldId,
}: {
  action: WorkflowActionSummary | null;
  disabled: boolean;
  form: FieldForm;
  onChange: (form: FieldForm) => void;
  onDelete: () => void;
  onNew: () => void;
  onSelect: (fieldId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selectedFieldId: string | null;
}) {
  const t = useTranslations("workflow");

  return (
    <Panel title={t("fieldsPanel.title")} description={t("fieldsPanel.description")}>
      <EntityList
        empty={
          action ? t("fieldsPanel.empty") : t("fieldsPanel.noActionSelected")
        }
        items={(action?.formFields ?? []).map((field) => ({
          id: field.id,
          meta: t(`fieldType.${field.fieldType}`),
          title: field.label,
        }))}
        onSelect={onSelect}
        selectedId={selectedFieldId}
      />
      <form className="business-form" onSubmit={onSubmit}>
        <div className="form-grid form-grid--two">
          <label className="field">
            <span>{t("fieldsPanel.fields.label")}</span>
            <input
              value={form.label}
              disabled={disabled}
              required
              maxLength={120}
              onChange={(event) => onChange({ ...form, label: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("fieldsPanel.fields.key")}</span>
            <input
              value={form.key}
              disabled={disabled}
              required
              maxLength={80}
              onChange={(event) => onChange({ ...form, key: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("fieldsPanel.fields.fieldType")}</span>
            <select
              value={form.fieldType}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...form,
                  fieldType: event.target.value as ActionFormFieldType,
                })
              }
            >
              {FIELD_TYPES.map((fieldType) => (
                <option key={fieldType} value={fieldType}>
                  {t(`fieldType.${fieldType}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("fieldsPanel.fields.order")}</span>
            <input
              value={form.order}
              disabled={disabled}
              min={0}
              type="number"
              onChange={(event) => onChange({ ...form, order: event.target.value })}
            />
          </label>
        </div>
        <Checkbox
          checked={form.required}
          disabled={disabled}
          label={t("fieldsPanel.fields.required")}
          onChange={(value) => onChange({ ...form, required: value })}
        />
        <label className="field">
          <span>{t("fieldsPanel.fields.options")}</span>
          <textarea
            value={form.optionsText}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...form, optionsText: event.target.value })
            }
          />
        </label>
        <EditorActions
          disabled={disabled}
          hasSelection={Boolean(selectedFieldId)}
          onDelete={onDelete}
          onNew={onNew}
        />
      </form>
    </Panel>
  );
}

function BindingSection({
  bindings,
  disabled,
  form,
  onChange,
  onSubmit,
  selectedVersion,
}: {
  bindings: WorkflowBinding[];
  disabled: boolean;
  form: BindingForm;
  onChange: (form: BindingForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selectedVersion: WorkflowVersion;
}) {
  const t = useTranslations("workflow");

  return (
    <Panel title={t("bindingsPanel.title")} description={t("bindingsPanel.description")}>
      <EntityList
        empty={t("bindingsPanel.empty")}
        items={bindings.map((binding) => ({
          id: binding.id,
          meta: binding.priority
            ? t(`priority.${binding.priority}`)
            : t("bindingsPanel.noPriority"),
          title: t(`workItemType.${binding.workItemType}`),
        }))}
        onSelect={(bindingId) => {
          const binding = bindings.find((item) => item.id === bindingId);
          if (binding) {
            onChange(bindingToForm(binding));
          }
        }}
        selectedId={form.bindingId || null}
      />
      <form className="business-form" onSubmit={onSubmit}>
        <div className="form-grid form-grid--two">
          <label className="field">
            <span>{t("bindingsPanel.fields.workItemType")}</span>
            <select
              value={form.workItemType}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...form,
                  workItemType: event.target.value as WorkItemType,
                })
              }
            >
              {WORK_ITEM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`workItemType.${type}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("bindingsPanel.fields.priority")}</span>
            <select
              value={form.priority}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...form, priority: event.target.value as Priority | "" })
              }
            >
              <option value="">{t("bindingsPanel.fields.anyPriority")}</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {t(`priority.${priority}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Checkbox
          checked={form.isDefault}
          disabled={disabled}
          label={t("bindingsPanel.fields.isDefault")}
          onChange={(value) => onChange({ ...form, isDefault: value })}
        />
        <p className="panel-footnote">
          {t("bindingsPanel.targetVersion", { version: selectedVersion.version })}
        </p>
        <div className="form-actions">
          <button className="button button--primary" type="submit" disabled={disabled}>
            <Save aria-hidden="true" size={16} strokeWidth={2} />
            {t("actions.save")}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function EntityList({
  empty,
  items,
  onSelect,
  selectedId,
}: {
  empty: string;
  items: Array<{ id: string; meta: string; title: string }>;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  if (items.length === 0) {
    return (
      <div className="empty-state empty-state--compact">
        <span>{empty}</span>
      </div>
    );
  }

  return (
    <div className="compact-list">
      {items.map((item) => (
        <button
          className={`compact-list__row${
            selectedId === item.id ? " compact-list__row--selected" : ""
          }`}
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
        >
          <span>{item.title}</span>
          <small>{item.meta}</small>
        </button>
      ))}
    </div>
  );
}

function EditorActions({
  disabled,
  hasSelection,
  onDelete,
  onNew,
}: {
  disabled: boolean;
  hasSelection: boolean;
  onDelete: () => void;
  onNew: () => void;
}) {
  const t = useTranslations("workflow");

  return (
    <div className="form-actions">
      <button className="button button--primary" type="submit" disabled={disabled}>
        <Save aria-hidden="true" size={16} strokeWidth={2} />
        {t("actions.save")}
      </button>
      <button
        className="button button--secondary"
        type="button"
        onClick={onNew}
        disabled={disabled}
      >
        <Plus aria-hidden="true" size={16} strokeWidth={2} />
        {t("actions.new")}
      </button>
      <button
        className="button button--secondary"
        type="button"
        onClick={onDelete}
        disabled={disabled || !hasSelection}
      >
        {t("actions.delete")}
      </button>
    </div>
  );
}

function Checkbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="workflow-check">
      <input
        checked={checked}
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function CheckGroup({
  disabled,
  label,
  onChange,
  options,
  values,
}: {
  disabled: boolean;
  label: string;
  onChange: (values: string[]) => void;
  options: Array<{ label: string; value: string }>;
  values: string[];
}) {
  return (
    <fieldset className="workflow-check-group">
      <legend>{label}</legend>
      <div className="workflow-check-grid">
        {options.map((option) => (
          <Checkbox
            checked={values.includes(option.value)}
            disabled={disabled}
            key={option.value}
            label={option.label}
            onChange={(checked) => {
              onChange(
                checked
                  ? [...values, option.value]
                  : values.filter((value) => value !== option.value),
              );
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function EmptyState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function InlineState({ label }: { label: string }) {
  return (
    <div className="inline-state">
      <Loader2 aria-hidden="true" size={16} strokeWidth={2} />
      <span>{label}</span>
    </div>
  );
}

function StatePanel({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <section className="state-panel" aria-live="polite">
      <div className="state-panel__icon">
        <CircleAlert aria-hidden="true" size={18} strokeWidth={2} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

function emptyWorkflowForm(): WorkflowForm {
  return {
    code: "",
    description: "",
    name: "",
    status: "DRAFT",
  };
}

function emptyStateForm(): StateForm {
  return {
    category: "NOT_STARTED",
    code: "",
    isEnd: false,
    isStart: false,
    name: "",
    order: "0",
  };
}

function emptyActionForm(states: WorkflowState[] = []): ActionForm {
  return {
    actorRelations: [],
    allowedSpaceRoles: [],
    code: "",
    fromStateId: states[0]?.id ?? "",
    name: "",
    order: "0",
    requiresComment: false,
    toStateId: states[1]?.id ?? states[0]?.id ?? "",
  };
}

function emptyFieldForm(): FieldForm {
  return {
    fieldType: "TEXT",
    key: "",
    label: "",
    optionsText: "",
    order: "0",
    required: false,
  };
}

function emptyBindingForm(): BindingForm {
  return {
    bindingId: "",
    isDefault: false,
    priority: "",
    workItemType: "TASK",
  };
}

function workflowToForm(workflow: WorkflowDefinition): WorkflowForm {
  return {
    code: workflow.code,
    description: workflow.description ?? "",
    name: workflow.name,
    status: workflow.status,
  };
}

function stateToForm(state: WorkflowState): StateForm {
  return {
    category: state.category,
    code: state.code,
    isEnd: state.isEnd,
    isStart: state.isStart,
    name: state.name,
    order: String(state.order),
  };
}

function actionToForm(action: WorkflowActionSummary): ActionForm {
  return {
    actorRelations: action.actorRelations,
    allowedSpaceRoles: action.allowedSpaceRoles,
    code: action.code,
    fromStateId: action.fromStateId,
    name: action.name,
    order: String(action.order),
    requiresComment: action.requiresComment,
    toStateId: action.toStateId,
  };
}

function fieldToForm(field: ActionFormFieldSummary): FieldForm {
  return {
    fieldType: field.fieldType,
    key: field.key,
    label: field.label,
    optionsText: (field.options ?? []).join("\n"),
    order: String(field.order),
    required: field.required,
  };
}

function bindingToForm(binding: WorkflowBinding): BindingForm {
  return {
    bindingId: binding.id,
    isDefault: binding.isDefault,
    priority: binding.priority ?? "",
    workItemType: binding.workItemType,
  };
}

function stateFormToPayload(form: StateForm) {
  return {
    category: form.category,
    code: form.code.trim(),
    isEnd: form.isEnd,
    isStart: form.isStart,
    name: form.name.trim(),
    order: numericOrder(form.order),
  };
}

function actionFormToPayload(form: ActionForm) {
  return {
    actorRelations: form.actorRelations,
    allowedSpaceRoles: form.allowedSpaceRoles,
    code: form.code.trim(),
    fromStateId: form.fromStateId,
    name: form.name.trim(),
    order: numericOrder(form.order),
    requiresComment: form.requiresComment,
    toStateId: form.toStateId,
  };
}

function fieldFormToPayload(form: FieldForm) {
  return {
    fieldType: form.fieldType,
    key: form.key.trim(),
    label: form.label.trim(),
    options: splitOptions(form.optionsText),
    order: numericOrder(form.order),
    required: form.required,
  };
}

function numericOrder(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function splitOptions(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function upsertVersionState(
  version: WorkflowVersion,
  state: WorkflowState,
): WorkflowVersion {
  return {
    ...version,
    states: upsertById(version.states, state).sort(sortByOrder),
  };
}

function removeVersionState(
  version: WorkflowVersion,
  stateId: string,
): WorkflowVersion {
  return {
    ...version,
    states: version.states.filter((state) => state.id !== stateId),
  };
}

function upsertVersionAction(
  version: WorkflowVersion,
  action: WorkflowActionSummary,
): WorkflowVersion {
  return {
    ...version,
    actions: upsertById(version.actions, action).sort(sortByOrder),
  };
}

function removeVersionAction(
  version: WorkflowVersion,
  actionId: string,
): WorkflowVersion {
  return {
    ...version,
    actions: version.actions.filter((action) => action.id !== actionId),
  };
}

function upsertActionField(
  version: WorkflowVersion,
  actionId: string,
  field: ActionFormFieldSummary,
): WorkflowVersion {
  return {
    ...version,
    actions: version.actions.map((action) =>
      action.id === actionId
        ? {
            ...action,
            formFields: upsertById(action.formFields, field).sort(sortByOrder),
          }
        : action,
    ),
  };
}

function removeActionField(
  version: WorkflowVersion,
  actionId: string,
  fieldId: string,
): WorkflowVersion {
  return {
    ...version,
    actions: version.actions.map((action) =>
      action.id === actionId
        ? {
            ...action,
            formFields: action.formFields.filter((field) => field.id !== fieldId),
          }
        : action,
    ),
  };
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  if (items.some((item) => item.id === next.id)) {
    return items.map((item) => (item.id === next.id ? next : item));
  }

  return [...items, next];
}

function sortByOrder<T extends { order: number }>(left: T, right: T): number {
  return left.order - right.order;
}

function toNotice(error: unknown): Notice {
  const issues = extractPublishIssues(error);

  return {
    issues,
    key: getApiErrorMessageKey(error),
    kind: "error",
  };
}

function extractPublishIssues(error: unknown): PublishIssue[] | undefined {
  if (!(error instanceof ApiClientError)) {
    return undefined;
  }

  const details = error.error.details;
  if (
    typeof details !== "object" ||
    details === null ||
    !Array.isArray((details as { issues?: unknown }).issues)
  ) {
    return undefined;
  }

  return (details as { issues: unknown[] }).issues
    .map((issue): PublishIssue | null => {
      if (typeof issue !== "object" || issue === null) {
        return null;
      }

      const candidate = issue as PublishIssue;
      return {
        actionId: stringOrUndefined(candidate.actionId),
        code: stringOrUndefined(candidate.code),
        message: stringOrUndefined(candidate.message),
        stateId: stringOrUndefined(candidate.stateId),
      };
    })
    .filter((issue): issue is PublishIssue => issue !== null);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
