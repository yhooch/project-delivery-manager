"use client";

import type {
  Comment,
  IntakeItem,
  IntakeSourceType,
  IntakeStatus,
  Priority,
  Requirement,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  TimelineEvent,
  Version,
  WorkItem,
} from "@project-delivery/shared";
import {
  Ban,
  Check,
  CircleAlert,
  Clock3,
  Inbox,
  Link2,
  ListChecks,
  Loader2,
  MessageSquare,
  PauseCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toCreateCommentRequest } from "../../lib/comment-forms";
import { createComment, listComments } from "../../lib/comment-service";
import {
  intakeStatusActionFormSchema,
  toConvertIntakeItemRequest,
  toCreateIntakeItemRequest,
  toUpdateIntakeItemRequest,
} from "../../lib/intake-forms";
import {
  acceptIntakeItem,
  convertIntakeItemToWorkItems,
  createIntakeItem,
  deferIntakeItem,
  getIntakeItem,
  listIntakeItems,
  rejectIntakeItem,
  updateIntakeItem,
} from "../../lib/intake-service";
import {
  listRequirementAssignableMembers,
  listRequirements,
  listRequirementVersions,
} from "../../lib/requirement-service";
import { listTimeline } from "../../lib/timeline-service";
import { createTaskFormSchema } from "../../lib/work-item-forms";
import { listWorkItems } from "../../lib/work-item-service";
import { useSession } from "../providers/session-provider";
import {
  createIntakeItemDetailCacheKey,
  createIntakeItemListCacheKey,
  createIntakeItemResourceCacheKey,
  createIntakeRelatedWorkItemsCacheKey,
} from "./intake-cache";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const INTAKE_STATUSES: IntakeStatus[] = [
  "PENDING",
  "ACCEPTED",
  "DEFERRED",
  "REJECTED",
  "CONVERTED",
];
const SOURCE_TYPES: IntakeSourceType[] = [
  "REQUIREMENT_CHANGE",
  "DEFECT_PROBLEM",
  "PROJECT_PLAN",
  "MEETING_DECISION",
  "AD_HOC",
  "IMPLEMENTATION",
  "OPERATIONS",
  "RELEASE",
  "EXTERNAL_COLLABORATION",
];

type IntakeWorkspaceProps = {
  initialPriority?: Priority;
  initialRequirementId?: string;
  initialStatus?: IntakeStatus;
  initialVersionId?: string;
  spaceId: string;
};

type IntakeFormState = {
  assigneeId: string;
  description: string;
  priority: Priority | "";
  requirementId: string;
  sourceObject: string;
  sourceType: IntakeSourceType;
  title: string;
  versionId: string;
};

type BreakdownTaskFormState = {
  assigneeId: string;
  description: string;
  dueDate: string;
  priority: Priority;
  requirementId: string;
  title: string;
  versionId: string;
};

type IntakeStatusAction = "accept" | "defer" | "reject";

export function IntakeWorkspace({
  initialPriority,
  initialRequirementId,
  initialStatus,
  initialVersionId,
  spaceId,
}: IntakeWorkspaceProps) {
  const t = useTranslations("intakeItems");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { session, status } = useSession();
  const [intakeItems, setIntakeItems] = useState<IntakeItem[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [statusFilter, setStatusFilter] = useState<IntakeStatus | "ALL">(
    initialStatus ?? "ALL",
  );
  const [versionFilter, setVersionFilter] = useState(initialVersionId ?? "");
  const [requirementFilter, setRequirementFilter] = useState(
    initialRequirementId ?? "",
  );
  const [priorityFilter, setPriorityFilter] = useState<Priority | "ALL">(
    initialPriority ?? "ALL",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isSubmittingConvert, setIsSubmittingConvert] = useState(false);
  const [statusAction, setStatusAction] = useState<IntakeStatusAction | null>(
    null,
  );
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [detailErrorKey, setDetailErrorKey] = useState<string | null>(null);
  const [resourceErrorKey, setResourceErrorKey] = useState<string | null>(null);
  const [selectedIntakeItemId, setSelectedIntakeItemId] = useState<
    string | null
  >(null);
  const [selectedDetail, setSelectedDetail] = useState<IntakeItem | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [relatedTasks, setRelatedTasks] = useState<WorkItem[]>([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [areResourcesLoading, setAreResourcesLoading] = useState(false);
  const [createForm, setCreateForm] = useState<IntakeFormState>(
    createEmptyIntakeForm(),
  );
  const [editForm, setEditForm] = useState<IntakeFormState>(
    createEmptyIntakeForm(),
  );
  const [commentBody, setCommentBody] = useState("");
  const [breakdownTasks, setBreakdownTasks] = useState<
    BreakdownTaskFormState[]
  >([createEmptyBreakdownTask()]);
  const detailRequestTokenRef = useRef(0);
  const lastBreakdownSeedRef = useRef<string | null>(null);

  const currentSpace = useMemo(
    () => session?.spaces.find((space) => space.id === spaceId),
    [session, spaceId],
  );
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;
  const canWriteIntake =
    currentSpace !== undefined && currentSpace.role !== "VIEWER";
  const listCacheKey = useMemo(
    () =>
      createIntakeItemListCacheKey({
        priority: priorityFilter,
        requirementId: requirementFilter,
        spaceId,
        status: statusFilter,
        versionId: versionFilter,
      }),
    [priorityFilter, requirementFilter, spaceId, statusFilter, versionFilter],
  );
  const detailCacheKey = useMemo(
    () =>
      selectedIntakeItemId
        ? createIntakeItemDetailCacheKey(spaceId, selectedIntakeItemId)
        : "",
    [selectedIntakeItemId, spaceId],
  );
  const resourceCacheKey = useMemo(
    () =>
      selectedIntakeItemId
        ? createIntakeItemResourceCacheKey(spaceId, selectedIntakeItemId)
        : "",
    [selectedIntakeItemId, spaceId],
  );
  const relatedTasksCacheKey = useMemo(
    () =>
      selectedIntakeItemId
        ? createIntakeRelatedWorkItemsCacheKey(spaceId, selectedIntakeItemId)
        : "",
    [selectedIntakeItemId, spaceId],
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
        const [intakePage, versionPage, requirementPage, memberPage] =
          await Promise.all([
            listIntakeItems({
              organizationId,
              page: 1,
              pageSize: 100,
              priority: priorityFilter === "ALL" ? undefined : priorityFilter,
              requirementId: requirementFilter || undefined,
              spaceId,
              status: statusFilter === "ALL" ? undefined : statusFilter,
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

        setIntakeItems(intakePage.items);
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
    listCacheKey,
    organizationId,
    priorityFilter,
    requirementFilter,
    spaceId,
    status,
    statusFilter,
    versionFilter,
  ]);

  useEffect(() => {
    if (!selectedDetail) {
      setEditForm(createEmptyIntakeForm());
      setBreakdownTasks([createEmptyBreakdownTask()]);
      lastBreakdownSeedRef.current = null;
      return;
    }

    setEditForm(intakeItemToFormState(selectedDetail));

    if (lastBreakdownSeedRef.current !== selectedDetail.id) {
      setBreakdownTasks([createEmptyBreakdownTask(selectedDetail)]);
      lastBreakdownSeedRef.current = selectedDetail.id;
    }
  }, [selectedDetail]);

  async function refreshIntakeItems() {
    if (status !== "authenticated") {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const intakePage = await listIntakeItems({
        organizationId,
        page: 1,
        pageSize: 100,
        priority: priorityFilter === "ALL" ? undefined : priorityFilter,
        requirementId: requirementFilter || undefined,
        spaceId,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        versionId: versionFilter || undefined,
      });
      setIntakeItems(intakePage.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function openIntakeItem(intakeItemId: string) {
    const token = detailRequestTokenRef.current + 1;
    detailRequestTokenRef.current = token;
    setSelectedIntakeItemId(intakeItemId);
    setSelectedDetail(null);
    setComments([]);
    setTimeline([]);
    setRelatedTasks([]);
    setCommentBody("");
    setDetailErrorKey(null);
    setResourceErrorKey(null);
    setIsDetailLoading(true);

    try {
      const detail = await getIntakeItem({
        intakeItemId,
        organizationId,
        spaceId,
      });

      if (detailRequestTokenRef.current !== token) {
        return;
      }

      setSelectedDetail(detail);
      await loadIntakeResources(intakeItemId, token);
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

  async function loadIntakeResources(intakeItemId: string, token?: number) {
    const requestToken = token ?? detailRequestTokenRef.current;
    setAreResourcesLoading(true);
    setResourceErrorKey(null);

    try {
      const [commentPage, timelinePage, taskPage] = await Promise.all([
        listComments({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          targetId: intakeItemId,
          targetType: "INTAKE_ITEM",
        }),
        listTimeline({
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
          targetId: intakeItemId,
          targetType: "INTAKE_ITEM",
        }),
        listWorkItems({
          intakeItemId,
          organizationId,
          page: 1,
          pageSize: 100,
          spaceId,
        }),
      ]);

      if (detailRequestTokenRef.current !== requestToken) {
        return;
      }

      setComments(commentPage.items);
      setTimeline(timelinePage.items);
      setRelatedTasks(taskPage.items);
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
    setSelectedIntakeItemId(null);
    setSelectedDetail(null);
    setComments([]);
    setTimeline([]);
    setRelatedTasks([]);
    setCommentBody("");
    setDetailErrorKey(null);
    setResourceErrorKey(null);
    setIsDetailLoading(false);
    setAreResourcesLoading(false);
  }

  async function onCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canWriteIntake) {
      return;
    }

    setIsSubmittingCreate(true);
    setErrorKey(null);

    try {
      const created = await createIntakeItem(
        {
          organizationId,
          spaceId,
        },
        toCreateIntakeItemRequest(intakeFormToInput(createForm)),
      );
      setIntakeItems((current) => [created, ...current]);
      setCreateForm(createEmptyIntakeForm());
      await openIntakeItem(created.id);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingCreate(false);
    }
  }

  async function onEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDetail || !canWriteIntake) {
      return;
    }

    setIsSubmittingEdit(true);
    setDetailErrorKey(null);

    try {
      const updated = await updateIntakeItem(
        {
          intakeItemId: selectedDetail.id,
          organizationId,
          spaceId,
        },
        toUpdateIntakeItemRequest(intakeFormToInput(editForm)),
      );
      applyIntakeItemUpdate(updated);
    } catch (error) {
      setDetailErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  async function onStatusAction(action: IntakeStatusAction) {
    if (!selectedDetail || !canWriteIntake) {
      return;
    }

    setStatusAction(action);
    setDetailErrorKey(null);

    try {
      const parsed = intakeStatusActionFormSchema.parse({ action });
      const context = {
        intakeItemId: selectedDetail.id,
        organizationId,
        spaceId,
      };
      const updated =
        parsed.action === "accept"
          ? await acceptIntakeItem(context)
          : parsed.action === "defer"
            ? await deferIntakeItem(context)
            : await rejectIntakeItem(context);

      applyIntakeItemUpdate(updated);
      await refreshIntakeItems();
      await loadIntakeResources(updated.id);
    } catch (error) {
      setDetailErrorKey(getApiErrorMessageKey(error));
    } finally {
      setStatusAction(null);
    }
  }

  async function onCommentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDetail || !canWriteIntake) {
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
          targetType: "INTAKE_ITEM",
        }),
      });
      setComments((current) => [created, ...current]);
      setCommentBody("");
      await loadIntakeResources(selectedDetail.id);
    } catch (error) {
      setResourceErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingComment(false);
    }
  }

  async function onConvertSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedDetail || !canWriteIntake) {
      return;
    }

    if (selectedDetail.status === "CONVERTED") {
      setDetailErrorKey("errors.api.INTAKE_ITEM_ALREADY_CONVERTED");
      return;
    }

    setIsSubmittingConvert(true);
    setDetailErrorKey(null);

    try {
      await convertIntakeItemToWorkItems(
        {
          intakeItemId: selectedDetail.id,
          organizationId,
          spaceId,
        },
        toConvertIntakeItemRequest({
          tasks: breakdownTasks.map((task) =>
            breakdownTaskToConvertInput(task, selectedDetail.id),
          ),
        }),
      );
      const refreshed = await getIntakeItem({
        intakeItemId: selectedDetail.id,
        organizationId,
        spaceId,
      });
      applyIntakeItemUpdate(refreshed);
      await Promise.all([
        refreshIntakeItems(),
        loadIntakeResources(selectedDetail.id),
      ]);
    } catch (error) {
      setDetailErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingConvert(false);
    }
  }

  function applyIntakeItemUpdate(updated: IntakeItem) {
    setIntakeItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelectedDetail((current) =>
      current?.id === updated.id ? updated : current,
    );
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
      <section className="page-heading" aria-labelledby="intake-items-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="intake-items-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{formatSpaceScope(currentSpace, t("page.unknownSpace"))}</span>
          <button
            className="button button--secondary"
            disabled={isLoading}
            onClick={() => void refreshIntakeItems()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            {t("actions.refresh")}
          </button>
        </div>
      </section>

      {errorKey ? <div className="form-alert">{tRoot(errorKey)}</div> : null}

      <section
        className="toolbar-panel intake-toolbar"
        aria-label={t("filters.label")}
      >
        <label className="field">
          <span>{t("filters.status")}</span>
          <select
            onChange={(event) =>
              setStatusFilter(event.target.value as IntakeStatus | "ALL")
            }
            value={statusFilter}
          >
            <option value="ALL">{t("filters.allStatuses")}</option>
            {INTAKE_STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(`status.${item}`)}
              </option>
            ))}
          </select>
        </label>
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

      <div className="intake-layout">
        <section className="panel panel--wide" aria-labelledby="intake-list-title">
          <div className="panel__header">
            <div>
              <h3 id="intake-list-title">{t("list.title")}</h3>
              <p>{t("list.subtitle", { count: intakeItems.length })}</p>
            </div>
          </div>
          {isLoading ? (
            <InlineState label={t("states.loadingList")} />
          ) : intakeItems.length === 0 ? (
            <EmptyState
              title={t("states.empty.title")}
              description={t("states.empty.description")}
            />
          ) : (
            <div
              className="business-table intake-table"
              role="table"
              aria-label={t("list.title")}
            >
              <div
                className="business-table__row business-table__row--head"
                role="row"
              >
                <span role="columnheader">{t("list.columns.title")}</span>
                <span role="columnheader">{t("list.columns.sourceType")}</span>
                <span role="columnheader">{t("list.columns.version")}</span>
                <span role="columnheader">{t("list.columns.requirement")}</span>
                <span role="columnheader">{t("list.columns.reporter")}</span>
                <span role="columnheader">{t("list.columns.assignee")}</span>
                <span role="columnheader">{t("list.columns.priority")}</span>
                <span role="columnheader">{t("list.columns.statusActivity")}</span>
              </div>
              {intakeItems.map((item) => (
                <button
                  className="business-table__row business-table__row--link intake-table__row"
                  key={item.id}
                  onClick={() => void openIntakeItem(item.id)}
                  role="row"
                  type="button"
                >
                  <span role="cell">
                    <strong>{item.title}</strong>
                    <small>{t("list.itemId", { id: item.id })}</small>
                  </span>
                  <span role="cell">{t(`sourceType.${item.sourceType}`)}</span>
                  <span role="cell">
                    {formatVersionName(item.versionId, versions) ??
                      t("list.noVersion")}
                  </span>
                  <span role="cell">
                    {formatRequirementName(item.requirementId, requirements) ??
                      t("list.noRequirement")}
                  </span>
                  <span role="cell">
                    {formatMemberName(item.reporterId, members) ??
                      item.reporterId}
                  </span>
                  <span role="cell">
                    {formatMemberName(item.assigneeId, members) ??
                      t("list.unassigned")}
                  </span>
                  <span role="cell">
                    {item.priority
                      ? t(`priority.${item.priority}`)
                      : t("list.noPriority")}
                  </span>
                  <span role="cell">
                    <span
                      className={`status-pill ${getIntakeStatusClassName(
                        item.status,
                      )}`}
                    >
                      {t(`status.${item.status}`)}
                    </span>
                    <small>
                      {formatDateTime(getIntakeActivityAt(item), locale) ??
                        t("list.noActivityAt")}
                    </small>
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

        {canWriteIntake ? (
          <section className="form-panel" aria-labelledby="intake-create-title">
            <div className="form-panel__header">
              <Plus aria-hidden="true" size={20} strokeWidth={2} />
              <div>
                <h3 id="intake-create-title">{t("create.title")}</h3>
                <p>{t("create.description")}</p>
              </div>
            </div>
            <IntakeForm
              canSubmit={canWriteIntake}
              form={createForm}
              members={members}
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

      {selectedIntakeItemId ? (
        <IntakeDrawer
          areResourcesLoading={areResourcesLoading}
          breakdownTasks={breakdownTasks}
          canWriteIntake={canWriteIntake}
          commentBody={commentBody}
          comments={comments}
          detail={selectedDetail}
          detailCacheKey={detailCacheKey}
          detailErrorKey={detailErrorKey}
          editForm={editForm}
          isDetailLoading={isDetailLoading}
          isSubmittingComment={isSubmittingComment}
          isSubmittingConvert={isSubmittingConvert}
          isSubmittingEdit={isSubmittingEdit}
          locale={locale}
          members={members}
          onBreakdownTasksChange={setBreakdownTasks}
          onClose={closeDrawer}
          onCommentBodyChange={setCommentBody}
          onCommentSubmit={onCommentSubmit}
          onConvertSubmit={onConvertSubmit}
          onEditFormChange={setEditForm}
          onEditSubmit={onEditSubmit}
          onRefreshResources={() =>
            selectedIntakeItemId
              ? void loadIntakeResources(selectedIntakeItemId)
              : undefined
          }
          onStatusAction={(action) => void onStatusAction(action)}
          relatedTasks={relatedTasks}
          relatedTasksCacheKey={relatedTasksCacheKey}
          resourceCacheKey={resourceCacheKey}
          resourceErrorKey={resourceErrorKey}
          requirements={requirements}
          spaceId={spaceId}
          statusAction={statusAction}
          t={t}
          tRoot={tRoot}
          timeline={timeline}
          versions={versions}
        />
      ) : null}
    </div>
  );
}

type IntakeDrawerProps = {
  areResourcesLoading: boolean;
  breakdownTasks: BreakdownTaskFormState[];
  canWriteIntake: boolean;
  commentBody: string;
  comments: Comment[];
  detail: IntakeItem | null;
  detailCacheKey: string;
  detailErrorKey: string | null;
  editForm: IntakeFormState;
  isDetailLoading: boolean;
  isSubmittingComment: boolean;
  isSubmittingConvert: boolean;
  isSubmittingEdit: boolean;
  locale: string;
  members: SpaceMemberWithUser[];
  onBreakdownTasksChange: (tasks: BreakdownTaskFormState[]) => void;
  onClose: () => void;
  onCommentBodyChange: (value: string) => void;
  onCommentSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onConvertSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEditFormChange: (form: IntakeFormState) => void;
  onEditSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRefreshResources: () => void;
  onStatusAction: (action: IntakeStatusAction) => void;
  relatedTasks: WorkItem[];
  relatedTasksCacheKey: string;
  resourceCacheKey: string;
  resourceErrorKey: string | null;
  requirements: Requirement[];
  spaceId: string;
  statusAction: IntakeStatusAction | null;
  t: ReturnType<typeof useTranslations>;
  tRoot: ReturnType<typeof useTranslations>;
  timeline: TimelineEvent[];
  versions: Version[];
};

function IntakeDrawer({
  areResourcesLoading,
  breakdownTasks,
  canWriteIntake,
  commentBody,
  comments,
  detail,
  detailCacheKey,
  detailErrorKey,
  editForm,
  isDetailLoading,
  isSubmittingComment,
  isSubmittingConvert,
  isSubmittingEdit,
  locale,
  members,
  onBreakdownTasksChange,
  onClose,
  onCommentBodyChange,
  onCommentSubmit,
  onConvertSubmit,
  onEditFormChange,
  onEditSubmit,
  onRefreshResources,
  onStatusAction,
  relatedTasks,
  relatedTasksCacheKey,
  resourceCacheKey,
  resourceErrorKey,
  requirements,
  spaceId,
  statusAction,
  t,
  tRoot,
  timeline,
  versions,
}: IntakeDrawerProps) {
  const canConvert =
    canWriteIntake && detail?.status === "ACCEPTED" && !detail.convertedAt;
  const isConverted = detail?.status === "CONVERTED" || Boolean(detail?.convertedAt);

  return (
    <div
      className="work-item-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intake-drawer-title"
    >
      <div className="work-item-drawer__scrim" onClick={onClose} aria-hidden="true" />
      <aside className="work-item-drawer__panel">
        <header className="work-item-drawer__header">
          <div>
            <p className="page-heading__eyebrow">{t("detail.eyebrow")}</p>
            <h3 id="intake-drawer-title">
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
            <section className="subsection" aria-labelledby="intake-meta-title">
              <div className="subsection__header">
                <Inbox aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="intake-meta-title">{t("detail.metaTitle")}</h4>
              </div>
              <dl className="definition-list">
                <DefinitionRow label={t("detail.fields.itemId")}>
                  {detail.id}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.status")}>
                  <span
                    className={`status-pill ${getIntakeStatusClassName(
                      detail.status,
                    )}`}
                  >
                    {t(`status.${detail.status}`)}
                  </span>
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.sourceType")}>
                  {t(`sourceType.${detail.sourceType}`)}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.priority")}>
                  {detail.priority
                    ? t(`priority.${detail.priority}`)
                    : t("list.noPriority")}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.reporter")}>
                  {formatMemberName(detail.reporterId, members) ??
                    detail.reporterId}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.assignee")}>
                  {formatMemberName(detail.assigneeId, members) ??
                    t("list.unassigned")}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.acceptedAt")}>
                  {formatDateTime(detail.acceptedAt, locale) ??
                    t("list.noActivityAt")}
                </DefinitionRow>
                <DefinitionRow label={t("detail.fields.convertedAt")}>
                  {formatDateTime(detail.convertedAt, locale) ??
                    t("list.noActivityAt")}
                </DefinitionRow>
              </dl>
            </section>

            <section className="subsection" aria-labelledby="intake-trace-title">
              <div className="subsection__header">
                <Link2 aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="intake-trace-title">{t("trace.title")}</h4>
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
              </div>
              {detail.sourceObject ? (
                <pre className="source-object-preview">
                  {JSON.stringify(detail.sourceObject, null, 2)}
                </pre>
              ) : (
                <p className="muted-text">{t("trace.noSourceObject")}</p>
              )}
            </section>

            <section className="subsection" aria-labelledby="intake-action-title">
              <div className="subsection__header">
                <ListChecks aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="intake-action-title">{t("statusActions.title")}</h4>
              </div>
              {canWriteIntake ? (
                <div className="intake-action-row">
                  <button
                    className="button button--secondary"
                    disabled={statusAction !== null || isConverted}
                    onClick={() => onStatusAction("accept")}
                    type="button"
                  >
                    <Check aria-hidden="true" size={16} strokeWidth={2} />
                    {statusAction === "accept"
                      ? t("statusActions.accepting")
                      : t("statusActions.accept")}
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={statusAction !== null || isConverted}
                    onClick={() => onStatusAction("defer")}
                    type="button"
                  >
                    <PauseCircle aria-hidden="true" size={16} strokeWidth={2} />
                    {statusAction === "defer"
                      ? t("statusActions.deferring")
                      : t("statusActions.defer")}
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={statusAction !== null || isConverted}
                    onClick={() => onStatusAction("reject")}
                    type="button"
                  >
                    <Ban aria-hidden="true" size={16} strokeWidth={2} />
                    {statusAction === "reject"
                      ? t("statusActions.rejecting")
                      : t("statusActions.reject")}
                  </button>
                </div>
              ) : (
                <p className="muted-text">{t("permissions.actionReadonly")}</p>
              )}
            </section>

            <section className="subsection" aria-labelledby="intake-edit-title">
              <div className="subsection__header">
                <Pencil aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="intake-edit-title">{t("edit.title")}</h4>
              </div>
              {canWriteIntake ? (
                <IntakeForm
                  canSubmit={canWriteIntake}
                  form={editForm}
                  members={members}
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

            <section className="subsection" aria-labelledby="intake-convert-title">
              <div className="subsection__header">
                <SplitSquareHorizontal aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="intake-convert-title">{t("convert.title")}</h4>
              </div>
              <BreakdownForm
                canSubmit={canConvert}
                isConverted={isConverted}
                isSubmitting={isSubmittingConvert}
                members={members}
                onChange={onBreakdownTasksChange}
                onSubmit={onConvertSubmit}
                requirements={requirements}
                t={t}
                tasks={breakdownTasks}
                versions={versions}
              />
            </section>

            <section
              className="subsection"
              aria-labelledby="intake-related-tasks-title"
              data-cache-key={relatedTasksCacheKey}
            >
              <div className="subsection__header">
                <ListChecks aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="intake-related-tasks-title">{t("relatedTasks.title")}</h4>
              </div>
              <RelatedTaskList
                locale={locale}
                relatedTasks={relatedTasks}
                spaceId={spaceId}
                t={t}
              />
            </section>

            <section className="subsection" aria-labelledby="intake-comments-title">
              <div className="subsection__header">
                <MessageSquare aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="intake-comments-title">{t("comments.title")}</h4>
              </div>
              {canWriteIntake ? (
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

            <section
              className="subsection"
              aria-labelledby="intake-timeline-title"
              data-cache-key={resourceCacheKey}
            >
              <div className="subsection__header">
                <Clock3 aria-hidden="true" size={16} strokeWidth={2} />
                <h4 id="intake-timeline-title">{t("timeline.title")}</h4>
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

type IntakeFormProps = {
  canSubmit: boolean;
  form: IntakeFormState;
  members: SpaceMemberWithUser[];
  onChange: (form: IntakeFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  requirements: Requirement[];
  submitIcon: ReactNode;
  submitLabel: string;
  t: ReturnType<typeof useTranslations>;
  versions: Version[];
};

function IntakeForm({
  canSubmit,
  form,
  members,
  onChange,
  onSubmit,
  requirements,
  submitIcon,
  submitLabel,
  t,
  versions,
}: IntakeFormProps) {
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
          <span>{t("form.sourceType")}</span>
          <select
            onChange={(event) =>
              onChange({
                ...form,
                sourceType: event.target.value as IntakeSourceType,
              })
            }
            value={form.sourceType}
          >
            {SOURCE_TYPES.map((sourceType) => (
              <option key={sourceType} value={sourceType}>
                {t(`sourceType.${sourceType}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("form.priority")}</span>
          <select
            onChange={(event) =>
              onChange({ ...form, priority: event.target.value as Priority | "" })
            }
            value={form.priority}
          >
            <option value="">{t("form.noPriority")}</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`priority.${priority}`)}
              </option>
            ))}
          </select>
        </label>
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
          <span>{t("form.sourceObject")}</span>
          <textarea
            maxLength={8000}
            onChange={(event) =>
              onChange({ ...form, sourceObject: event.target.value })
            }
            rows={3}
            value={form.sourceObject}
          />
        </label>
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

type BreakdownFormProps = {
  canSubmit: boolean;
  isConverted: boolean;
  isSubmitting: boolean;
  members: SpaceMemberWithUser[];
  onChange: (tasks: BreakdownTaskFormState[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  requirements: Requirement[];
  t: ReturnType<typeof useTranslations>;
  tasks: BreakdownTaskFormState[];
  versions: Version[];
};

function BreakdownForm({
  canSubmit,
  isConverted,
  isSubmitting,
  members,
  onChange,
  onSubmit,
  requirements,
  t,
  tasks,
  versions,
}: BreakdownFormProps) {
  function updateTask(index: number, patch: Partial<BreakdownTaskFormState>) {
    onChange(
      tasks.map((task, taskIndex) =>
        taskIndex === index ? { ...task, ...patch } : task,
      ),
    );
  }

  function addTask() {
    onChange([...tasks, createEmptyBreakdownTask()]);
  }

  function removeTask(index: number) {
    if (tasks.length === 1) {
      return;
    }

    onChange(tasks.filter((_, taskIndex) => taskIndex !== index));
  }

  return (
    <form className="business-form" onSubmit={onSubmit}>
      <div className="task-breakdown-list">
        {tasks.map((task, index) => (
          <fieldset className="task-breakdown-item" key={index}>
            <legend>
              {t("convert.taskLegend", {
                index: index + 1,
              })}
            </legend>
            <label className="field">
              <span>{t("taskForm.title")}</span>
              <input
                maxLength={200}
                onChange={(event) =>
                  updateTask(index, { title: event.target.value })
                }
                required
                value={task.title}
              />
            </label>
            <label className="field">
              <span>{t("taskForm.description")}</span>
              <textarea
                maxLength={8000}
                onChange={(event) =>
                  updateTask(index, { description: event.target.value })
                }
                rows={3}
                value={task.description}
              />
            </label>
            <div className="form-grid form-grid--two">
              <label className="field">
                <span>{t("taskForm.version")}</span>
                <select
                  onChange={(event) =>
                    updateTask(index, {
                      requirementId: "",
                      versionId: event.target.value,
                    })
                  }
                  value={task.versionId}
                >
                  <option value="">{t("taskForm.noVersion")}</option>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("taskForm.requirement")}</span>
                <select
                  onChange={(event) =>
                    updateTask(index, { requirementId: event.target.value })
                  }
                  value={task.requirementId}
                >
                  <option value="">{t("taskForm.noRequirement")}</option>
                  {requirements
                    .filter(
                      (requirement) =>
                        !task.versionId ||
                        requirement.versionId === task.versionId,
                    )
                    .map((requirement) => (
                      <option key={requirement.id} value={requirement.id}>
                        {requirement.title || t("list.untitledRequirement")}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>{t("taskForm.assignee")}</span>
                <select
                  onChange={(event) =>
                    updateTask(index, { assigneeId: event.target.value })
                  }
                  value={task.assigneeId}
                >
                  <option value="">{t("taskForm.unassigned")}</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {formatMember(member)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("taskForm.priority")}</span>
                <select
                  onChange={(event) =>
                    updateTask(index, {
                      priority: event.target.value as Priority,
                    })
                  }
                  value={task.priority}
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {t(`priority.${priority}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("taskForm.dueDate")}</span>
                <input
                  onChange={(event) =>
                    updateTask(index, { dueDate: event.target.value })
                  }
                  type="datetime-local"
                  value={task.dueDate}
                />
              </label>
            </div>
            <div className="form-actions">
              <button
                className="button button--secondary"
                disabled={tasks.length === 1}
                onClick={() => removeTask(index)}
                type="button"
              >
                {t("convert.removeTask")}
              </button>
            </div>
          </fieldset>
        ))}
      </div>
      <div className="form-actions">
        <button className="button button--secondary" onClick={addTask} type="button">
          <Plus aria-hidden="true" size={16} strokeWidth={2} />
          {t("convert.addTask")}
        </button>
        <button
          className="button button--primary"
          disabled={!canSubmit || isSubmitting}
          type="submit"
        >
          <SplitSquareHorizontal aria-hidden="true" size={16} strokeWidth={2} />
          {isSubmitting ? t("convert.submitting") : t("convert.submit")}
        </button>
        {!canSubmit ? (
          <span className="form-actions__hint">
            {isConverted
              ? t("convert.alreadyConverted")
              : t("convert.acceptedRequired")}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function RelatedTaskList({
  locale,
  relatedTasks,
  spaceId,
  t,
}: {
  locale: string;
  relatedTasks: WorkItem[];
  spaceId: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (relatedTasks.length === 0) {
    return (
      <div>
        <EmptyState
          title={t("relatedTasks.empty.title")}
          description={t("relatedTasks.empty.description")}
        />
        <div className="form-actions intake-related-actions">
          <Link className="button button--secondary" href={`/spaces/${spaceId}/work-items`}>
            <ListChecks aria-hidden="true" size={16} strokeWidth={2} />
            {t("relatedTasks.openTaskList")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="related-list" role="list">
      {relatedTasks.map((task) => (
        <Link
          className="related-list__item related-list__item--link"
          href={`/spaces/${spaceId}/work-items`}
          key={task.id}
          role="listitem"
        >
          <ListChecks aria-hidden="true" size={16} strokeWidth={2} />
          <div>
            <span>{task.title}</span>
            <small>
              {t("relatedTasks.meta", {
                dueDate: formatDateTime(task.dueDate, locale) ?? t("list.noDueDate"),
                priority: t(`priority.${task.priority}`),
                status: t(`statusCategory.${task.statusCategory}`),
              })}
            </small>
          </div>
        </Link>
      ))}
    </div>
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
    <div className="activity-list work-item-timeline" role="list">
      {timeline.map((event) => (
        <article className="activity-list__item" key={event.id} role="listitem">
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
        </article>
      ))}
    </div>
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

function createEmptyIntakeForm(): IntakeFormState {
  return {
    assigneeId: "",
    description: "",
    priority: "MEDIUM",
    requirementId: "",
    sourceObject: "",
    sourceType: "AD_HOC",
    title: "",
    versionId: "",
  };
}

function createEmptyBreakdownTask(
  intakeItem?: IntakeItem,
): BreakdownTaskFormState {
  return {
    assigneeId: intakeItem?.assigneeId ?? "",
    description: "",
    dueDate: "",
    priority: intakeItem?.priority ?? "MEDIUM",
    requirementId: intakeItem?.requirementId ?? "",
    title: "",
    versionId: intakeItem?.versionId ?? "",
  };
}

function intakeItemToFormState(item: IntakeItem): IntakeFormState {
  return {
    assigneeId: item.assigneeId ?? "",
    description: item.description ?? "",
    priority: item.priority ?? "",
    requirementId: item.requirementId ?? "",
    sourceObject: item.sourceObject
      ? JSON.stringify(item.sourceObject, null, 2)
      : "",
    sourceType: item.sourceType,
    title: item.title,
    versionId: item.versionId ?? "",
  };
}

function intakeFormToInput(form: IntakeFormState) {
  return {
    assigneeId: form.assigneeId,
    description: form.description,
    priority: form.priority,
    requirementId: form.requirementId,
    sourceObject: form.sourceObject,
    sourceType: form.sourceType,
    title: form.title,
    versionId: form.versionId,
  };
}

function breakdownTaskToConvertInput(
  task: BreakdownTaskFormState,
  intakeItemId: string,
) {
  const parsed = createTaskFormSchema.parse({
    assigneeId: task.assigneeId,
    description: task.description,
    dueDate: toIsoDateTime(task.dueDate),
    intakeItemId,
    priority: task.priority,
    requirementId: task.requirementId,
    title: task.title,
    type: "TASK",
    versionId: task.versionId,
  });

  return {
    assigneeId: parsed.assigneeId,
    description: parsed.description,
    dueDate: parsed.dueDate,
    priority: parsed.priority,
    requirementId: parsed.requirementId,
    title: parsed.title,
    versionId: parsed.versionId,
    workflowVersionId: parsed.workflowVersionId,
  };
}

function toIsoDateTime(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function formatSpaceScope(space: SessionSpaceSummary, fallback: string) {
  return space.name || space.code || fallback;
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

  return member ? formatMember(member) : undefined;
}

function getIntakeActivityAt(item: IntakeItem) {
  return item.updatedAt ?? item.convertedAt ?? item.acceptedAt;
}

function getIntakeStatusClassName(status: IntakeStatus) {
  if (status === "REJECTED") {
    return "status-pill--warning";
  }

  if (status === "PENDING" || status === "DEFERRED") {
    return "status-pill--neutral";
  }

  return "";
}

function formatDateTime(value: string | undefined, locale: string) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNow(locale: string) {
  return formatDateTime(new Date().toISOString(), locale) ?? "";
}
