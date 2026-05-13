"use client";

import type {
  CreateVersionRequest,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  SpaceRole,
  Version,
  VersionStatus,
} from "@project-delivery/shared";
import {
  CircleAlert,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Save,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Link } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createVersion,
  listVersionAssignableMembers,
  listVersions,
  updateVersion,
} from "../../lib/version-service";
import { useSession } from "../providers/session-provider";

const VERSION_STATUSES: VersionStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "RELEASED",
  "ARCHIVED",
];

const VERSION_MANAGER_ROLES = new Set<SpaceRole>(["SPACE_ADMIN", "PM"]);

type VersionWorkspaceProps = {
  spaceId: string;
};

type VersionFormState = {
  description: string;
  name: string;
  ownerId: string;
  releaseDate: string;
  startDate: string;
  status: VersionStatus;
  target: string;
  targetDate: string;
};

export function VersionWorkspace({ spaceId }: VersionWorkspaceProps) {
  const t = useTranslations("versions");
  const tRoot = useTranslations();
  const locale = useLocale();
  const { session, status } = useSession();
  const [versions, setVersions] = useState<Version[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<VersionStatus | "ALL">("ALL");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingUpdate, setIsSubmittingUpdate] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<VersionFormState>(
    createEmptyVersionForm(),
  );
  const [editForm, setEditForm] = useState<VersionFormState>(
    createEmptyVersionForm(),
  );

  const currentSpace = useMemo(
    () => session?.spaces.find((space) => space.id === spaceId),
    [session, spaceId],
  );
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;
  const canEditVersions =
    currentSpace !== undefined && VERSION_MANAGER_ROLES.has(currentSpace.role);
  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId),
    [selectedVersionId, versions],
  );
  const requestKey = useMemo(
    () =>
      [
        organizationId ?? "no-organization",
        spaceId,
        statusFilter,
        ownerFilter || "all-owners",
      ].join(":"),
    [organizationId, ownerFilter, spaceId, statusFilter],
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
        const [versionPage, memberPage] = await Promise.all([
          listVersions({
            organizationId,
            ownerId: ownerFilter || undefined,
            page: 1,
            pageSize: 100,
            spaceId,
            status: statusFilter === "ALL" ? undefined : statusFilter,
          }),
          listVersionAssignableMembers({
            organizationId,
            spaceId,
          }),
        ]);

        if (!isActive) {
          return;
        }

        setVersions(versionPage.items);
        setMembers(memberPage.items);
        setSelectedVersionId((current) => {
          if (current && versionPage.items.some((item) => item.id === current)) {
            return current;
          }

          return versionPage.items[0]?.id ?? null;
        });
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
  }, [organizationId, ownerFilter, requestKey, spaceId, status, statusFilter]);

  useEffect(() => {
    if (!selectedVersion) {
      setEditForm(createEmptyVersionForm());
      return;
    }

    setEditForm(versionToFormState(selectedVersion));
  }, [selectedVersion]);

  async function refreshVersions() {
    if (status !== "authenticated") {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const versionPage = await listVersions({
        organizationId,
        ownerId: ownerFilter || undefined,
        page: 1,
        pageSize: 100,
        spaceId,
        status: statusFilter === "ALL" ? undefined : statusFilter,
      });
      setVersions(versionPage.items);
      setSelectedVersionId((current) => {
        if (current && versionPage.items.some((item) => item.id === current)) {
          return current;
        }

        return versionPage.items[0]?.id ?? null;
      });
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function onCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canEditVersions) {
      return;
    }

    setIsSubmittingCreate(true);
    setErrorKey(null);

    try {
      const version = await createVersion(
        {
          organizationId,
          spaceId,
        },
        formStateToCreateRequest(createForm),
      );
      setVersions((current) => [version, ...current]);
      setSelectedVersionId(version.id);
      setCreateForm(createEmptyVersionForm());
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingCreate(false);
    }
  }

  async function onUpdateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedVersion || !canEditVersions) {
      return;
    }

    setIsSubmittingUpdate(true);
    setErrorKey(null);

    try {
      const version = await updateVersion(
        {
          organizationId,
          spaceId,
          versionId: selectedVersion.id,
        },
        formStateToCreateRequest(editForm),
      );
      setVersions((current) =>
        current.map((item) => (item.id === version.id ? version : item)),
      );
      setSelectedVersionId(version.id);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsSubmittingUpdate(false);
    }
  }

  if (status === "loading") {
    return <StatePanel icon="loading" title={t("states.loading.title")} description={t("states.loading.description")} />;
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

  return (
    <div className="workbench-page">
      <section className="page-heading" aria-labelledby="versions-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="versions-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{formatSpaceScope(currentSpace, t("page.unknownSpace"))}</span>
          <button
            className="button button--secondary"
            disabled={isLoading}
            onClick={() => void refreshVersions()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            {t("actions.refresh")}
          </button>
        </div>
      </section>

      {errorKey ? <div className="form-alert">{tRoot(errorKey)}</div> : null}

      <section className="toolbar-panel" aria-label={t("filters.label")}>
        <label className="field">
          <span>{t("filters.status")}</span>
          <select
            onChange={(event) =>
              setStatusFilter(event.target.value as VersionStatus | "ALL")
            }
            value={statusFilter}
          >
            <option value="ALL">{t("filters.allStatuses")}</option>
            {VERSION_STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(`status.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("filters.owner")}</span>
          <select
            onChange={(event) => setOwnerFilter(event.target.value)}
            value={ownerFilter}
          >
            <option value="">{t("filters.allOwners")}</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {formatMember(member)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="workbench-grid">
        <section className="panel" aria-labelledby="version-list-title">
          <div className="panel__header">
            <div>
              <h3 id="version-list-title">{t("list.title")}</h3>
              <p>{t("list.subtitle", { count: versions.length })}</p>
            </div>
          </div>
          {isLoading ? (
            <InlineState label={t("states.loadingList")} />
          ) : versions.length === 0 ? (
            <EmptyState
              title={t("states.empty.title")}
              description={t("states.empty.description")}
            />
          ) : (
            <div className="entity-list" role="list">
              {versions.map((version) => (
                <button
                  aria-current={
                    selectedVersionId === version.id ? "true" : undefined
                  }
                  className="entity-list__item"
                  key={version.id}
                  onClick={() => setSelectedVersionId(version.id)}
                  type="button"
                >
                  <span className="entity-list__title">{version.name}</span>
                  <span className="entity-list__meta">
                    {t(`status.${version.status}`)}
                  </span>
                  <span className="entity-list__meta">
                    {t("list.requirements", {
                      count: version.stats.requirementCount,
                    })}
                  </span>
                  <span className="entity-list__meta">
                    {formatDate(version.releaseDate, locale) ??
                      t("list.noReleaseDate")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="form-panel" aria-labelledby="version-create-title">
          <div className="form-panel__header">
            <Plus aria-hidden="true" size={20} strokeWidth={2} />
            <div>
              <h3 id="version-create-title">{t("create.title")}</h3>
              <p>{t("create.description")}</p>
            </div>
          </div>
          <VersionForm
            canSubmit={canEditVersions}
            form={createForm}
            members={members}
            onChange={setCreateForm}
            onSubmit={onCreateSubmit}
            submitIcon={<Plus aria-hidden="true" size={16} strokeWidth={2} />}
            submitLabel={
              isSubmittingCreate
                ? t("create.submitting")
                : t("create.submit")
            }
            t={t}
          />
        </section>

        <section className="panel panel--wide" aria-labelledby="version-detail-title">
          <div className="panel__header">
            <div>
              <h3 id="version-detail-title">{t("detail.title")}</h3>
              <p>{t("detail.description")}</p>
            </div>
            {selectedVersion ? (
              <Link
                className="button button--secondary"
                href={`/spaces/${spaceId}/requirements?versionId=${selectedVersion.id}`}
              >
                <GitBranch aria-hidden="true" size={16} strokeWidth={2} />
                {t("detail.viewRequirements")}
              </Link>
            ) : null}
          </div>
          {selectedVersion ? (
            <>
              <VersionStats version={selectedVersion} t={t} />
              <VersionForm
                canSubmit={canEditVersions}
                form={editForm}
                members={members}
                onChange={setEditForm}
                onSubmit={onUpdateSubmit}
                submitIcon={<Save aria-hidden="true" size={16} strokeWidth={2} />}
                submitLabel={
                  isSubmittingUpdate
                    ? t("detail.submitting")
                    : t("detail.submit")
                }
                t={t}
              />
            </>
          ) : (
            <EmptyState
              title={t("states.noSelection.title")}
              description={t("states.noSelection.description")}
            />
          )}
        </section>
      </div>
    </div>
  );
}

type VersionFormProps = {
  canSubmit: boolean;
  form: VersionFormState;
  members: SpaceMemberWithUser[];
  onChange: (form: VersionFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitIcon: ReactNode;
  submitLabel: string;
  t: ReturnType<typeof useTranslations>;
};

function VersionForm({
  canSubmit,
  form,
  members,
  onChange,
  onSubmit,
  submitIcon,
  submitLabel,
  t,
}: VersionFormProps) {
  return (
    <form className="business-form" onSubmit={onSubmit}>
      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{t("form.name")}</span>
          <input
            maxLength={120}
            onChange={(event) =>
              onChange({ ...form, name: event.target.value })
            }
            required
            value={form.name}
          />
        </label>
        <label className="field">
          <span>{t("form.status")}</span>
          <select
            onChange={(event) =>
              onChange({
                ...form,
                status: event.target.value as VersionStatus,
              })
            }
            value={form.status}
          >
            {VERSION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>{t("form.target")}</span>
        <textarea
          maxLength={2000}
          onChange={(event) =>
            onChange({ ...form, target: event.target.value })
          }
          rows={3}
          value={form.target}
        />
      </label>
      <label className="field">
        <span>{t("form.description")}</span>
        <textarea
          maxLength={2000}
          onChange={(event) =>
            onChange({ ...form, description: event.target.value })
          }
          rows={3}
          value={form.description}
        />
      </label>
      <div className="form-grid form-grid--two">
        <label className="field">
          <span>{t("form.owner")}</span>
          <select
            onChange={(event) =>
              onChange({ ...form, ownerId: event.target.value })
            }
            value={form.ownerId}
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
          <span>{t("form.startDate")}</span>
          <input
            onChange={(event) =>
              onChange({ ...form, startDate: event.target.value })
            }
            type="datetime-local"
            value={form.startDate}
          />
        </label>
        <label className="field">
          <span>{t("form.targetDate")}</span>
          <input
            onChange={(event) =>
              onChange({ ...form, targetDate: event.target.value })
            }
            type="datetime-local"
            value={form.targetDate}
          />
        </label>
        <label className="field">
          <span>{t("form.releaseDate")}</span>
          <input
            onChange={(event) =>
              onChange({ ...form, releaseDate: event.target.value })
            }
            type="datetime-local"
            value={form.releaseDate}
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

type VersionStatsProps = {
  t: ReturnType<typeof useTranslations>;
  version: Version;
};

function VersionStats({ t, version }: VersionStatsProps) {
  const stats = [
    {
      key: "requirements",
      value: version.stats.requirementCount,
    },
    {
      key: "tasks",
      value: version.stats.taskCount,
    },
    {
      key: "bugs",
      value: version.stats.bugCount,
    },
    {
      key: "blocked",
      value: version.stats.blockedCount,
    },
  ] as const;

  return (
    <div className="compact-metric-grid" aria-label={t("stats.label")}>
      {stats.map((item) => (
        <div className="compact-metric" key={item.key}>
          <span>{t(`stats.${item.key}`)}</span>
          <strong>{item.value}</strong>
        </div>
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

function createEmptyVersionForm(): VersionFormState {
  return {
    description: "",
    name: "",
    ownerId: "",
    releaseDate: "",
    startDate: "",
    status: "PLANNED",
    target: "",
    targetDate: "",
  };
}

function versionToFormState(version: Version): VersionFormState {
  return {
    description: version.description ?? "",
    name: version.name,
    ownerId: version.ownerId ?? "",
    releaseDate: toDateTimeInputValue(version.releaseDate),
    startDate: toDateTimeInputValue(version.startDate),
    status: version.status,
    target: version.target ?? "",
    targetDate: toDateTimeInputValue(version.targetDate),
  };
}

function formStateToCreateRequest(form: VersionFormState): CreateVersionRequest {
  return {
    description: optionalText(form.description),
    name: form.name.trim(),
    ownerId: optionalText(form.ownerId),
    releaseDate: toIsoDateTime(form.releaseDate),
    startDate: toIsoDateTime(form.startDate),
    status: form.status,
    target: optionalText(form.target),
    targetDate: toIsoDateTime(form.targetDate),
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
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

function formatDate(value: string | undefined, locale: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(date);
}

function formatMember(member: SpaceMemberWithUser) {
  return `${member.user.name} (${member.user.username})`;
}

function formatSpaceScope(
  space: SessionSpaceSummary | undefined,
  fallback: string,
) {
  return space ? `${space.name} / ${space.code}` : fallback;
}
