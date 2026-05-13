"use client";

import type {
  Attachment,
  Comment,
  Priority,
  Requirement,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  StatusCategory,
  TimelineEvent,
  Version,
  ActionFormFieldSummary,
  ExecuteActionRequest,
  WorkflowActionSummary,
  WorkItem,
  WorkItemDetail,
} from "@project-delivery/shared";
import {
  CircleAlert,
  Clock3,
  FileText,
  Inbox,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createAttachmentUploadFailure,
  listAttachments,
  uploadAttachment,
  type AttachmentUploadErrorCode,
} from "../../lib/attachment-service";
import { toExecuteActionRequest } from "../../lib/action-forms";
import { executeAction } from "../../lib/action-service";
import { toCreateCommentRequest } from "../../lib/comment-forms";
import { createComment, listComments } from "../../lib/comment-service";
import {
  listRequirementAssignableMembers,
  listRequirements,
  listRequirementVersions,
} from "../../lib/requirement-service";
import { listWorkItemTimeline } from "../../lib/timeline-service";
import {
  toCreateTaskRequest,
  toUpdateTaskRequest,
} from "../../lib/work-item-forms";
import {
  createWorkItem,
  getWorkItem,
  listWorkItems,
  updateWorkItem,
} from "../../lib/work-item-service";
import { useSession } from "../providers/session-provider";
import {
  createWorkItemListCacheKey,
} from "./work-item-cache";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const STATUS_CATEGORIES: StatusCategory[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
];

type WorkItemWorkspaceProps = {
  initialAssigneeId?: string;
  initialPriority?: Priority;
  initialRequirementId?: string;
  initialStatusCategory?: StatusCategory;
  initialVersionId?: string;
  initialWorkItemId?: string;
  spaceId: string;
};

type TaskFormState = {
  assigneeId: string;
  blockedReason: string;
  description: string;
  dueDate: string;
  priority: Priority;
  requirementId: string;
  title: string;
  versionId: string;
};

type UploadItem = {
  errorCode?: AttachmentUploadErrorCode;
  file: File;
  id: string;
  retryable: boolean;
  status: "failed" | "uploading";
};

type ActionFormState = {
  comment: string;
  formValues: Record<string, string>;
};

export function WorkItemWorkspace({
  initialAssigneeId,
  initialPriority,
  initialRequirementId,
  initialStatusCategory,
  initialVersionId,
  initialWorkItemId,
  spaceId,
}: WorkItemWorkspaceProps) {
  const t = useTranslations("workItems");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { session, status } = useSession();
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [versionFilter, setVersionFilter] = useState(initialVersionId ?? "");
  const [requirementFilter, setRequirementFilter] = useState(
    initialRequirementId ?? "",
  );
  const [assigneeFilter, setAssigneeFilter] = useState(initialAssigneeId ?? "");
  const [statusCategoryFilter, setStatusCategoryFilter] = useState<
    StatusCategory | "ALL"
  >(initialStatusCategory ?? "ALL");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "ALL">(
    initialPriority ?? "ALL",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [detailErrorKey, setDetailErrorKey] = useState<string | null>(null);
  const [resourceErrorKey, setResourceErrorKey] = useState<string | null>(null);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(
    null,
  );
  const [selectedDetail, setSelectedDetail] = useState<WorkItemDetail | null>(
    null,
  );
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [areResourcesLoading, setAreResourcesLoading] = useState(false);
  const [createForm, setCreateForm] = useState<TaskFormState>(
    createEmptyTaskForm(),
  );
  const [editForm, setEditForm] = useState<TaskFormState>(
    createEmptyTaskForm(),
  );
  const [commentBody, setCommentBody] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [actionForm, setActionForm] = useState<ActionFormState>(
    createEmptyActionForm(),
  );
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null);
  const [actionValidationErrorKey, setActionValidationErrorKey] = useState<
    string | null
  >(null);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const detailRequestTokenRef = useRef(0);
  const initialWorkItemOpenedRef = useRef(false);

  const currentSpace = useMemo(
    () => session?.spaces.find((space) => space.id === spaceId),
    [session, spaceId],
  );
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;
  const canCreateWorkItem =
    currentSpace !== undefined && currentSpace.role !== "VIEWER";
  const listCacheKey = useMemo(
    () =>
      createWorkItemListCacheKey({
        assigneeId: assigneeFilter,
        priority: priorityFilter,
        requirementId: requirementFilter,
        spaceId,
        statusCategory: statusCategoryFilter,
        versionId: versionFilter,
      }),
    [
      assigneeFilter,
      priorityFilter,
      requirementFilter,
      spaceId,
      statusCategoryFilter,
      versionFilter,
    ],
  );
  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let isActive = true;

    async function load() {
      setIsLoading(true);
      setErrorKey(null);

      try {
        const [workItemPage, versionPage, requirementPage, memberPage] =
          await Promise.all([
            listWorkItems({
              assigneeId: assigneeFilter || undefined,
              organizationId,
              page: 1,
              pageSize: 100,
              priority: priorityFilter === "ALL" ? undefined : priorityFilter,
              requirementId: requirementFilter || undefined,
              spaceId,
              statusCategory:
                statusCategoryFilter === "ALL"
                  ? undefined
                  : statusCategoryFilter,
              versionId: versionFilter || undefined,
            }),
            listRequirementVersions({
              organizationId,
              spaceId,
            }),
            listRequirements({
              includeDrafts: false,
              organizationId,
              page: 1,
              pageSize: 100,
              spaceId,
            }),
            listRequirementAssignableMembers({
              organizationId,
              spaceId,
            }),
          ]);

        if (!isActive) {
          return;
        }

        setWorkItems(workItemPage.items);
        setVersions(versionPage.items);
        setRequirements(requirementPage.items);
        setMembers(memberPage.items);
      } catch (error) {
        if (isActive) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isActive = false;
    };
  }, [
    assigneeFilter,
    listCacheKey,
    organizationId,
    priorityFilter,
    requirementFilter,
    spaceId,
    status,
    statusCategoryFilter,
    versionFilter,
  ]);

  useEffect(() => {
    if (!selectedDetail) {
      setEditForm(createEmptyTaskForm());
      setSelectedActionId(null);
      setActionForm(createEmptyActionForm());
      setActionErrorKey(null);
      setActionValidationErrorKey(null);
      return;
    }

    setEditForm(workItemToFormState(selectedDetail));
  }, [selectedDetail]);

  useEffect(() => {
    if (
      initialWorkItemOpenedRef.current ||
      status !== "authenticated" ||
      !initialWorkItemId
    ) {
      return;
    }

    initialWorkItemOpenedRef.current = true;
    void openWorkItem(initialWorkItemId);
  }, [initialWorkItemId, status]);

  const selectedAction = useMemo(
    () =>
      selectedDetail?.permissions.availableActions.find(
        (action) => action.id === selectedActionId,
      ) ?? null,
    [selectedActionId, selectedDetail],
  );

  async function refreshWorkItems() {
    if (status !== "authenticated") {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const workItemPage = await listWorkItems({
        assigneeId: assigneeFilter || undefined,
        organizationId,
        page: 1,
        pageSize: 100,
        priority: priorityFilter === "ALL" ? undefined : priorityFilter,
        requirementId: requirementFilter || undefined,
        spaceId,
        statusCategory:
          statusCategoryFilter === "ALL" ? undefined : statusCategoryFilter,
        versionId: versionFilter || undefined,
      });

      setWorkItems(workItemPage.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function openWorkItem(workItemId: string) {
    const token = detailRequestTokenRef.current + 1;
    detailRequestTokenRef.current = token;
    setSelectedWorkItemId(workItemId);
    setSelectedDetail(null);
    setComments([]);
    setAttachments([]);
    setTimeline([]);
    setUploads([]);
    setSelectedActionId(null);
    setActionForm(createEmptyActionForm());
    setActionErrorKey(null);
    setActionValidationErrorKey(null);
    setDetailErrorKey(null);
    setResourceErrorKey(null);
    setIsDetailLoading(true);

    try {
      const detail = await getWorkItem({
        organizationId,
        spaceId,
        workItemId,
      });

      if (detailRequestTokenRef.current !== token) {
        return;
      }

      setSelectedDetail(detail);
      await loadWorkItemResources(workItemId, token);
    } catch (error) {
      if (detailRequestTokenRef.current === token) {
        setDetailErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (detailRequestTokenRef.current === token) {
        setIsDetailLoading(false);
      }
    }
  }

  async function loadWorkItemResources(workItemId: string, token?: number) {
    const requestToken = token ?? detailRequestTokenRef.current;
    setAreResourcesLoading(true);
    setResourceErrorKey(null);

    try {
      const [commentPage, attachmentPage, timelinePage] = await Promise.all([
        listComments({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          targetId: workItemId,
          targetType: "WORK_ITEM",
        }),
        listAttachments({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          targetId: workItemId,
          targetType: "WORK_ITEM",
        }),
        listWorkItemTimeline({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          workItemId,
        }),
      ]);

      if (detailRequestTokenRef.current !== requestToken) {
        return;
      }

      setComments(commentPage.items);
      setAttachments(attachmentPage.items);
      setTimeline(timelinePage.items);
    } catch (error) {
      if (detailRequestTokenRef.current === requestToken) {
        setResourceErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (detailRequestTokenRef.current === requestToken) {
        setAreResourcesLoading(false);
      }
    }
  }

  function closeDrawer() {
    detailRequestTokenRef.current += 1;
    setSelectedWorkItemId(null);
    setSelectedDetail(null);
    setComments([]);
    setAttachments([]);
    setTimeline([]);
    setUploads([]);
    setSelectedActionId(null);
    setActionForm(createEmptyActionForm());
    setActionErrorKey(null);
    setActionValidationErrorKey(null);
    setDetailErrorKey(null);
    setResourceErrorKey(null);
    setIsDetailLoading(false);
    setAreResourcesLoading(false);
  }

  async function onCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canCreateWorkItem) {
      return;
    }

    setIsSubmittingCreate(true);
    setErrorKey(null);

    try {
      const created = await createWorkItem(
        {
          organizationId,
          spaceId,
        },
        toCreateTaskRequest({
          assigneeId: createForm.assigneeId,
          description: createForm.description,
          dueDate: toIsoDateTime(createForm.dueDate),
          priority: createForm.priority,
          requirementId: createForm.requirementId,
          title: createForm.title,
          type: "TASK",
          versionId: createForm.versionId,
        }),
      );
      setWorkItems((current) => [created, ...current]);
      setCreateForm(createEmptyTaskForm());
      await openWorkItem(created.id);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingCreate(false);
    }
  }

  async function onEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDetail?.permissions.canEdit) {
      return;
    }

    setIsSubmittingEdit(true);
    setDetailErrorKey(null);

    try {
      const updated = await updateWorkItem(
        {
          organizationId,
          spaceId,
          workItemId: selectedDetail.id,
        },
        toUpdateTaskRequest({
          assigneeId: editForm.assigneeId,
          blockedReason: editForm.blockedReason,
          description: editForm.description,
          dueDate: toIsoDateTime(editForm.dueDate),
          priority: editForm.priority,
          requirementId: editForm.requirementId,
          title: editForm.title,
          versionId: editForm.versionId,
        }),
      );

      setWorkItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedDetail((current) =>
        current?.id === updated.id
          ? {
              ...current,
              ...updated,
              permissions: current.permissions,
            }
          : current,
      );
    } catch (error) {
      setDetailErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  async function onCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDetail?.permissions.canComment) {
      return;
    }

    setIsSubmittingComment(true);
    setResourceErrorKey(null);

    try {
      const created = await createComment({
        organizationId,
        spaceId,
        ...toCreateCommentRequest({
          body: commentBody,
          targetId: selectedDetail.id,
          targetType: "WORK_ITEM",
        }),
      });
      setComments((current) => [created, ...current]);
      setCommentBody("");
      await loadWorkItemResources(selectedDetail.id);
    } catch (error) {
      setResourceErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingComment(false);
    }
  }

  function openActionForm(action: WorkflowActionSummary) {
    setSelectedActionId(action.id);
    setActionForm(createEmptyActionForm(action.formFields));
    setActionErrorKey(null);
    setActionValidationErrorKey(null);
  }

  async function onActionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDetail || !selectedAction) {
      return;
    }

    const parsed = toActionRequestOrError(selectedAction, actionForm);

    if (!parsed.ok) {
      setActionValidationErrorKey(parsed.errorKey);
      setActionErrorKey(null);
      return;
    }

    setIsExecutingAction(true);
    setActionErrorKey(null);
    setActionValidationErrorKey(null);

    try {
      const updated = await executeAction(
        {
          actionId: selectedAction.id,
          organizationId,
          spaceId,
          workItemId: selectedDetail.id,
        },
        parsed.request,
      );

      setSelectedDetail(updated);
      setWorkItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedActionId(null);
      setActionForm(createEmptyActionForm());
      await Promise.all([loadWorkItemResources(updated.id), refreshWorkItems()]);
    } catch (error) {
      setActionErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsExecutingAction(false);
    }
  }

  async function uploadFiles(files: File[]) {
    if (!selectedDetail?.permissions.canUploadAttachment) {
      return;
    }

    let nextAttachmentCount = attachments.length;

    for (const file of files) {
      const item = createUploadingItem(file);
      setUploads((current) => [...current, item]);

      try {
        const result = await uploadAttachment({
          existingAttachmentCount: nextAttachmentCount,
          file,
          targetId: selectedDetail.id,
          targetType: "WORK_ITEM",
        });
        nextAttachmentCount += 1;
        setAttachments((current) => [result.attachment, ...current]);
        setUploads((current) =>
          current.filter((upload) => upload.id !== item.id),
        );
        await loadWorkItemResources(selectedDetail.id);
      } catch (error) {
        const failure = createAttachmentUploadFailure(file, error);
        setUploads((current) =>
          current.map((upload) =>
            upload.id === item.id
              ? {
                  ...upload,
                  errorCode: failure.code,
                  retryable: failure.retryable,
                  status: "failed",
                }
              : upload,
          ),
        );
      }
    }
  }

  async function retryUpload(item: UploadItem) {
    if (!selectedDetail?.permissions.canUploadAttachment) {
      return;
    }

    setUploads((current) =>
      current.map((upload) =>
        upload.id === item.id
          ? {
              ...upload,
              errorCode: undefined,
              retryable: false,
              status: "uploading",
            }
          : upload,
      ),
    );

    try {
      const result = await uploadAttachment({
        existingAttachmentCount: attachments.length,
        file: item.file,
        targetId: selectedDetail.id,
        targetType: "WORK_ITEM",
      });
      setAttachments((current) => [result.attachment, ...current]);
      setUploads((current) =>
        current.filter((upload) => upload.id !== item.id),
      );
      await loadWorkItemResources(selectedDetail.id);
    } catch (error) {
      const failure = createAttachmentUploadFailure(item.file, error);
      setUploads((current) =>
        current.map((upload) =>
          upload.id === item.id
            ? {
                ...upload,
                errorCode: failure.code,
                retryable: failure.retryable,
                status: "failed",
              }
            : upload,
        ),
      );
    }
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length > 0) {
      void uploadFiles(files);
    }
  }

  if (status === "loading") {
    return (
      <StatePanel
        icon="loading"
        title={t("states.loading.title")}
        description={t("states.loading.description")}
      />
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.unauthenticated.title")}
        description={t("states.unauthenticated.description")}
      />
    );
  }

  if (!currentSpace) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.noSpace.title")}
        description={t("states.noSpace.description")}
      />
    );
  }

  return (
    <div className="workbench-page">
      <section className="page-heading" aria-labelledby="work-items-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="work-items-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{formatSpaceScope(currentSpace, t("page.unknownSpace"))}</span>
          <button
            className="button button--secondary"
            disabled={isLoading}
            onClick={() => void refreshWorkItems()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            {t("actions.refresh")}
          </button>
        </div>
      </section>

      {errorKey ? <div className="form-alert">{tRoot(errorKey)}</div> : null}

      <section className="toolbar-panel work-item-toolbar" aria-label={t("filters.label")}>
        <label className="field">
          <span>{t("filters.version")}</span>
          <select
            onChange={(event) => {
              setVersionFilter(event.target.value);
              setRequirementFilter("");
            }}
            value={versionFilter}
          >
            <option value="">{t("filters.allVersions")}</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("filters.requirement")}</span>
          <select
            onChange={(event) => setRequirementFilter(event.target.value)}
            value={requirementFilter}
          >
            <option value="">{t("filters.allRequirements")}</option>
            {requirements
              .filter(
                (requirement) =>
                  !versionFilter || requirement.versionId === versionFilter,
              )
              .map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.title || t("list.untitledRequirement")}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>{t("filters.assignee")}</span>
          <select
            onChange={(event) => setAssigneeFilter(event.target.value)}
            value={assigneeFilter}
          >
            <option value="">{t("filters.allAssignees")}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {formatMember(member)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("filters.statusCategory")}</span>
          <select
            onChange={(event) =>
              setStatusCategoryFilter(event.target.value as StatusCategory | "ALL")
            }
            value={statusCategoryFilter}
          >
            <option value="ALL">{t("filters.allStatusCategories")}</option>
            {STATUS_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {t(`statusCategory.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("filters.priority")}</span>
          <select
            onChange={(event) =>
              setPriorityFilter(event.target.value as Priority | "ALL")
            }
            value={priorityFilter}
          >
            <option value="ALL">{t("filters.allPriorities")}</option>
            {PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {t(`priority.${item}`)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="work-item-layout">
        <section className="panel panel--wide" aria-labelledby="work-item-list-title">
          <div className="panel__header">
            <div>
              <h3 id="work-item-list-title">{t("list.title")}</h3>
              <p>{t("list.subtitle", { count: workItems.length })}</p>
            </div>
          </div>
          {isLoading ? (
            <InlineState label={t("states.loadingList")} />
          ) : workItems.length === 0 ? (
            <EmptyState
              title={t("states.empty.title")}
              description={t("states.empty.description")}
            />
          ) : (
            <div
              className="business-table work-item-table"
              role="table"
              aria-label={t("list.title")}
            >
              <div className="business-table__row business-table__row--head" role="row">
                <span role="columnheader">{t("list.columns.title")}</span>
                <span role="columnheader">{t("list.columns.version")}</span>
                <span role="columnheader">{t("list.columns.requirement")}</span>
                <span role="columnheader">{t("list.columns.assignee")}</span>
                <span role="columnheader">{t("list.columns.priority")}</span>
                <span role="columnheader">{t("list.columns.statusCategory")}</span>
                <span role="columnheader">{t("list.columns.dueDate")}</span>
              </div>
              {workItems.map((item) => (
                <button
                  className="business-table__row business-table__row--link work-item-table__row"
                  key={item.id}
                  onClick={() => void openWorkItem(item.id)}
                  role="row"
                  type="button"
                >
                  <span role="cell">
                    <strong>{item.title}</strong>
                    <small>{t("list.itemId", { id: item.id })}</small>
                  </span>
                  <span role="cell">
                    {formatVersionName(item.versionId, versions) ??
                      t("list.noVersion")}
                  </span>
                  <span role="cell">
                    {formatRequirementName(item.requirementId, requirements) ??
                      t("list.noRequirement")}
                  </span>
                  <span role="cell">
                    {formatMemberName(item.assigneeId, members) ??
                      t("list.unassigned")}
                  </span>
                  <span role="cell">{t(`priority.${item.priority}`)}</span>
                  <span role="cell">
                    <span className="status-pill status-pill--neutral">
                      {t(`statusCategory.${item.statusCategory}`)}
                    </span>
                  </span>
                  <span role="cell">
                    {formatDateTime(item.dueDate, locale) ?? t("list.noDueDate")}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="panel-footnote">
            <Clock3 aria-hidden="true" size={15} strokeWidth={2} />
            <span>{t("list.updated", { date: formatNow(locale) })}</span>
          </div>
        </section>

        {canCreateWorkItem ? (
          <section className="form-panel" aria-labelledby="work-item-create-title">
            <div className="form-panel__header">
              <Plus aria-hidden="true" size={20} strokeWidth={2} />
              <div>
                <h3 id="work-item-create-title">{t("create.title")}</h3>
                <p>{t("create.description")}</p>
              </div>
            </div>
            <TaskForm
              canSubmit={canCreateWorkItem}
              form={createForm}
              members={members}
              mode="create"
              onChange={setCreateForm}
              onSubmit={onCreateSubmit}
              requirements={requirements}
              submitIcon={<Plus aria-hidden="true" size={16} strokeWidth={2} />}
              submitLabel={
                isSubmittingCreate
                  ? t("create.submitting")
                  : t("create.submit")
              }
              t={t}
              versions={versions}
            />
          </section>
        ) : (
          <section className="readonly-note" aria-label={t("permissions.readonlyTitle")}>
            <CircleAlert aria-hidden="true" size={16} strokeWidth={2} />
            <span>{t("permissions.viewerCreateHidden")}</span>
          </section>
        )}
      </div>

      {selectedWorkItemId ? (
        <WorkItemDrawer
          areResourcesLoading={areResourcesLoading}
          actionErrorKey={actionErrorKey}
          actionForm={actionForm}
          actionValidationErrorKey={actionValidationErrorKey}
          attachments={attachments}
          comments={comments}
          detail={selectedDetail}
          detailErrorKey={detailErrorKey}
          editForm={editForm}
          isDetailLoading={isDetailLoading}
          isExecutingAction={isExecutingAction}
          isSubmittingComment={isSubmittingComment}
          isSubmittingEdit={isSubmittingEdit}
          locale={locale}
          members={members}
          onActionFormChange={setActionForm}
          onActionOpen={openActionForm}
          onActionSubmit={onActionSubmit}
          onClose={closeDrawer}
          onCommentBodyChange={setCommentBody}
          onCommentSubmit={onCommentSubmit}
          onEditFormChange={setEditForm}
          onEditSubmit={onEditSubmit}
          onFileInputChange={onFileInputChange}
          onRefreshResources={() =>
            selectedWorkItemId ? void loadWorkItemResources(selectedWorkItemId) : undefined
          }
          onRetryUpload={retryUpload}
          resourceErrorKey={resourceErrorKey}
          commentBody={commentBody}
          requirements={requirements}
          selectedAction={selectedAction}
          t={t}
          tRoot={tRoot}
          timeline={timeline}
          uploads={uploads}
          versions={versions}
        />
      ) : null}
    </div>
  );
}

type WorkItemDrawerProps = {
  areResourcesLoading: boolean;
  actionErrorKey: string | null;
  actionForm: ActionFormState;
  actionValidationErrorKey: string | null;
  attachments: Attachment[];
  commentBody: string;
  comments: Comment[];
  detail: WorkItemDetail | null;
  detailErrorKey: string | null;
  editForm: TaskFormState;
  isExecutingAction: boolean;
  isDetailLoading: boolean;
  isSubmittingComment: boolean;
  isSubmittingEdit: boolean;
  locale: string;
  members: SpaceMemberWithUser[];
  onActionFormChange: (form: ActionFormState) => void;
  onActionOpen: (action: WorkflowActionSummary) => void;
  onActionSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onCommentBodyChange: (value: string) => void;
  onCommentSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEditFormChange: (form: TaskFormState) => void;
  onEditSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRefreshResources: () => void;
  onRetryUpload: (item: UploadItem) => Promise<void>;
  resourceErrorKey: string | null;
  requirements: Requirement[];
  selectedAction: WorkflowActionSummary | null;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
  timeline: TimelineEvent[];
  uploads: UploadItem[];
  versions: Version[];
};

function WorkItemDrawer({
  areResourcesLoading,
  actionErrorKey,
  actionForm,
  actionValidationErrorKey,
  attachments,
  commentBody,
  comments,
  detail,
  detailErrorKey,
  editForm,
  isExecutingAction,
  isDetailLoading,
  isSubmittingComment,
  isSubmittingEdit,
  locale,
  members,
  onActionFormChange,
  onActionOpen,
  onActionSubmit,
  onClose,
  onCommentBodyChange,
  onCommentSubmit,
  onEditFormChange,
  onEditSubmit,
  onFileInputChange,
  onRefreshResources,
  onRetryUpload,
  resourceErrorKey,
  requirements,
  selectedAction,
  t,
  tRoot,
  timeline,
  uploads,
  versions,
}: WorkItemDrawerProps) {
  const canEdit = detail?.permissions.canEdit === true;
  const canComment = detail?.permissions.canComment === true;
  const canUploadAttachment = detail?.permissions.canUploadAttachment === true;

  return (
    <div className="work-item-drawer" role="dialog" aria-modal="true" aria-labelledby="work-item-drawer-title">
      <div className="work-item-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <aside className="work-item-drawer__panel">
        <header className="work-item-drawer__header">
          <div>
            <p className="page-heading__eyebrow">{t("detail.eyebrow")}</p>
            <h3 id="work-item-drawer-title">
              {detail?.title ?? t("detail.loadingTitle")}
            </h3>
          </div>
          <button
            aria-label={t("actions.close")}
            className="icon-button"
            onClick={onClose}
            title={t("actions.close")}
            type="button"
          >
            <X aria-hidden="true" size={17} strokeWidth={2} />
          </button>
        </header>

        {detailErrorKey ? (
          <div className="form-alert">{tRoot(detailErrorKey)}</div>
        ) : null}

        {isDetailLoading ? (
          <InlineState label={t("states.loadingDetail")} />
        ) : detail ? (
          <div className="work-item-drawer__body">
            <section className="subsection" aria-labelledby="work-item-meta-title">
              <div className="subsection__header">
                <Inbox aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="work-item-meta-title">{t("detail.metaTitle")}</h4>
              </div>
              <dl className="definition-list">
                <DefinitionRow label={t("detail.fields.itemId")}>
                  {detail.id}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.currentState")}>
                  {detail.currentStateId}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.statusCategory")}>
                  <span className="status-pill status-pill--neutral">
                    {t(`statusCategory.${detail.statusCategory}`)}
                  </span>
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.priority")}>
                  {t(`priority.${detail.priority}`)}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.assignee")}>
                  {formatMemberName(detail.assigneeId, members) ??
                    t("list.unassigned")}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.reporter")}>
                  {formatMemberName(detail.reporterId, members) ?? detail.reporterId}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.dueDate")}>
                  {formatDateTime(detail.dueDate, locale) ?? t("list.noDueDate")}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.lastStatusChangedAt")}>
                  {formatDateTime(detail.lastStatusChangedAt, locale)}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.lastActionAt")}>
                  {formatDateTime(detail.lastActionAt, locale) ??
                    t("detail.fields.noLastActionAt")}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.blockedReason")}>
                  {detail.blockedReason ?? t("detail.fields.noBlockedReason")}
                </DefinitionRow>
              </dl>
            </section>

            <section className="subsection" aria-labelledby="work-item-trace-title">
              <div className="subsection__header">
                <Link2 aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="work-item-trace-title">{t("trace.title")}</h4>
              </div>
              <div className="compact-list">
                <TraceRow
                  href={
                    detail.versionId
                      ? `/spaces/${detail.spaceId}/versions`
                      : undefined
                  }
                  label={t("trace.version")}
                  value={
                    formatVersionName(detail.versionId, versions) ??
                    t("trace.noVersion")
                  }
                />
                <TraceRow
                  href={
                    detail.requirementId
                      ? `/requirements/${detail.requirementId}`
                      : undefined
                  }
                  label={t("trace.requirement")}
                  value={
                    formatRequirementName(detail.requirementId, requirements) ??
                    t("trace.noRequirement")
                  }
                />
                <TraceRow
                  label={t("trace.intakeItem")}
                  value={detail.intakeItemId ?? t("trace.noIntakeItem")}
                />
              </div>
            </section>

            <section className="subsection" aria-labelledby="work-item-actions-title">
              <div className="subsection__header">
                <Send aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="work-item-actions-title">{t("workflowActions.title")}</h4>
              </div>
              <ActionExecutionPanel
                actionErrorKey={actionErrorKey}
                actionForm={actionForm}
                actionValidationErrorKey={actionValidationErrorKey}
                actions={detail.permissions.availableActions}
                isExecutingAction={isExecutingAction}
                members={members}
                onActionFormChange={onActionFormChange}
                onActionOpen={onActionOpen}
                onActionSubmit={onActionSubmit}
                selectedAction={selectedAction}
                t={t}
                tRoot={tRoot}
              />
            </section>

            <section className="subsection" aria-labelledby="work-item-edit-title">
              <div className="subsection__header">
                <Pencil aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="work-item-edit-title">{t("edit.title")}</h4>
              </div>
              {canEdit ? (
                <TaskForm
                  canSubmit={canEdit}
                  form={editForm}
                  members={members}
                  mode="edit"
                  onChange={onEditFormChange}
                  onSubmit={onEditSubmit}
                  requirements={requirements}
                  submitIcon={<Save aria-hidden="true" size={16} strokeWidth={2} />}
                  submitLabel={
                    isSubmittingEdit ? t("edit.submitting") : t("edit.submit")
                  }
                  t={t}
                  versions={versions}
                />
              ) : (
                <div className="readonly-note">
                  <CircleAlert aria-hidden="true" size={16} strokeWidth={2} />
                  <span>{t("permissions.detailReadonly")}</span>
                </div>
              )}
            </section>

            <section className="subsection" aria-labelledby="work-item-comments-title">
              <div className="subsection__header">
                <MessageSquare aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="work-item-comments-title">{t("comments.title")}</h4>
              </div>
              {canComment ? (
                <form className="business-form" onSubmit={onCommentSubmit}>
                  <label className="field">
                    <span>{t("comments.body")}</span>
                    <textarea
                      maxLength={8000}
                      onChange={(event) =>
                        onCommentBodyChange(event.target.value)
                      }
                      required
                      rows={3}
                      value={commentBody}
                    />
                  </label>
                  <div className="form-actions">
                    <button
                      className="button button--primary"
                      disabled={isSubmittingComment}
                      type="submit"
                    >
                      <MessageSquare aria-hidden="true" size={16} strokeWidth={2} />
                      {isSubmittingComment
                        ? t("comments.submitting")
                        : t("comments.submit")}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="muted-text">{t("permissions.commentReadonly")}</p>
              )}
              <CommentList comments={comments} locale={locale} t={t} />
            </section>

            <section className="subsection" aria-labelledby="work-item-attachments-title">
              <div className="subsection__header">
                <Paperclip aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="work-item-attachments-title">{t("attachments.title")}</h4>
              </div>
              {canUploadAttachment ? (
                <div className="attachment-uploader">
                  <label className="button button--secondary" htmlFor="work-item-attachment-input">
                    <Upload aria-hidden="true" size={16} strokeWidth={2} />
                    {t("attachments.upload")}
                  </label>
                  <input
                    aria-label={t("attachments.uploadInput")}
                    className="sr-only"
                    id="work-item-attachment-input"
                    multiple
                    onChange={onFileInputChange}
                    type="file"
                  />
                </div>
              ) : (
                <p className="muted-text">{t("permissions.attachmentReadonly")}</p>
              )}
              <UploadStatusList
                onRetryUpload={onRetryUpload}
                t={t}
                uploads={uploads}
              />
              <AttachmentList attachments={attachments} locale={locale} t={t} />
            </section>

            <section className="subsection" aria-labelledby="work-item-timeline-title">
              <div className="subsection__header">
                <Clock3 aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="work-item-timeline-title">{t("timeline.title")}</h4>
              </div>
              <div className="timeline-toolbar">
                <button
                  className="button button--secondary"
                  disabled={areResourcesLoading}
                  onClick={onRefreshResources}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
                  {t("actions.refresh")}
                </button>
              </div>
              {resourceErrorKey ? (
                <div className="form-alert">{tRoot(resourceErrorKey)}</div>
              ) : null}
              {areResourcesLoading ? (
                <InlineState label={t("states.loadingResources")} />
              ) : (
                <TimelineList locale={locale} t={t} timeline={timeline} />
              )}
            </section>
          </div>
        ) : (
          <EmptyState
            title={t("states.noSelection.title")}
            description={t("states.noSelection.description")}
          />
        )}
      </aside>
    </div>
  );
}

type TaskFormProps = {
  canSubmit: boolean;
  form: TaskFormState;
  members: SpaceMemberWithUser[];
  mode: "create" | "edit";
  onChange: (form: TaskFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  requirements: Requirement[];
  submitIcon: ReactNode;
  submitLabel: string;
  t: ReturnType<typeof useTranslations>;
  versions: Version[];
};

function TaskForm({
  canSubmit,
  form,
  members,
  mode,
  onChange,
  onSubmit,
  requirements,
  submitIcon,
  submitLabel,
  t,
  versions,
}: TaskFormProps) {
  return (
    <form className="business-form" onSubmit={onSubmit}>
      <label className="field">
        <span>{t("form.title")}</span>
        <input
          maxLength={200}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
          required
          value={form.title}
        />
      </label>
      <label className="field">
        <span>{t("form.description")}</span>
        <textarea
          maxLength={8000}
          onChange={(event) =>
            onChange({ ...form, description: event.target.value })
          }
          rows={4}
          value={form.description}
        />
      </label>
      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{t("form.version")}</span>
          <select
            onChange={(event) =>
              onChange({
                ...form,
                requirementId: "",
                versionId: event.target.value,
              })
            }
            value={form.versionId}
          >
            <option value="">{t("form.noVersion")}</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("form.requirement")}</span>
          <select
            onChange={(event) =>
              onChange({ ...form, requirementId: event.target.value })
            }
            value={form.requirementId}
          >
            <option value="">{t("form.noRequirement")}</option>
            {requirements
              .filter(
                (requirement) =>
                  !form.versionId || requirement.versionId === form.versionId,
              )
              .map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.title || t("list.untitledRequirement")}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>{t("form.assignee")}</span>
          <select
            onChange={(event) =>
              onChange({ ...form, assigneeId: event.target.value })
            }
            value={form.assigneeId}
          >
            <option value="">{t("form.unassigned")}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {formatMember(member)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("form.priority")}</span>
          <select
            onChange={(event) =>
              onChange({ ...form, priority: event.target.value as Priority })
            }
            value={form.priority}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`priority.${priority}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("form.dueDate")}</span>
          <input
            onChange={(event) =>
              onChange({ ...form, dueDate: event.target.value })
            }
            type="datetime-local"
            value={form.dueDate}
          />
        </label>
        {mode === "edit" ? (
          <label className="field">
            <span>{t("form.blockedReason")}</span>
            <input
              maxLength={1000}
              onChange={(event) =>
                onChange({ ...form, blockedReason: event.target.value })
              }
              value={form.blockedReason}
            />
          </label>
        ) : null}
      </div>
      <div className="form-actions">
        <button className="button button--primary" disabled={!canSubmit} type="submit">
          {submitIcon}
          {submitLabel}
        </button>
        {!canSubmit ? (
          <span className="form-actions__hint">{t("form.readonly")}</span>
        ) : null}
      </div>
    </form>
  );
}

function ActionExecutionPanel({
  actionErrorKey,
  actionForm,
  actionValidationErrorKey,
  actions,
  isExecutingAction,
  members,
  onActionFormChange,
  onActionOpen,
  onActionSubmit,
  selectedAction,
  t,
  tRoot,
}: {
  actionErrorKey: string | null;
  actionForm: ActionFormState;
  actionValidationErrorKey: string | null;
  actions: WorkflowActionSummary[];
  isExecutingAction: boolean;
  members: SpaceMemberWithUser[];
  onActionFormChange: (form: ActionFormState) => void;
  onActionOpen: (action: WorkflowActionSummary) => void;
  onActionSubmit: (event: FormEvent<HTMLFormElement>) => void;
  selectedAction: WorkflowActionSummary | null;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const sortedActions = [...actions].sort((a, b) => a.order - b.order);

  if (sortedActions.length === 0) {
    return (
      <EmptyState
        title={t("workflowActions.empty.title")}
        description={t("workflowActions.empty.description")}
      />
    );
  }

  return (
    <div className="workflow-action-panel">
      <div className="workflow-action-row">
        {sortedActions.map((action) => (
          <button
            className="button button--secondary"
            disabled={isExecutingAction}
            key={action.id}
            onClick={() => onActionOpen(action)}
            type="button"
          >
            <Send aria-hidden="true" size={16} strokeWidth={2} />
            {action.name}
          </button>
        ))}
      </div>

      {selectedAction ? (
        <form
          className="business-form workflow-action-form"
          noValidate
          onSubmit={onActionSubmit}
        >
          <div className="workflow-action-form__heading">
            <strong>{selectedAction.name}</strong>
            <span>{t("workflowActions.formHelp")}</span>
          </div>
          {selectedAction.requiresComment ? (
            <label className="field">
              <span>{t("workflowActions.comment")}</span>
              <textarea
                maxLength={4000}
                onChange={(event) =>
                  onActionFormChange({
                    ...actionForm,
                    comment: event.target.value,
                  })
                }
                required
                rows={3}
                value={actionForm.comment}
              />
            </label>
          ) : null}
          {selectedAction.formFields.map((field) => (
            <ActionField
              field={field}
              form={actionForm}
              key={field.id}
              members={members}
              onChange={onActionFormChange}
              t={t}
            />
          ))}
          {actionValidationErrorKey ? (
            <div className="form-alert">{t(actionValidationErrorKey)}</div>
          ) : null}
          {actionErrorKey ? (
            <div className="form-alert">{tRoot(actionErrorKey)}</div>
          ) : null}
          <div className="form-actions">
            <button
              className="button button--primary"
              disabled={isExecutingAction}
              type="submit"
            >
              <Send aria-hidden="true" size={16} strokeWidth={2} />
              {isExecutingAction
                ? t("workflowActions.submitting")
                : t("workflowActions.submit")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ActionField({
  field,
  form,
  members,
  onChange,
  t,
}: {
  field: ActionFormFieldSummary;
  form: ActionFormState;
  members: SpaceMemberWithUser[];
  onChange: (form: ActionFormState) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const value = form.formValues[field.key] ?? "";
  const setValue = (nextValue: string) =>
    onChange({
      ...form,
      formValues: {
        ...form.formValues,
        [field.key]: nextValue,
      },
    });

  if (field.fieldType === "TEXTAREA") {
    return (
      <label className="field">
        <span>{formatActionFieldLabel(field, t)}</span>
        <textarea
          onChange={(event) => setValue(event.target.value)}
          required={field.required}
          rows={3}
          value={value}
        />
      </label>
    );
  }

  if (field.fieldType === "SELECT") {
    return (
      <label className="field">
        <span>{formatActionFieldLabel(field, t)}</span>
        <select
          onChange={(event) => setValue(event.target.value)}
          required={field.required}
          value={value}
        >
          <option value="">{t("workflowActions.selectPlaceholder")}</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.fieldType === "USER") {
    return (
      <label className="field">
        <span>{formatActionFieldLabel(field, t)}</span>
        <select
          onChange={(event) => setValue(event.target.value)}
          required={field.required}
          value={value}
        >
          <option value="">{t("workflowActions.userPlaceholder")}</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {formatMember(member)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="field">
      <span>{formatActionFieldLabel(field, t)}</span>
      <input
        onChange={(event) => setValue(event.target.value)}
        required={field.required}
        type={getActionInputType(field.fieldType)}
        value={value}
      />
    </label>
  );
}

function DefinitionRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TraceRow({
  href,
  label,
  value,
}: {
  href?: string;
  label: string;
  value: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      <small>{value}</small>
    </>
  );

  return href ? (
    <Link className="compact-list__row compact-list__row--link" href={href}>
      {content}
    </Link>
  ) : (
    <div className="compact-list__row">{content}</div>
  );
}

function CommentList({
  comments,
  locale,
  t,
}: {
  comments: Comment[];
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (comments.length === 0) {
    return (
      <EmptyState
        title={t("comments.empty.title")}
        description={t("comments.empty.description")}
      />
    );
  }

  return (
    <div className="comment-list" role="list">
      {comments.map((comment) => (
        <article className="comment-list__item" key={comment.id} role="listitem">
          <div>
            <strong>{comment.author.name}</strong>
            <time dateTime={comment.createdAt}>
              {formatDateTime(comment.createdAt, locale)}
            </time>
          </div>
          <p>{comment.body}</p>
        </article>
      ))}
    </div>
  );
}

function AttachmentList({
  attachments,
  locale,
  t,
}: {
  attachments: Attachment[];
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (attachments.length === 0) {
    return (
      <EmptyState
        title={t("attachments.empty.title")}
        description={t("attachments.empty.description")}
      />
    );
  }

  return (
    <div className="attachment-list" role="list">
      {attachments.map((attachment) => (
        <div className="attachment-list__item" key={attachment.id} role="listitem">
          <FileText aria-hidden="true" size={16} strokeWidth={2} />
          <div>
            {attachment.previewUrl ? (
              <a href={attachment.previewUrl} rel="noreferrer" target="_blank">
                {attachment.fileName}
              </a>
            ) : (
              <span>{attachment.fileName}</span>
            )}
            <small>
              {t("attachments.meta", {
                date: formatDateTime(attachment.createdAt, locale) ?? "",
                size: formatFileSize(attachment.size),
              })}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

function UploadStatusList({
  onRetryUpload,
  t,
  uploads,
}: {
  onRetryUpload: (item: UploadItem) => Promise<void>;
  t: ReturnType<typeof useTranslations>;
  uploads: UploadItem[];
}) {
  const hasUploadError = uploads.some((item) => item.status === "failed");

  if (uploads.length === 0) {
    return null;
  }

  return (
    <div
      className={`upload-status-list${
        hasUploadError ? " upload-status-list--error" : ""
      }`}
      aria-live="polite"
    >
      {uploads.map((item) => (
        <div className="upload-status" key={item.id}>
          <div className="upload-status__icon">
            {item.status === "uploading" ? (
              <Loader2 aria-hidden="true" size={16} strokeWidth={2} />
            ) : (
              <XCircle aria-hidden="true" size={16} strokeWidth={2} />
            )}
          </div>
          <div>
            <strong>{item.file.name || t("attachments.unknownFile")}</strong>
            <span>
              {item.status === "uploading"
                ? t("attachments.uploading")
                : tRootAttachmentError(t, item.errorCode)}
            </span>
          </div>
          {item.status === "failed" ? (
            <button
              className="button button--secondary upload-status__retry"
              onClick={() => void onRetryUpload(item)}
              type="button"
            >
              {t("attachments.retry")}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TimelineList({
  locale,
  t,
  timeline,
}: {
  locale: string;
  t: ReturnType<typeof useTranslations>;
  timeline: TimelineEvent[];
}) {
  if (timeline.length === 0) {
    return (
      <EmptyState
        title={t("timeline.empty.title")}
        description={t("timeline.empty.description")}
      />
    );
  }

  return (
    <ol className="activity-list work-item-timeline">
      {timeline.map((event) => (
        <li className="activity-list__item" key={event.id}>
          <span className="activity-list__dot" aria-hidden="true" />
          <div>
            <span>{event.title}</span>
            <small>
              {t("timeline.meta", {
                actor: event.actor.name,
                date: formatDateTime(event.createdAt, locale) ?? "",
                type: t(`timeline.type.${event.eventType}`),
              })}
            </small>
            {event.detail ? <p>{event.detail}</p> : null}
            <TimelineMetadata event={event} t={t} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function TimelineMetadata({
  event,
  t,
}: {
  event: TimelineEvent;
  t: ReturnType<typeof useTranslations>;
}) {
  const rows = createTimelineMetadataRows(event, t);

  if (rows.length === 0) {
    return null;
  }

  return (
    <dl className="timeline-metadata">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function InlineState({ label }: { label: string }) {
  return (
    <div className="inline-state" aria-live="polite">
      <Loader2 aria-hidden="true" size={16} strokeWidth={2} />
      <span>{label}</span>
    </div>
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

function StatePanel({
  description,
  icon,
  title,
}: {
  description: string;
  icon: "loading" | "warning";
  title: string;
}) {
  const Icon = icon === "loading" ? Loader2 : CircleAlert;

  return (
    <section className="state-panel" aria-live="polite">
      <div className="state-panel__icon">
        <Icon aria-hidden="true" size={18} strokeWidth={2} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

function createEmptyTaskForm(): TaskFormState {
  return {
    assigneeId: "",
    blockedReason: "",
    description: "",
    dueDate: "",
    priority: "MEDIUM",
    requirementId: "",
    title: "",
    versionId: "",
  };
}

function createEmptyActionForm(
  fields: ActionFormFieldSummary[] = [],
): ActionFormState {
  return {
    comment: "",
    formValues: Object.fromEntries(fields.map((field) => [field.key, ""])),
  };
}

function toActionRequestOrError(
  action: WorkflowActionSummary,
  form: ActionFormState,
):
  | { ok: true; request: ExecuteActionRequest }
  | { errorKey: string; ok: false } {
  const parsed = toExecuteActionRequestSafe(action, form);

  if (parsed.ok) {
    return parsed;
  }

  if (action.requiresComment && form.comment.trim().length === 0) {
    return {
      errorKey: "workflowActions.errors.commentRequired",
      ok: false,
    };
  }

  return {
    errorKey: "workflowActions.errors.invalidFields",
    ok: false,
  };
}

function toExecuteActionRequestSafe(
  action: WorkflowActionSummary,
  form: ActionFormState,
):
  | { ok: true; request: ExecuteActionRequest }
  | { ok: false } {
  try {
    return {
      ok: true,
      request: toExecuteActionRequest(action, {
        comment: form.comment,
        formValues: form.formValues,
      }),
    };
  } catch {
    return { ok: false };
  }
}

function getActionInputType(fieldType: ActionFormFieldSummary["fieldType"]) {
  if (fieldType === "DATE") {
    return "date";
  }

  if (fieldType === "NUMBER") {
    return "number";
  }

  return "text";
}

function formatActionFieldLabel(
  field: ActionFormFieldSummary,
  t: ReturnType<typeof useTranslations>,
) {
  return field.required
    ? t("workflowActions.requiredField", { label: field.label })
    : field.label;
}

function createTimelineMetadataRows(
  event: TimelineEvent,
  t: ReturnType<typeof useTranslations>,
) {
  const rows: Array<{ label: string; value: string }> = [];
  const metadata = event.metadata ?? {};

  addRecordValue(rows, t("timeline.metadata.action"), metadata.actionName);
  addRecordValue(rows, t("timeline.metadata.actionCode"), metadata.actionCode);
  addRecordValue(rows, t("timeline.metadata.fromState"), metadata.fromStateId);
  addRecordValue(rows, t("timeline.metadata.toState"), metadata.toStateId);
  addRecordValue(rows, t("timeline.metadata.closedAt"), metadata.closedAt);
  addRecordValue(rows, t("timeline.metadata.reopenedAt"), metadata.reopenedAt);

  if (event.before) {
    addRecordValue(
      rows,
      t("timeline.metadata.beforeStatus"),
      event.before.statusCategory,
    );
    addRecordValue(
      rows,
      t("timeline.metadata.beforeState"),
      event.before.currentStateId,
    );
  }

  if (event.after) {
    addRecordValue(
      rows,
      t("timeline.metadata.afterStatus"),
      event.after.statusCategory,
    );
    addRecordValue(
      rows,
      t("timeline.metadata.afterState"),
      event.after.currentStateId,
    );
  }

  return rows;
}

function addRecordValue(
  rows: Array<{ label: string; value: string }>,
  label: string,
  value: unknown,
) {
  if (typeof value === "string" && value.trim().length > 0) {
    rows.push({ label, value });
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    rows.push({ label, value: String(value) });
  }
}

function workItemToFormState(workItem: WorkItem): TaskFormState {
  return {
    assigneeId: workItem.assigneeId ?? "",
    blockedReason: workItem.blockedReason ?? "",
    description: workItem.description ?? "",
    dueDate: toDateTimeInputValue(workItem.dueDate),
    priority: workItem.priority,
    requirementId: workItem.requirementId ?? "",
    title: workItem.title,
    versionId: workItem.versionId ?? "",
  };
}

function toIsoDateTime(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toDateTimeInputValue(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return local.toISOString().slice(0, 16);
}

function formatMember(member: SpaceMemberWithUser) {
  return `${member.user.name} (${member.user.username})`;
}

function formatMemberName(
  userId: string | undefined,
  members: SpaceMemberWithUser[],
) {
  if (!userId) {
    return undefined;
  }

  const member = members.find((item) => item.userId === userId);

  return member ? formatMember(member) : userId;
}

function formatVersionName(versionId: string | undefined, versions: Version[]) {
  if (!versionId) {
    return undefined;
  }

  return versions.find((version) => version.id === versionId)?.name ?? versionId;
}

function formatRequirementName(
  requirementId: string | undefined,
  requirements: Requirement[],
) {
  if (!requirementId) {
    return undefined;
  }

  return (
    requirements.find((requirement) => requirement.id === requirementId)?.title ??
    requirementId
  );
}

function formatSpaceScope(
  space: SessionSpaceSummary | undefined,
  fallback: string,
) {
  return space ? `${space.name} / ${space.code}` : fallback;
}

function formatDateTime(value: string | undefined, locale: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatNow(locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function createUploadingItem(file: File): UploadItem {
  return {
    file,
    id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
    retryable: false,
    status: "uploading",
  };
}

function tRootAttachmentError(
  t: ReturnType<typeof useTranslations>,
  code: AttachmentUploadErrorCode | undefined,
) {
  return t(`uploadErrors.${code ?? "UPLOAD_FAILED"}`);
}
