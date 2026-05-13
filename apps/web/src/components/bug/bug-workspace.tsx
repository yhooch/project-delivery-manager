"use client";

import type {
  ActionFormFieldSummary,
  Attachment,
  BugSeverity,
  BugView,
  Comment,
  ExecuteActionRequest,
  Priority,
  Requirement,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  StatusCategory,
  TimelineEvent,
  Version,
  WorkflowActionSummary,
  WorkItem,
} from "@project-delivery/shared";
import {
  Bug,
  CircleAlert,
  Clock3,
  FileText,
  GitBranch,
  Inbox,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Save,
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
import { toExecuteActionRequest } from "../../lib/action-forms";
import { executeAction } from "../../lib/action-service";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createAttachmentUploadFailure,
  listAttachments,
  uploadAttachment,
  type AttachmentUploadErrorCode,
} from "../../lib/attachment-service";
import { toCreateBugRequest, toUpdateBugRequest } from "../../lib/bug-forms";
import { createBug, getBug, listBugs, updateBug } from "../../lib/bug-service";
import { toCreateCommentRequest } from "../../lib/comment-forms";
import { createComment, listComments } from "../../lib/comment-service";
import {
  listRequirementAssignableMembers,
  listRequirements,
  listRequirementVersions,
} from "../../lib/requirement-service";
import { listWorkItemTimeline } from "../../lib/timeline-service";
import { listWorkItems } from "../../lib/work-item-service";
import { useSession } from "../providers/session-provider";
import {
  createBugDetailCacheKey,
  createBugListCacheKey,
  createBugResourceCacheKey,
} from "../../lib/work-item-cache";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const SEVERITIES: BugSeverity[] = [
  "BLOCKER",
  "CRITICAL",
  "MAJOR",
  "MINOR",
  "TRIVIAL",
];
const STATUS_CATEGORIES: StatusCategory[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING",
  "VERIFYING",
  "DONE",
  "TERMINATED",
];

type BugWorkspaceProps = {
  initialAssigneeId?: string;
  initialBugId?: string;
  initialPriority?: Priority;
  initialRelatedTaskId?: string;
  initialRequirementId?: string;
  initialSeverity?: BugSeverity;
  initialStatusCategory?: StatusCategory;
  initialVersionId?: string;
  spaceId: string;
};

type BugFormState = {
  actualResult: string;
  assigneeId: string;
  blockedReason: string;
  description: string;
  dueDate: string;
  expectedResult: string;
  fixNote: string;
  priority: Priority;
  regressionAt: string;
  regressionBy: string;
  regressionResult: string;
  relatedTaskId: string;
  requirementId: string;
  severity: BugSeverity;
  stepsToReproduce: string;
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

export function BugWorkspace({
  initialAssigneeId,
  initialBugId,
  initialPriority,
  initialRelatedTaskId,
  initialRequirementId,
  initialSeverity,
  initialStatusCategory,
  initialVersionId,
  spaceId,
}: BugWorkspaceProps) {
  const t = useTranslations("bugs");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { session, status } = useSession();
  const [bugs, setBugs] = useState<BugView[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [relatedTasks, setRelatedTasks] = useState<WorkItem[]>([]);
  const [versionFilter, setVersionFilter] = useState(initialVersionId ?? "");
  const [requirementFilter, setRequirementFilter] = useState(
    initialRequirementId ?? "",
  );
  const [relatedTaskFilter, setRelatedTaskFilter] = useState(
    initialRelatedTaskId ?? "",
  );
  const [assigneeFilter, setAssigneeFilter] = useState(initialAssigneeId ?? "");
  const [statusCategoryFilter, setStatusCategoryFilter] = useState<
    StatusCategory | "ALL"
  >(initialStatusCategory ?? "ALL");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "ALL">(
    initialPriority ?? "ALL",
  );
  const [severityFilter, setSeverityFilter] = useState<BugSeverity | "ALL">(
    initialSeverity ?? "ALL",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [detailErrorKey, setDetailErrorKey] = useState<string | null>(null);
  const [resourceErrorKey, setResourceErrorKey] = useState<string | null>(null);
  const [actionValidationErrorKey, setActionValidationErrorKey] = useState<
    string | null
  >(null);
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<BugView | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [areResourcesLoading, setAreResourcesLoading] = useState(false);
  const [createForm, setCreateForm] = useState<BugFormState>(
    createEmptyBugForm(),
  );
  const [editForm, setEditForm] = useState<BugFormState>(createEmptyBugForm());
  const [commentBody, setCommentBody] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const detailRequestTokenRef = useRef(0);
  const initialBugOpenedRef = useRef(false);

  const currentSpace = useMemo(
    () => session?.spaces.find((space) => space.id === spaceId),
    [session, spaceId],
  );
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;
  const canCreateBug =
    currentSpace !== undefined && currentSpace.role !== "VIEWER";
  const listCacheKey = useMemo(
    () =>
      createBugListCacheKey({
        assigneeId: assigneeFilter,
        priority: priorityFilter,
        relatedTaskId: relatedTaskFilter,
        requirementId: requirementFilter,
        severity: severityFilter,
        spaceId,
        statusCategory: statusCategoryFilter,
        versionId: versionFilter,
      }),
    [
      assigneeFilter,
      priorityFilter,
      relatedTaskFilter,
      requirementFilter,
      severityFilter,
      spaceId,
      statusCategoryFilter,
      versionFilter,
    ],
  );
  const detailCacheKey = selectedBugId
    ? createBugDetailCacheKey(spaceId, selectedBugId)
    : "";
  const resourceCacheKey = selectedBugId
    ? createBugResourceCacheKey(spaceId, selectedBugId)
    : "";

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let isActive = true;

    async function load() {
      setIsLoading(true);
      setErrorKey(null);

      try {
        const [bugPage, versionPage, requirementPage, memberPage, taskPage] =
          await Promise.all([
            listBugs({
              assigneeId: assigneeFilter || undefined,
              organizationId,
              page: 1,
              pageSize: 100,
              priority: priorityFilter === "ALL" ? undefined : priorityFilter,
              relatedTaskId: relatedTaskFilter || undefined,
              requirementId: requirementFilter || undefined,
              severity: severityFilter === "ALL" ? undefined : severityFilter,
              spaceId,
              statusCategory:
                statusCategoryFilter === "ALL"
                  ? undefined
                  : statusCategoryFilter,
              versionId: versionFilter || undefined,
            }),
            listRequirementVersions({ organizationId, spaceId }),
            listRequirements({
              includeDrafts: false,
              organizationId,
              page: 1,
              pageSize: 100,
              spaceId,
              versionId: versionFilter || undefined,
            }),
            listRequirementAssignableMembers({ organizationId, spaceId }),
            listWorkItems({
              organizationId,
              page: 1,
              pageSize: 100,
              spaceId,
            }),
          ]);

        if (!isActive) {
          return;
        }

        setBugs(bugPage.items);
        setVersions(versionPage.items);
        setRequirements(requirementPage.items);
        setMembers(memberPage.items);
        setRelatedTasks(taskPage.items);
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
    organizationId,
    priorityFilter,
    relatedTaskFilter,
    requirementFilter,
    severityFilter,
    spaceId,
    status,
    statusCategoryFilter,
    versionFilter,
  ]);

  useEffect(() => {
    if (initialBugOpenedRef.current || status !== "authenticated" || !initialBugId) {
      return;
    }

    initialBugOpenedRef.current = true;
    void openBug(initialBugId);
  }, [initialBugId, status]);

  async function refreshBugs() {
    setIsLoading(true);
    setErrorKey(null);

    try {
      const bugPage = await listBugs({
        assigneeId: assigneeFilter || undefined,
        organizationId,
        page: 1,
        pageSize: 100,
        priority: priorityFilter === "ALL" ? undefined : priorityFilter,
        relatedTaskId: relatedTaskFilter || undefined,
        requirementId: requirementFilter || undefined,
        severity: severityFilter === "ALL" ? undefined : severityFilter,
        spaceId,
        statusCategory:
          statusCategoryFilter === "ALL" ? undefined : statusCategoryFilter,
        versionId: versionFilter || undefined,
      });
      setBugs(bugPage.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function openBug(bugId: string) {
    const requestToken = detailRequestTokenRef.current + 1;
    detailRequestTokenRef.current = requestToken;
    setSelectedBugId(bugId);
    setSelectedDetail(null);
    setComments([]);
    setAttachments([]);
    setTimeline([]);
    setUploads([]);
    setSelectedActionId(null);
    setActionValidationErrorKey(null);
    setDetailErrorKey(null);
    setResourceErrorKey(null);
    setIsDetailLoading(true);

    try {
      const detail = await getBug({ bugId, organizationId, spaceId });

      if (detailRequestTokenRef.current !== requestToken) {
        return;
      }

      setSelectedDetail(detail);
      setEditForm(bugToFormState(detail));
      await loadBugResources(bugId, requestToken);
    } catch (error) {
      if (detailRequestTokenRef.current === requestToken) {
        setDetailErrorKey(getApiErrorMessageKey(error));
      }
    } finally {
      if (detailRequestTokenRef.current === requestToken) {
        setIsDetailLoading(false);
      }
    }
  }

  async function loadBugResources(
    bugId: string,
    requestToken = detailRequestTokenRef.current,
  ) {
    setAreResourcesLoading(true);
    setResourceErrorKey(null);

    try {
      const [commentPage, attachmentPage, timelinePage] = await Promise.all([
        listComments({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          targetId: bugId,
          targetType: "WORK_ITEM",
        }),
        listAttachments({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          targetId: bugId,
          targetType: "WORK_ITEM",
        }),
        listWorkItemTimeline({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          workItemId: bugId,
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
    setSelectedBugId(null);
    setSelectedDetail(null);
    setComments([]);
    setAttachments([]);
    setTimeline([]);
    setUploads([]);
    setSelectedActionId(null);
    setActionValidationErrorKey(null);
    setDetailErrorKey(null);
    setResourceErrorKey(null);
    setIsDetailLoading(false);
    setAreResourcesLoading(false);
  }

  async function onCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canCreateBug) {
      return;
    }

    setIsSubmittingCreate(true);
    setErrorKey(null);

    try {
      const created = await createBug(
        { organizationId, spaceId },
        toCreateBugRequest({
          actualResult: createForm.actualResult,
          assigneeId: createForm.assigneeId,
          description: createForm.description,
          dueDate: toIsoDateTime(createForm.dueDate),
          expectedResult: createForm.expectedResult,
          priority: createForm.priority,
          relatedTaskId: createForm.relatedTaskId,
          requirementId: createForm.requirementId,
          severity: createForm.severity,
          stepsToReproduce: createForm.stepsToReproduce,
          title: createForm.title,
          versionId: createForm.versionId,
        }),
      );
      setBugs((current) => [created, ...current]);
      setCreateForm(createEmptyBugForm());
      await openBug(created.id);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingCreate(false);
    }
  }

  async function onEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDetail?.permissions?.canEdit) {
      return;
    }

    setIsSubmittingEdit(true);
    setDetailErrorKey(null);

    try {
      const updated = await updateBug(
        { bugId: selectedDetail.id, organizationId, spaceId },
        toUpdateBugRequest({
          actualResult: editForm.actualResult,
          assigneeId: editForm.assigneeId,
          blockedReason: editForm.blockedReason,
          description: editForm.description,
          dueDate: toIsoDateTime(editForm.dueDate),
          expectedResult: editForm.expectedResult,
          fixNote: editForm.fixNote,
          priority: editForm.priority,
          regressionAt: toIsoDateTime(editForm.regressionAt),
          regressionBy: editForm.regressionBy,
          regressionResult: editForm.regressionResult,
          relatedTaskId: editForm.relatedTaskId,
          requirementId: editForm.requirementId,
          severity: editForm.severity,
          stepsToReproduce: editForm.stepsToReproduce,
          title: editForm.title,
          versionId: editForm.versionId,
        }),
      );

      setBugs((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelectedDetail((current) =>
        current?.id === updated.id
          ? {
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

  async function onActionSubmit(
    action: WorkflowActionSummary,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selectedDetail) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const parsed = toActionRequestOrError(action, {
      comment: formData.get("comment") ?? undefined,
      formValues: Object.fromEntries(
        action.formFields.map((field) => [
          field.key,
          formData.get(`formValues.${field.key}`) ?? undefined,
        ]),
      ),
    });

    if (!parsed.ok) {
      setActionValidationErrorKey(parsed.errorKey);
      setDetailErrorKey(null);
      return;
    }

    setExecutingActionId(action.id);
    setDetailErrorKey(null);
    setActionValidationErrorKey(null);

    try {
      const updated = await executeAction(
        {
          actionId: action.id,
          organizationId,
          spaceId,
          workItemId: selectedDetail.id,
        },
        parsed.request,
      );

      setBugs((current) =>
        current.map((item) =>
          item.id === updated.id ? { ...item, ...updated, type: "BUG" } : item,
        ),
      );
      setSelectedDetail((current) =>
        current?.id === updated.id
          ? {
              ...current,
              ...updated,
              type: "BUG",
            }
          : current,
      );
      setSelectedActionId(null);
      await loadBugResources(selectedDetail.id);
    } catch (error) {
      setDetailErrorKey(getApiErrorMessageKey(error));
    } finally {
      setExecutingActionId(null);
    }
  }

  function onActionSelect(actionId: string | null) {
    setSelectedActionId(actionId);
    setActionValidationErrorKey(null);
    setDetailErrorKey(null);
  }

  async function onCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDetail?.permissions?.canComment) {
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
      await loadBugResources(selectedDetail.id);
    } catch (error) {
      setResourceErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingComment(false);
    }
  }

  async function uploadFiles(files: File[]) {
    if (!selectedDetail?.permissions?.canUploadAttachment) {
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
        await loadBugResources(selectedDetail.id);
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
    if (!selectedDetail?.permissions?.canUploadAttachment) {
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
      await loadBugResources(selectedDetail.id);
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
      <section className="page-heading" aria-labelledby="bugs-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="bugs-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{formatSpaceScope(currentSpace, t("page.unknownSpace"))}</span>
          <button
            className="button button--secondary"
            disabled={isLoading}
            onClick={() => void refreshBugs()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            {t("actions.refresh")}
          </button>
        </div>
      </section>

      {errorKey ? <div className="form-alert">{tRoot(errorKey)}</div> : null}

      <section
        className="toolbar-panel bug-toolbar"
        aria-label={t("filters.label")}
        data-cache-key={listCacheKey}
      >
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
          <span>{t("filters.relatedTask")}</span>
          <select
            onChange={(event) => setRelatedTaskFilter(event.target.value)}
            value={relatedTaskFilter}
          >
            <option value="">{t("filters.allRelatedTasks")}</option>
            {relatedTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
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
        <label className="field">
          <span>{t("filters.severity")}</span>
          <select
            onChange={(event) =>
              setSeverityFilter(event.target.value as BugSeverity | "ALL")
            }
            value={severityFilter}
          >
            <option value="ALL">{t("filters.allSeverities")}</option>
            {SEVERITIES.map((item) => (
              <option key={item} value={item}>
                {t(`severity.${item}`)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="work-item-layout">
        <section className="panel panel--wide" aria-labelledby="bug-list-title">
          <div className="panel__header">
            <div>
              <h3 id="bug-list-title">{t("list.title")}</h3>
              <p>{t("list.subtitle", { count: bugs.length })}</p>
            </div>
          </div>
          {isLoading ? (
            <InlineState label={t("states.loadingList")} />
          ) : bugs.length === 0 ? (
            <EmptyState
              title={t("states.empty.title")}
              description={t("states.empty.description")}
            />
          ) : (
            <div
              className="business-table bug-table"
              role="table"
              aria-label={t("list.title")}
            >
              <div className="business-table__row business-table__row--head" role="row">
                <span role="columnheader">{t("list.columns.title")}</span>
                <span role="columnheader">{t("list.columns.version")}</span>
                <span role="columnheader">{t("list.columns.requirement")}</span>
                <span role="columnheader">{t("list.columns.relatedTask")}</span>
                <span role="columnheader">{t("list.columns.assignee")}</span>
                <span role="columnheader">{t("list.columns.priority")}</span>
                <span role="columnheader">{t("list.columns.severity")}</span>
                <span role="columnheader">{t("list.columns.statusCategory")}</span>
              </div>
              {bugs.map((item) => (
                <button
                  className="business-table__row business-table__row--link work-item-table__row"
                  key={item.id}
                  onClick={() => void openBug(item.id)}
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
                    {formatWorkItemName(
                      item.bugDetail.relatedTaskId,
                      relatedTasks,
                    ) ?? t("list.noRelatedTask")}
                  </span>
                  <span role="cell">
                    {formatMemberName(item.assigneeId, members) ??
                      t("list.unassigned")}
                  </span>
                  <span role="cell">{t(`priority.${item.priority}`)}</span>
                  <span role="cell">{t(`severity.${item.bugDetail.severity}`)}</span>
                  <span role="cell">
                    <span className="status-pill status-pill--neutral">
                      {t(`statusCategory.${item.statusCategory}`)}
                    </span>
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

        {canCreateBug ? (
          <section className="form-panel" aria-labelledby="bug-create-title">
            <div className="form-panel__header">
              <Plus aria-hidden="true" size={20} strokeWidth={2} />
              <div>
                <h3 id="bug-create-title">{t("create.title")}</h3>
                <p>{t("create.description")}</p>
              </div>
            </div>
            <BugForm
              canSubmit={canCreateBug}
              form={createForm}
              members={members}
              mode="create"
              onChange={setCreateForm}
              onSubmit={onCreateSubmit}
              relatedTasks={relatedTasks}
              requirements={requirements}
              submitIcon={<Plus aria-hidden="true" size={16} strokeWidth={2} />}
              submitLabel={
                isSubmittingCreate ? t("create.submitting") : t("create.submit")
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

      {selectedBugId ? (
        <BugDrawer
          actionErrorKey={detailErrorKey}
          actionValidationErrorKey={actionValidationErrorKey}
          areResourcesLoading={areResourcesLoading}
          attachments={attachments}
          commentBody={commentBody}
          comments={comments}
          detail={selectedDetail}
          detailCacheKey={detailCacheKey}
          detailErrorKey={detailErrorKey}
          editForm={editForm}
          executingActionId={executingActionId}
          isDetailLoading={isDetailLoading}
          isSubmittingComment={isSubmittingComment}
          isSubmittingEdit={isSubmittingEdit}
          locale={locale}
          members={members}
          onActionSelect={onActionSelect}
          onActionSubmit={onActionSubmit}
          onClose={closeDrawer}
          onCommentBodyChange={setCommentBody}
          onCommentSubmit={onCommentSubmit}
          onEditFormChange={setEditForm}
          onEditSubmit={onEditSubmit}
          onFileInputChange={onFileInputChange}
          onRefreshResources={() =>
            selectedBugId ? void loadBugResources(selectedBugId) : undefined
          }
          onRetryUpload={retryUpload}
          relatedTasks={relatedTasks}
          resourceCacheKey={resourceCacheKey}
          resourceErrorKey={resourceErrorKey}
          requirements={requirements}
          selectedActionId={selectedActionId}
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

type BugDrawerProps = {
  actionErrorKey: string | null;
  actionValidationErrorKey: string | null;
  areResourcesLoading: boolean;
  attachments: Attachment[];
  commentBody: string;
  comments: Comment[];
  detail: BugView | null;
  detailCacheKey: string;
  detailErrorKey: string | null;
  editForm: BugFormState;
  executingActionId: string | null;
  isDetailLoading: boolean;
  isSubmittingComment: boolean;
  isSubmittingEdit: boolean;
  locale: string;
  members: SpaceMemberWithUser[];
  onActionSelect: (actionId: string | null) => void;
  onActionSubmit: (
    action: WorkflowActionSummary,
    event: FormEvent<HTMLFormElement>,
  ) => void;
  onClose: () => void;
  onCommentBodyChange: (value: string) => void;
  onCommentSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEditFormChange: (form: BugFormState) => void;
  onEditSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRefreshResources: () => void;
  onRetryUpload: (item: UploadItem) => Promise<void>;
  relatedTasks: WorkItem[];
  resourceCacheKey: string;
  resourceErrorKey: string | null;
  requirements: Requirement[];
  selectedActionId: string | null;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
  timeline: TimelineEvent[];
  uploads: UploadItem[];
  versions: Version[];
};

function BugDrawer({
  actionErrorKey,
  actionValidationErrorKey,
  areResourcesLoading,
  attachments,
  commentBody,
  comments,
  detail,
  detailCacheKey,
  detailErrorKey,
  editForm,
  executingActionId,
  isDetailLoading,
  isSubmittingComment,
  isSubmittingEdit,
  locale,
  members,
  onActionSelect,
  onActionSubmit,
  onClose,
  onCommentBodyChange,
  onCommentSubmit,
  onEditFormChange,
  onEditSubmit,
  onFileInputChange,
  onRefreshResources,
  onRetryUpload,
  relatedTasks,
  resourceCacheKey,
  resourceErrorKey,
  requirements,
  selectedActionId,
  t,
  tRoot,
  timeline,
  uploads,
  versions,
}: BugDrawerProps) {
  const canEdit = detail?.permissions?.canEdit === true;
  const canComment = detail?.permissions?.canComment === true;
  const canUploadAttachment = detail?.permissions?.canUploadAttachment === true;

  return (
    <div className="work-item-drawer" role="dialog" aria-modal="true" aria-labelledby="bug-drawer-title">
      <div className="work-item-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <aside className="work-item-drawer__panel">
        <header className="work-item-drawer__header">
          <div>
            <p className="page-heading__eyebrow">{t("detail.eyebrow")}</p>
            <h3 id="bug-drawer-title">
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
          <div className="work-item-drawer__body" data-cache-key={detailCacheKey}>
            <section className="subsection" aria-labelledby="bug-meta-title">
              <div className="subsection__header">
                <Inbox aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="bug-meta-title">{t("detail.metaTitle")}</h4>
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
                <DefinitionRow label={t("detail.fields.severity")}>
                  {t(`severity.${detail.bugDetail.severity}`)}
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
              </dl>
            </section>

            <section className="subsection" aria-labelledby="bug-fields-title">
              <div className="subsection__header">
                <Bug aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="bug-fields-title">{t("bugFields.title")}</h4>
              </div>
              <dl className="definition-list">
                <DefinitionRow label={t("bugFields.stepsToReproduce")}>
                  {detail.bugDetail.stepsToReproduce ?? t("bugFields.empty")}
                </DefinitionRow>
                <DefinitionRow label={t("bugFields.expectedResult")}>
                  {detail.bugDetail.expectedResult ?? t("bugFields.empty")}
                </DefinitionRow>
                <DefinitionRow label={t("bugFields.actualResult")}>
                  {detail.bugDetail.actualResult ?? t("bugFields.empty")}
                </DefinitionRow>
                <DefinitionRow label={t("bugFields.fixNote")}>
                  {detail.bugDetail.fixNote ?? t("bugFields.empty")}
                </DefinitionRow>
                <DefinitionRow label={t("bugFields.regressionResult")}>
                  {detail.bugDetail.regressionResult ?? t("bugFields.empty")}
                </DefinitionRow>
              </dl>
            </section>

            <section className="subsection" aria-labelledby="bug-trace-title">
              <div className="subsection__header">
                <Link2 aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="bug-trace-title">{t("trace.title")}</h4>
              </div>
              <div className="compact-list">
                <TraceRow
                  href={detail.versionId ? `/spaces/${detail.spaceId}/versions` : undefined}
                  label={t("trace.version")}
                  value={
                    formatVersionName(detail.versionId, versions) ??
                    t("trace.noVersion")
                  }
                />
                <TraceRow
                  href={detail.requirementId ? `/requirements/${detail.requirementId}` : undefined}
                  label={t("trace.requirement")}
                  value={
                    formatRequirementName(detail.requirementId, requirements) ??
                    t("trace.noRequirement")
                  }
                />
                <TraceRow
                  href={
                    detail.bugDetail.relatedTaskId
                      ? `/spaces/${detail.spaceId}/work-items`
                      : undefined
                  }
                  label={t("trace.relatedTask")}
                  value={
                    formatWorkItemName(detail.bugDetail.relatedTaskId, relatedTasks) ??
                    t("trace.noRelatedTask")
                  }
                />
              </div>
            </section>

            <section className="subsection" aria-labelledby="bug-actions-title">
              <div className="subsection__header">
                <GitBranch aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="bug-actions-title">{t("workflowActions.title")}</h4>
              </div>
              <WorkflowActionPanel
                actionErrorKey={actionErrorKey}
                actionValidationErrorKey={actionValidationErrorKey}
                actions={detail.permissions?.availableActions ?? []}
                executingActionId={executingActionId}
                members={members}
                onActionSelect={onActionSelect}
                onActionSubmit={onActionSubmit}
                selectedActionId={selectedActionId}
                t={t}
                tRoot={tRoot}
              />
            </section>

            <section className="subsection" aria-labelledby="bug-edit-title">
              <div className="subsection__header">
                <Pencil aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="bug-edit-title">{t("edit.title")}</h4>
              </div>
              {canEdit ? (
                <BugForm
                  canSubmit={canEdit}
                  form={editForm}
                  members={members}
                  mode="edit"
                  onChange={onEditFormChange}
                  onSubmit={onEditSubmit}
                  relatedTasks={relatedTasks}
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

            <section className="subsection" aria-labelledby="bug-comments-title">
              <div className="subsection__header">
                <MessageSquare aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="bug-comments-title">{t("comments.title")}</h4>
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

            <section className="subsection" aria-labelledby="bug-attachments-title">
              <div className="subsection__header">
                <Paperclip aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="bug-attachments-title">{t("attachments.title")}</h4>
              </div>
              {canUploadAttachment ? (
                <div className="attachment-uploader">
                  <label className="button button--secondary" htmlFor="bug-attachment-input">
                    <Upload aria-hidden="true" size={16} strokeWidth={2} />
                    {t("attachments.upload")}
                  </label>
                  <input
                    aria-label={t("attachments.uploadInput")}
                    className="sr-only"
                    id="bug-attachment-input"
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

            <section className="subsection" aria-labelledby="bug-timeline-title" data-cache-key={resourceCacheKey}>
              <div className="subsection__header">
                <Clock3 aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="bug-timeline-title">{t("timeline.title")}</h4>
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

type BugFormProps = {
  canSubmit: boolean;
  form: BugFormState;
  members: SpaceMemberWithUser[];
  mode: "create" | "edit";
  onChange: (form: BugFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  relatedTasks: WorkItem[];
  requirements: Requirement[];
  submitIcon: ReactNode;
  submitLabel: string;
  t: ReturnType<typeof useTranslations>;
  versions: Version[];
};

function BugForm({
  canSubmit,
  form,
  members,
  mode,
  onChange,
  onSubmit,
  relatedTasks,
  requirements,
  submitIcon,
  submitLabel,
  t,
  versions,
}: BugFormProps) {
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
          rows={3}
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
          <span>{t("form.relatedTask")}</span>
          <select
            onChange={(event) =>
              onChange({ ...form, relatedTaskId: event.target.value })
            }
            value={form.relatedTaskId}
          >
            <option value="">{t("form.noRelatedTask")}</option>
            {relatedTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
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
          <span>{t("form.severity")}</span>
          <select
            onChange={(event) =>
              onChange({ ...form, severity: event.target.value as BugSeverity })
            }
            value={form.severity}
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {t(`severity.${severity}`)}
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
      <label className="field">
        <span>{t("form.stepsToReproduce")}</span>
        <textarea
          maxLength={8000}
          onChange={(event) =>
            onChange({ ...form, stepsToReproduce: event.target.value })
          }
          rows={3}
          value={form.stepsToReproduce}
        />
      </label>
      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{t("form.expectedResult")}</span>
          <textarea
            maxLength={8000}
            onChange={(event) =>
              onChange({ ...form, expectedResult: event.target.value })
            }
            rows={3}
            value={form.expectedResult}
          />
        </label>
        <label className="field">
          <span>{t("form.actualResult")}</span>
          <textarea
            maxLength={8000}
            onChange={(event) =>
              onChange({ ...form, actualResult: event.target.value })
            }
            rows={3}
            value={form.actualResult}
          />
        </label>
      </div>
      {mode === "edit" ? (
        <>
          <label className="field">
            <span>{t("form.fixNote")}</span>
            <textarea
              maxLength={8000}
              onChange={(event) =>
                onChange({ ...form, fixNote: event.target.value })
              }
              rows={3}
              value={form.fixNote}
            />
          </label>
          <div className="form-grid form-grid--two">
            <label className="field">
              <span>{t("form.regressionBy")}</span>
              <select
                onChange={(event) =>
                  onChange({ ...form, regressionBy: event.target.value })
                }
                value={form.regressionBy}
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
              <span>{t("form.regressionAt")}</span>
              <input
                onChange={(event) =>
                  onChange({ ...form, regressionAt: event.target.value })
                }
                type="datetime-local"
                value={form.regressionAt}
              />
            </label>
          </div>
          <label className="field">
            <span>{t("form.regressionResult")}</span>
            <textarea
              maxLength={8000}
              onChange={(event) =>
                onChange({ ...form, regressionResult: event.target.value })
              }
              rows={3}
              value={form.regressionResult}
            />
          </label>
        </>
      ) : null}
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

function WorkflowActionPanel({
  actionErrorKey,
  actionValidationErrorKey,
  actions,
  executingActionId,
  members,
  onActionSelect,
  onActionSubmit,
  selectedActionId,
  t,
  tRoot,
}: {
  actionErrorKey: string | null;
  actionValidationErrorKey: string | null;
  actions: WorkflowActionSummary[];
  executingActionId: string | null;
  members: SpaceMemberWithUser[];
  onActionSelect: (actionId: string | null) => void;
  onActionSubmit: (
    action: WorkflowActionSummary,
    event: FormEvent<HTMLFormElement>,
  ) => void;
  selectedActionId: string | null;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
}) {
  const selectedAction =
    actions.find((action) => action.id === selectedActionId) ?? null;
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
            disabled={executingActionId !== null}
            key={action.id}
            onClick={() =>
              onActionSelect(selectedActionId === action.id ? null : action.id)
            }
            type="button"
          >
            <GitBranch aria-hidden="true" size={16} strokeWidth={2} />
            {action.name}
          </button>
        ))}
      </div>
      {actionErrorKey ? (
        <div className="form-alert">{tRoot(actionErrorKey)}</div>
      ) : null}
      {selectedAction ? (
        <form
          className="business-form workflow-action-form"
          noValidate
          onSubmit={(event) => onActionSubmit(selectedAction, event)}
        >
          <div className="workflow-action-form__heading">
            <strong>{selectedAction.name}</strong>
            <span>{t("workflowActions.formHelp")}</span>
          </div>
          {selectedAction.requiresComment ? (
            <label className="field">
              <span>{t("workflowActions.comment")}</span>
              <textarea maxLength={4000} name="comment" required rows={3} />
            </label>
          ) : null}
          {selectedAction.formFields.map((field) => (
            <ActionField field={field} key={field.id} members={members} t={t} />
          ))}
          {actionValidationErrorKey ? (
            <div className="form-alert">{t(actionValidationErrorKey)}</div>
          ) : null}
          <div className="form-actions">
            <button
              className="button button--primary"
              disabled={executingActionId === selectedAction.id}
              type="submit"
            >
              <GitBranch aria-hidden="true" size={16} strokeWidth={2} />
              {executingActionId === selectedAction.id
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
  members,
  t,
}: {
  field: ActionFormFieldSummary;
  members: SpaceMemberWithUser[];
  t: ReturnType<typeof useTranslations>;
}) {
  const name = `formValues.${field.key}`;

  if (field.fieldType === "TEXTAREA") {
    return (
      <label className="field">
        <span>{formatActionFieldLabel(field, t)}</span>
        <textarea name={name} required={field.required} rows={3} />
      </label>
    );
  }

  if (field.fieldType === "SELECT") {
    return (
      <label className="field">
        <span>{formatActionFieldLabel(field, t)}</span>
        <select name={name} required={field.required}>
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
        <select name={name} required={field.required}>
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
        name={name}
        required={field.required}
        type={getActionInputType(field.fieldType)}
      />
    </label>
  );
}

function toActionRequestOrError(
  action: WorkflowActionSummary,
  input: {
    comment?: FormDataEntryValue | undefined;
    formValues: Record<string, FormDataEntryValue | undefined>;
  },
):
  | { ok: true; request: ExecuteActionRequest }
  | { errorKey: string; ok: false } {
  try {
    return {
      ok: true,
      request: toExecuteActionRequest(action, input),
    };
  } catch {
    if (
      action.requiresComment &&
      typeof input.comment === "string" &&
      input.comment.trim().length === 0
    ) {
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
                : t(`uploadErrors.${item.errorCode ?? "UPLOAD_FAILED"}`)}
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
          </div>
        </li>
      ))}
    </ol>
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

function createEmptyBugForm(): BugFormState {
  return {
    actualResult: "",
    assigneeId: "",
    blockedReason: "",
    description: "",
    dueDate: "",
    expectedResult: "",
    fixNote: "",
    priority: "MEDIUM",
    regressionAt: "",
    regressionBy: "",
    regressionResult: "",
    relatedTaskId: "",
    requirementId: "",
    severity: "MAJOR",
    stepsToReproduce: "",
    title: "",
    versionId: "",
  };
}

function bugToFormState(bug: BugView): BugFormState {
  return {
    actualResult: bug.bugDetail.actualResult ?? "",
    assigneeId: bug.assigneeId ?? "",
    blockedReason: bug.blockedReason ?? "",
    description: bug.description ?? "",
    dueDate: toDateTimeInputValue(bug.dueDate),
    expectedResult: bug.bugDetail.expectedResult ?? "",
    fixNote: bug.bugDetail.fixNote ?? "",
    priority: bug.priority,
    regressionAt: toDateTimeInputValue(bug.bugDetail.regressionAt),
    regressionBy: bug.bugDetail.regressionBy ?? "",
    regressionResult: bug.bugDetail.regressionResult ?? "",
    relatedTaskId: bug.bugDetail.relatedTaskId ?? "",
    requirementId: bug.requirementId ?? "",
    severity: bug.bugDetail.severity,
    stepsToReproduce: bug.bugDetail.stepsToReproduce ?? "",
    title: bug.title,
    versionId: bug.versionId ?? "",
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

function formatWorkItemName(workItemId: string | undefined, items: WorkItem[]) {
  if (!workItemId) {
    return undefined;
  }

  return items.find((item) => item.id === workItemId)?.title ?? workItemId;
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
