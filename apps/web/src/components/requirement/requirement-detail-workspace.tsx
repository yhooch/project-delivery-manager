"use client";

import type {
  AttachmentRef,
  Priority,
  Requirement,
  RequirementRelatedWorkItemSummary,
  SpaceMemberWithUser,
  SpaceRole,
  UpdateRequirementRequest,
  Version,
} from "@project-delivery/shared";
import {
  Archive,
  Bug,
  CircleAlert,
  GitBranch,
  Loader2,
  Save,
  Split,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  archiveRequirement,
  getRequirement,
  listRequirementAssignableMembers,
  listRequirementVersions,
  updateRequirement,
} from "../../lib/requirement-service";
import { useSession } from "../providers/session-provider";
import {
  RequirementContentEditorSlot,
  createContentEditorValue,
  type RequirementContentEditorValue,
} from "./requirement-content-editor-slot";

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const REQUIREMENT_WRITER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);

type RequirementDetailWorkspaceProps = {
  requirementId: string;
};

type RequirementFormState = {
  content: RequirementContentEditorValue;
  ownerId: string;
  priority: Priority | "";
  summary: string;
  title: string;
  versionId: string;
};

export function RequirementDetailWorkspace({
  requirementId,
}: RequirementDetailWorkspaceProps) {
  const t = useTranslations("requirements");
  const tRoot = useTranslations();
  const { session, status } = useSession();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [form, setForm] = useState<RequirementFormState>(
    createEmptyRequirementForm(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const currentSpace = useMemo(
    () =>
      requirement
        ? session?.spaces.find((space) => space.id === requirement.spaceId)
        : session?.spaces.find((space) => space.id === session.defaultSpaceId),
    [requirement, session],
  );
  const organizationId =
    requirement?.organizationId ??
    currentSpace?.organizationId ??
    session?.defaultOrganizationId;
  const spaceId = requirement?.spaceId ?? currentSpace?.id;
  const canEditRequirement =
    requirement?.status !== "ARCHIVED" &&
    currentSpace !== undefined &&
    REQUIREMENT_WRITER_ROLES.has(currentSpace.role);
  const requestKey = useMemo(
    () =>
      [
        organizationId ?? "no-organization",
        spaceId ?? "no-space",
        requirementId,
      ].join(":"),
    [organizationId, requirementId, spaceId],
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
        const nextRequirement = await getRequirement({
          organizationId,
          requirementId,
          spaceId,
        });
        const [versionPage, memberPage] = await Promise.all([
          listRequirementVersions({
            organizationId: nextRequirement.organizationId,
            spaceId: nextRequirement.spaceId,
          }),
          listRequirementAssignableMembers({
            organizationId: nextRequirement.organizationId,
            spaceId: nextRequirement.spaceId,
          }),
        ]);

        if (!isActive) {
          return;
        }

        setRequirement(nextRequirement);
        setVersions(versionPage.items);
        setMembers(memberPage.items);
        setForm(requirementToFormState(nextRequirement));
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
  }, [organizationId, requestKey, requirementId, spaceId, status]);

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!requirement || !canEditRequirement) {
      return;
    }

    setIsSaving(true);
    setErrorKey(null);

    try {
      const nextRequirement = await updateRequirement(
        {
          organizationId: requirement.organizationId,
          requirementId: requirement.id,
          spaceId: requirement.spaceId,
        },
        formStateToSaveRequest(form),
      );
      setRequirement(nextRequirement);
      setForm(requirementToFormState(nextRequirement));
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function onArchive() {
    if (!requirement || !canEditRequirement) {
      return;
    }

    setIsArchiving(true);
    setErrorKey(null);

    try {
      const nextRequirement = await archiveRequirement({
        organizationId: requirement.organizationId,
        requirementId: requirement.id,
        spaceId: requirement.spaceId,
      });
      setRequirement(nextRequirement);
      setForm(requirementToFormState(nextRequirement));
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsArchiving(false);
    }
  }

  if (status === "loading" || isLoading) {
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

  if (!requirement && errorKey) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.loadFailed.title")}
        description={tRoot(errorKey)}
      />
    );
  }

  if (!requirement) {
    return (
      <StatePanel
        icon="warning"
        title={t("states.loadFailed.title")}
        description={t("states.loadFailed.description")}
      />
    );
  }

  return (
    <div className="workbench-page">
      <section className="page-heading" aria-labelledby="requirement-heading">
        <div>
          <p className="page-heading__eyebrow">{t("detail.eyebrow")}</p>
          <h2 className="page-heading__title" id="requirement-heading">
            {requirement.title || t("detail.untitledDraft")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{t(`status.${requirement.status}`)}</span>
          <Link
            className="button button--secondary"
            href={`/spaces/${requirement.spaceId}/requirements`}
          >
            <GitBranch aria-hidden="true" size={16} strokeWidth={2} />
            {t("detail.backToList")}
          </Link>
        </div>
      </section>

      {errorKey ? <div className="form-alert">{tRoot(errorKey)}</div> : null}

      <form className="requirement-detail-layout" onSubmit={onSave}>
        <section className="panel panel--wide" aria-labelledby="requirement-form-title">
          <div className="panel__header">
            <div>
              <h3 id="requirement-form-title">{t("detail.formTitle")}</h3>
              <p>{t("detail.formDescription")}</p>
            </div>
          </div>
          <div className="business-form">
            <label className="field">
              <span>{t("form.title")}</span>
              <input
                disabled={!canEditRequirement}
                maxLength={200}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                required
                value={form.title}
              />
            </label>
            <label className="field">
              <span>{t("form.summary")}</span>
              <textarea
                disabled={!canEditRequirement}
                maxLength={2000}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    summary: event.target.value,
                  }))
                }
                rows={3}
                value={form.summary}
              />
            </label>
            <div className="form-grid form-grid--three">
              <label className="field">
                <span>{t("form.version")}</span>
                <select
                  disabled={!canEditRequirement}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      versionId: event.target.value,
                    }))
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
                <span>{t("form.owner")}</span>
                <select
                  disabled={!canEditRequirement}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      ownerId: event.target.value,
                    }))
                  }
                  value={form.ownerId}
                >
                  <option value="">{t("form.noOwner")}</option>
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
                  disabled={!canEditRequirement}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priority: event.target.value as Priority | "",
                    }))
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
            </div>
            <RequirementContentEditorSlot
              attachmentCount={requirement.attachments?.length ?? 0}
              canUploadImages={
                canEditRequirement && requirement.status === "DRAFT"
              }
              disabled={!canEditRequirement}
              onAttachmentUploaded={(attachment) =>
                setRequirement((current) =>
                  current
                    ? {
                        ...current,
                        attachments: appendAttachmentRef(
                          current.attachments,
                          attachment,
                        ),
                      }
                    : current,
                )
              }
              onChange={(content) =>
                setForm((current) => ({
                  ...current,
                  content,
                }))
              }
              requirementId={requirement.id}
              value={form.content}
            />
            <div className="form-actions">
              <button
                className="button button--primary"
                disabled={!canEditRequirement || isSaving}
                type="submit"
              >
                <Save aria-hidden="true" size={16} strokeWidth={2} />
                {isSaving ? t("detail.saving") : t("detail.save")}
              </button>
              <button
                className="button button--secondary"
                disabled={!canEditRequirement || isArchiving}
                onClick={() => void onArchive()}
                type="button"
              >
                <Archive aria-hidden="true" size={16} strokeWidth={2} />
                {isArchiving ? t("detail.archiving") : t("detail.archive")}
              </button>
              {!canEditRequirement ? (
                <span className="form-actions__hint">{t("form.readonly")}</span>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="detail-aside">
          <section className="panel" aria-labelledby="requirement-meta-title">
            <div className="panel__header">
              <div>
                <h3 id="requirement-meta-title">{t("detail.metaTitle")}</h3>
                <p>{t("detail.metaDescription")}</p>
              </div>
            </div>
            <dl className="definition-list">
              <div>
                <dt>{t("list.columns.version")}</dt>
                <dd>
                  {formatVersionName(requirement.versionId, versions) ??
                    t("list.noVersion")}
                </dd>
              </div>
              <div>
                <dt>{t("list.columns.owner")}</dt>
                <dd>
                  {formatOwnerName(requirement.ownerId, members) ??
                    t("list.noOwner")}
                </dd>
              </div>
              <div>
                <dt>{t("list.columns.priority")}</dt>
                <dd>
                  {requirement.priority
                    ? t(`priority.${requirement.priority}`)
                    : t("list.noPriority")}
                </dd>
              </div>
              <div>
                <dt>{t("detail.attachments")}</dt>
                <dd>{requirement.attachments?.length ?? 0}</dd>
              </div>
            </dl>
          </section>
          <RelatedWorkItemsPanel requirement={requirement} t={t} />
        </aside>
      </form>
    </div>
  );
}

type RelatedWorkItemsPanelProps = {
  requirement: Requirement;
  t: ReturnType<typeof useTranslations>;
};

function RelatedWorkItemsPanel({ requirement, t }: RelatedWorkItemsPanelProps) {
  const related = requirement.relatedWorkItems;

  return (
    <section className="panel" aria-labelledby="related-work-items-title">
      <div className="panel__header">
        <div>
          <h3 id="related-work-items-title">{t("relatedWorkItems.title")}</h3>
          <p>{t("relatedWorkItems.description")}</p>
        </div>
      </div>
      <div className="compact-metric-grid compact-metric-grid--two">
        <div className="compact-metric">
          <span>{t("relatedWorkItems.tasks")}</span>
          <strong>{related.taskCount}</strong>
        </div>
        <div className="compact-metric">
          <span>{t("relatedWorkItems.bugs")}</span>
          <strong>{related.bugCount}</strong>
        </div>
      </div>
      {related.tasks.length === 0 && related.bugs.length === 0 ? (
        <div className="empty-state empty-state--compact">
          <strong>{t("relatedWorkItems.emptyTitle")}</strong>
          <span>{t("relatedWorkItems.emptyDescription")}</span>
        </div>
      ) : (
        <div className="related-list">
          {related.tasks.map((item) => (
            <RelatedWorkItemRow
              icon="task"
              item={item}
              key={item.id}
              t={t}
            />
          ))}
          {related.bugs.map((item) => (
            <RelatedWorkItemRow icon="bug" item={item} key={item.id} t={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function RelatedWorkItemRow({
  icon,
  item,
  t,
}: {
  icon: "bug" | "task";
  item: RequirementRelatedWorkItemSummary;
  t: ReturnType<typeof useTranslations>;
}) {
  const Icon = icon === "bug" ? Bug : Split;

  return (
    <div className="related-list__item">
      <Icon aria-hidden="true" size={16} strokeWidth={2} />
      <div>
        <span>{item.title}</span>
        <small>
          {item.statusCategory
            ? t(`statusCategory.${item.statusCategory}`)
            : t("relatedWorkItems.noStatus")}
        </small>
      </div>
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

function createEmptyRequirementForm(): RequirementFormState {
  return {
    content: createContentEditorValue({}),
    ownerId: "",
    priority: "",
    summary: "",
    title: "",
    versionId: "",
  };
}

function requirementToFormState(requirement: Requirement): RequirementFormState {
  return {
    content: createContentEditorValue({
      contentJson: requirement.contentJson,
      contentMarkdownCache: requirement.contentMarkdownCache,
      contentText: requirement.contentText,
    }),
    ownerId: requirement.ownerId ?? "",
    priority: requirement.priority ?? "",
    summary: requirement.summary ?? "",
    title: requirement.title,
    versionId: requirement.versionId ?? "",
  };
}

function formStateToSaveRequest(
  form: RequirementFormState,
): UpdateRequirementRequest {
  return {
    contentJson: form.content.contentJson,
    contentMarkdownCache: optionalText(form.content.contentMarkdownCache ?? ""),
    contentText: optionalText(form.content.contentText),
    ownerId: optionalText(form.ownerId),
    priority: form.priority || undefined,
    summary: optionalText(form.summary),
    title: form.title.trim(),
    versionId: optionalText(form.versionId),
  };
}

function appendAttachmentRef(
  current: AttachmentRef[] | undefined,
  attachment: AttachmentRef,
): AttachmentRef[] {
  const attachments = current ?? [];

  if (attachments.some((item) => item.id === attachment.id)) {
    return attachments;
  }

  return [...attachments, attachment];
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function formatMember(member: SpaceMemberWithUser) {
  return `${member.user.name} (${member.user.username})`;
}

function formatOwnerName(
  ownerId: string | undefined,
  members: SpaceMemberWithUser[],
) {
  if (!ownerId) {
    return undefined;
  }

  const member = members.find((item) => item.userId === ownerId);

  return member ? formatMember(member) : ownerId;
}

function formatVersionName(versionId: string | undefined, versions: Version[]) {
  if (!versionId) {
    return undefined;
  }

  return versions.find((version) => version.id === versionId)?.name ?? versionId;
}
