"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type {
  OrganizationMemberWithUser,
  RecordStatus,
  SessionOrganizationSummary,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  SpaceOverview,
  SpaceRole,
  SpaceSummary,
} from "@project-delivery/shared";
import {
  BarChart3,
  Boxes,
  Building2,
  FileText,
  GitBranch,
  Layers3,
  ListChecks,
  LogIn,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { Link } from "../../i18n/routing";
import {
  getApiErrorMessageKey,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";
import {
  addSpaceMemberFormSchema,
  createSpaceFormSchema,
  toAddSpaceMemberRequest,
  updateSpaceFormSchema,
  type AddSpaceMemberFormInput,
  type AddSpaceMemberFormValues,
  type CreateSpaceFormInput,
  type CreateSpaceFormValues,
  type UpdateSpaceFormInput,
  type UpdateSpaceFormValues,
} from "../../lib/space-forms";
import {
  addSpaceMember,
  canManageOrganization,
  canManageSpace,
  createSpace,
  getSpaceOverview,
  isActiveStatus,
  listOrganizationMembers,
  listSpaceMembers,
  listSpaces,
  updateSpace,
  updateSpaceMember,
} from "../../lib/space-service";
import { OrganizationMembersPanel } from "../organization/organization-members-panel";
import { OrganizationOnboarding } from "../onboarding/organization-onboarding";
import { useSession } from "../providers/session-provider";

const recordStatuses = ["ACTIVE", "DISABLED"] as const;
const spaceRoles = [
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
  "VIEWER",
] as const;

export function SpaceManagementWorkspace() {
  const t = useTranslations("spaces.workspace");
  const errorT = useTranslations();
  const {
    currentOrganization,
    currentSpace,
    refreshSession,
    session,
    spacesForCurrentOrganization,
    status,
    switchSpace,
  } = useSession();
  const [organizationMembers, setOrganizationMembers] = useState<
    OrganizationMemberWithUser[]
  >([]);
  const [organizationMembersLoading, setOrganizationMembersLoading] =
    useState(false);
  const [organizationMembersErrorKey, setOrganizationMembersErrorKey] =
    useState<ApiErrorMessageKey | null>(null);
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [spacesErrorKey, setSpacesErrorKey] =
    useState<ApiErrorMessageKey | null>(null);
  const [overview, setOverview] = useState<SpaceOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewErrorKey, setOverviewErrorKey] =
    useState<ApiErrorMessageKey | null>(null);
  const [spaceMembers, setSpaceMembers] = useState<SpaceMemberWithUser[]>([]);
  const [spaceMembersLoading, setSpaceMembersLoading] = useState(false);
  const [spaceMembersErrorKey, setSpaceMembersErrorKey] =
    useState<ApiErrorMessageKey | null>(null);

  const organizationId = currentOrganization?.id;
  const spaceId = currentSpace?.id;

  useEffect(() => {
    let isCurrent = true;

    setOrganizationMembers([]);
    setOrganizationMembersErrorKey(null);

    if (!organizationId) {
      setOrganizationMembersLoading(false);
      return () => {
        isCurrent = false;
      };
    }

    setOrganizationMembersLoading(true);

    void listOrganizationMembers(organizationId)
      .then((result) => {
        if (isCurrent) {
          setOrganizationMembers(result.items);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setOrganizationMembersErrorKey(getApiErrorMessageKey(error));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setOrganizationMembersLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [organizationId]);

  useEffect(() => {
    let isCurrent = true;

    setSpaces([]);
    setSpacesErrorKey(null);

    if (!organizationId) {
      setSpacesLoading(false);
      return () => {
        isCurrent = false;
      };
    }

    setSpacesLoading(true);

    void listSpaces(organizationId)
      .then((result) => {
        if (isCurrent) {
          setSpaces(result.items);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setSpacesErrorKey(getApiErrorMessageKey(error));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setSpacesLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [organizationId]);

  useEffect(() => {
    let isCurrent = true;

    setOverview(null);
    setOverviewErrorKey(null);

    if (!spaceId) {
      setOverviewLoading(false);
      return () => {
        isCurrent = false;
      };
    }

    setOverviewLoading(true);

    void getSpaceOverview(spaceId)
      .then((result) => {
        if (isCurrent) {
          setOverview(result);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setOverviewErrorKey(getApiErrorMessageKey(error));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setOverviewLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [spaceId]);

  useEffect(() => {
    let isCurrent = true;

    setSpaceMembers([]);
    setSpaceMembersErrorKey(null);

    if (!spaceId) {
      setSpaceMembersLoading(false);
      return () => {
        isCurrent = false;
      };
    }

    setSpaceMembersLoading(true);

    void listSpaceMembers(spaceId)
      .then((result) => {
        if (isCurrent) {
          setSpaceMembers(result.items);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setSpaceMembersErrorKey(getApiErrorMessageKey(error));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setSpaceMembersLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [spaceId]);

  async function refreshOrganizationMembers() {
    if (!organizationId) {
      return;
    }

    setOrganizationMembersLoading(true);
    setOrganizationMembersErrorKey(null);

    try {
      const result = await listOrganizationMembers(organizationId);
      setOrganizationMembers(result.items);
    } catch (error) {
      setOrganizationMembersErrorKey(getApiErrorMessageKey(error));
    } finally {
      setOrganizationMembersLoading(false);
    }
  }

  async function refreshSpaces() {
    if (!organizationId) {
      return;
    }

    setSpacesLoading(true);
    setSpacesErrorKey(null);

    try {
      const result = await listSpaces(organizationId);
      setSpaces(result.items);
    } catch (error) {
      setSpacesErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSpacesLoading(false);
    }
  }

  async function refreshOverview() {
    if (!spaceId) {
      return;
    }

    setOverviewLoading(true);
    setOverviewErrorKey(null);

    try {
      setOverview(await getSpaceOverview(spaceId));
    } catch (error) {
      setOverviewErrorKey(getApiErrorMessageKey(error));
    } finally {
      setOverviewLoading(false);
    }
  }

  async function refreshSpaceMembers() {
    if (!spaceId) {
      return;
    }

    setSpaceMembersLoading(true);
    setSpaceMembersErrorKey(null);

    try {
      const result = await listSpaceMembers(spaceId);
      setSpaceMembers(result.items);
    } catch (error) {
      setSpaceMembersErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSpaceMembersLoading(false);
    }
  }

  async function onSpaceCreated(createdSpaceId: string) {
    if (!organizationId) {
      return;
    }

    await Promise.all([
      refreshSpaces(),
      refreshSession(organizationId, createdSpaceId),
    ]);
  }

  async function onSpaceUpdated() {
    await Promise.all([refreshSpaces(), refreshOverview()]);

    if (organizationId && spaceId) {
      await refreshSession(organizationId, spaceId);
    }
  }

  if (status === "loading") {
    return (
      <section className="state-panel" aria-live="polite">
        <div className="state-panel__icon">
          <BarChart3 aria-hidden="true" size={18} strokeWidth={2} />
        </div>
        <h2>{t("session.loading.title")}</h2>
        <p>{t("session.loading.description")}</p>
      </section>
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <section className="state-panel">
        <div className="state-panel__icon">
          <LogIn aria-hidden="true" size={18} strokeWidth={2} />
        </div>
        <h2>{t("session.unauthenticated.title")}</h2>
        <p>{t("session.unauthenticated.description")}</p>
        <div className="state-panel__actions">
          <Link className="button button--primary" href="/login">
            {t("session.unauthenticated.login")}
          </Link>
          <Link className="button button--secondary" href="/register">
            {t("session.unauthenticated.register")}
          </Link>
        </div>
      </section>
    );
  }

  if (session.organizations.length === 0) {
    return <OrganizationOnboarding session={session} />;
  }

  if (!currentOrganization) {
    return (
      <section className="state-panel">
        <div className="state-panel__icon">
          <Building2 aria-hidden="true" size={18} strokeWidth={2} />
        </div>
        <h2>{t("missingOrganization.title")}</h2>
        <p>{t("missingOrganization.description")}</p>
      </section>
    );
  }

  const workspaceErrorKey =
    spacesErrorKey ?? overviewErrorKey ?? spaceMembersErrorKey;

  return (
    <div className="m1-workspace">
      <section className="page-heading" aria-labelledby="m1-workspace-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="m1-workspace-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{currentOrganization.name}</span>
          <span>{currentSpace?.name ?? t("page.noSpace")}</span>
        </div>
      </section>

      {workspaceErrorKey ? (
        <div className="form-alert" role="alert">
          {errorT(workspaceErrorKey)}
        </div>
      ) : null}

      <div className="workspace-grid">
        <div className="workspace-main">
          <SpaceOverviewPanel
            currentSpace={currentSpace}
            errorKey={overviewErrorKey}
            isLoading={overviewLoading}
            overview={overview}
          />
          <SpaceMembersPanel
            currentSpace={currentSpace}
            errorKey={spaceMembersErrorKey}
            isLoading={spaceMembersLoading}
            members={spaceMembers}
            onRefresh={refreshSpaceMembers}
            organizationMembers={organizationMembers}
          />
          <OrganizationMembersPanel
            errorKey={organizationMembersErrorKey}
            isLoading={organizationMembersLoading}
            members={organizationMembers}
            onRefresh={refreshOrganizationMembers}
            organization={currentOrganization}
          />
        </div>
        <aside className="workspace-side">
          <SpaceListPanel
            currentOrganization={currentOrganization}
            currentSpace={currentSpace}
            isLoading={spacesLoading}
            members={organizationMembers}
            onCreated={onSpaceCreated}
            onRefresh={refreshSpaces}
            onSwitchSpace={switchSpace}
            sessionSpaces={spacesForCurrentOrganization}
            spaces={spaces}
          />
          <SpaceSettingsPanel
            currentSpace={currentSpace}
            isLoading={overviewLoading}
            onUpdated={onSpaceUpdated}
            organizationMembers={organizationMembers}
            overview={overview}
          />
        </aside>
      </div>
    </div>
  );
}

type SpaceOverviewPanelProps = {
  currentSpace: SessionSpaceSummary | undefined;
  errorKey: ApiErrorMessageKey | null;
  isLoading: boolean;
  overview: SpaceOverview | null;
};

function SpaceOverviewPanel({
  currentSpace,
  errorKey,
  isLoading,
  overview,
}: SpaceOverviewPanelProps) {
  const t = useTranslations("spaceOverview");
  const errorT = useTranslations();

  if (!currentSpace) {
    return (
      <section className="panel workspace-panel">
        <div className="state-panel state-panel--embedded">
          <div className="state-panel__icon">
            <Layers3 aria-hidden="true" size={18} strokeWidth={2} />
          </div>
          <h2>{t("noSpace.title")}</h2>
          <p>{t("noSpace.description")}</p>
        </div>
      </section>
    );
  }

  const stats = overview?.stats;
  const statRows = [
    { key: "versions", value: stats?.versionCount ?? 0 },
    { key: "requirements", value: stats?.requirementCount ?? 0 },
    { key: "tasks", value: stats?.taskCount ?? 0 },
    { key: "bugs", value: stats?.bugCount ?? 0 },
    { key: "blocked", value: stats?.blockedCount ?? 0 },
    { key: "overdue", value: stats?.overdueCount ?? 0 },
  ] as const;

  return (
    <section className="panel workspace-panel" aria-labelledby="space-overview-title">
      <div className="panel__header">
        <div>
          <h3 id="space-overview-title">{t("title")}</h3>
          <p>{t("description", { space: currentSpace.name })}</p>
        </div>
        <div className="inline-actions">
          <Link className="button button--secondary" href={`/spaces/${currentSpace.id}/versions`}>
            <Boxes aria-hidden="true" size={16} strokeWidth={2} />
            {t("links.versions")}
          </Link>
          <Link className="button button--secondary" href={`/spaces/${currentSpace.id}/requirements`}>
            <FileText aria-hidden="true" size={16} strokeWidth={2} />
            {t("links.requirements")}
          </Link>
        </div>
      </div>

      {errorKey ? (
        <div className="form-alert" role="alert">
          {errorT(errorKey)}
        </div>
      ) : null}

      <div className="summary-list" aria-label={t("stats.label")}>
        {statRows.map((row) => (
          <div className="summary-list__row" key={row.key}>
            <span>{t(`stats.${row.key}`)}</span>
            <strong>{isLoading ? t("loadingValue") : row.value}</strong>
          </div>
        ))}
      </div>

      <div className="workspace-two-column">
        <section className="subsection" aria-labelledby="current-version-title">
          <div className="subsection__header">
            <ListChecks aria-hidden="true" size={16} strokeWidth={2} />
            <h4 id="current-version-title">{t("currentVersion.title")}</h4>
          </div>
          {overview?.currentVersion ? (
            <div className="detail-row">
              <span>{overview.currentVersion.name}</span>
              <strong>
                {t(`versionStatus.${overview.currentVersion.status}`)}
              </strong>
            </div>
          ) : (
            <p className="muted-text">{t("currentVersion.empty")}</p>
          )}
        </section>

        <section className="subsection" aria-labelledby="m1-work-items-title">
          <div className="subsection__header">
            <BarChart3 aria-hidden="true" size={16} strokeWidth={2} />
            <h4 id="m1-work-items-title">{t("workItems.title")}</h4>
          </div>
          <p className="muted-text">{t("workItems.empty")}</p>
        </section>
      </div>

      <section className="subsection" aria-labelledby="default-workflows-title">
        <div className="subsection__header">
          <GitBranch aria-hidden="true" size={16} strokeWidth={2} />
          <h4 id="default-workflows-title">{t("workflows.title")}</h4>
        </div>
        <div className="compact-list">
          {(overview?.defaultWorkflows ?? []).map((workflow) => (
            <div className="compact-list__row" key={workflow.workflowId}>
              <div>
                <span>{workflow.name}</span>
                <small>
                  {t("workflows.meta", {
                    code: t(`workflowCodes.${workflow.code}`),
                    workItemType: t(`workItemTypes.${workflow.workItemType}`),
                  })}
                </small>
              </div>
              <strong>
                {t("workflows.counts", {
                  actions: workflow.actionCount,
                  states: workflow.stateCount,
                })}
              </strong>
            </div>
          ))}
          {!isLoading && (overview?.defaultWorkflows.length ?? 0) === 0 ? (
            <p className="muted-text">{t("workflows.empty")}</p>
          ) : null}
        </div>
      </section>
    </section>
  );
}

type SpaceListPanelProps = {
  currentOrganization: SessionOrganizationSummary;
  currentSpace: SessionSpaceSummary | undefined;
  isLoading: boolean;
  members: OrganizationMemberWithUser[];
  onCreated: (spaceId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSwitchSpace: (spaceId: string) => Promise<unknown>;
  sessionSpaces: SessionSpaceSummary[];
  spaces: SpaceSummary[];
};

function SpaceListPanel({
  currentOrganization,
  currentSpace,
  isLoading,
  members,
  onCreated,
  onRefresh,
  onSwitchSpace,
  sessionSpaces,
  spaces,
}: SpaceListPanelProps) {
  const t = useTranslations("spaces.list");
  const errorT = useTranslations();
  const [errorKey, setErrorKey] = useState<ApiErrorMessageKey | null>(null);
  const [pendingSpaceId, setPendingSpaceId] = useState<string | null>(null);
  const canCreate = canManageOrganization(currentOrganization.role);
  const sessionSpaceById = useMemo(
    () => new Map(sessionSpaces.map((space) => [space.id, space])),
    [sessionSpaces],
  );

  async function onSelectSpace(spaceId: string) {
    setPendingSpaceId(spaceId);
    setErrorKey(null);

    try {
      await onSwitchSpace(spaceId);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPendingSpaceId(null);
    }
  }

  return (
    <section className="panel workspace-panel" aria-labelledby="space-list-title">
      <div className="panel__header">
        <div>
          <h3 id="space-list-title">{t("title")}</h3>
          <p>{t("description")}</p>
        </div>
        <span className="panel__badge panel__badge--neutral">
          {t("spaceCount", { count: spaces.length })}
        </span>
      </div>

      {errorKey ? (
        <div className="form-alert" role="alert">
          {errorT(errorKey)}
        </div>
      ) : null}

      {canCreate ? (
        <CreateSpaceForm
          members={members}
          onCreated={onCreated}
          onError={setErrorKey}
          onRefresh={onRefresh}
          organizationId={currentOrganization.id}
        />
      ) : (
        <div className="readonly-note">
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
          <span>{t("readOnly")}</span>
        </div>
      )}

      <div className="compact-list" aria-label={t("table.label")}>
        {isLoading ? <p className="muted-text">{t("loading")}</p> : null}
        {!isLoading && spaces.length === 0 ? (
          <p className="muted-text">{t("empty")}</p>
        ) : null}
        {!isLoading
          ? spaces.map((space) => {
              const sessionSpace = sessionSpaceById.get(space.id);
              const isSelected = currentSpace?.id === space.id;

              return (
                <div
                  className={
                    isSelected
                      ? "compact-list__row compact-list__row--selected"
                      : "compact-list__row"
                  }
                  key={space.id}
                >
                  <div>
                    <span>{space.name}</span>
                    <small>{space.code}</small>
                  </div>
                  {sessionSpace ? (
                    <button
                      className="button button--secondary"
                      disabled={isSelected || pendingSpaceId === space.id}
                      onClick={() => void onSelectSpace(space.id)}
                      type="button"
                    >
                      {isSelected ? t("selected") : t("switch")}
                    </button>
                  ) : (
                    <span className="status-pill status-pill--warning">
                      {t("notMember")}
                    </span>
                  )}
                </div>
              );
            })
          : null}
      </div>
    </section>
  );
}

type CreateSpaceFormProps = {
  members: OrganizationMemberWithUser[];
  onCreated: (spaceId: string) => Promise<void>;
  onError: (errorKey: ApiErrorMessageKey | null) => void;
  onRefresh: () => Promise<void>;
  organizationId: string;
};

function CreateSpaceForm({
  members,
  onCreated,
  onError,
  onRefresh,
  organizationId,
}: CreateSpaceFormProps) {
  const t = useTranslations("spaces.create");
  const activeMembers = members.filter((member) => isActiveStatus(member.status));
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<CreateSpaceFormInput, unknown, CreateSpaceFormValues>({
    defaultValues: {
      code: "",
      description: "",
      name: "",
      ownerId: "",
      staleThresholdDays: 3,
    },
    resolver: zodResolver(createSpaceFormSchema),
  });

  async function onSubmit(values: CreateSpaceFormValues) {
    onError(null);

    try {
      const created = await createSpace(organizationId, values);
      reset({
        code: "",
        description: "",
        name: "",
        ownerId: "",
        staleThresholdDays: 3,
      });
      await onCreated(created.id);
      await onRefresh();
    } catch (error) {
      onError(getApiErrorMessageKey(error));
    }
  }

  return (
    <form className="form-stack" noValidate onSubmit={handleSubmit(onSubmit)}>
      <div className="inline-form__title">
        <Plus aria-hidden="true" size={16} strokeWidth={2} />
        <span>{t("title")}</span>
      </div>
      <label className="field" htmlFor="space-name">
        <span>{t("fields.name.label")}</span>
        <input
          aria-invalid={Boolean(errors.name)}
          autoComplete="off"
          id="space-name"
          {...register("name")}
        />
        {errors.name ? <small role="alert">{t("fields.name.error")}</small> : null}
      </label>
      <label className="field" htmlFor="space-code">
        <span>{t("fields.code.label")}</span>
        <input
          aria-invalid={Boolean(errors.code)}
          autoComplete="off"
          id="space-code"
          {...register("code")}
        />
        {errors.code ? <small role="alert">{t("fields.code.error")}</small> : null}
      </label>
      <label className="field" htmlFor="space-description">
        <span>{t("fields.description.label")}</span>
        <textarea
          aria-invalid={Boolean(errors.description)}
          id="space-description"
          rows={3}
          {...register("description")}
        />
        {errors.description ? (
          <small role="alert">{t("fields.description.error")}</small>
        ) : null}
      </label>
      <label className="field" htmlFor="space-owner">
        <span>{t("fields.owner.label")}</span>
        <select id="space-owner" {...register("ownerId")}>
          <option value="">{t("fields.owner.default")}</option>
          {activeMembers.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.user.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor="space-stale-threshold">
        <span>{t("fields.staleThresholdDays.label")}</span>
        <input
          aria-invalid={Boolean(errors.staleThresholdDays)}
          id="space-stale-threshold"
          min={1}
          max={30}
          type="number"
          {...register("staleThresholdDays")}
        />
        {errors.staleThresholdDays ? (
          <small role="alert">{t("fields.staleThresholdDays.error")}</small>
        ) : null}
      </label>
      <button className="button button--primary" disabled={isSubmitting} type="submit">
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}

type SpaceSettingsPanelProps = {
  currentSpace: SessionSpaceSummary | undefined;
  isLoading: boolean;
  onUpdated: () => Promise<void>;
  organizationMembers: OrganizationMemberWithUser[];
  overview: SpaceOverview | null;
};

function SpaceSettingsPanel({
  currentSpace,
  isLoading,
  onUpdated,
  organizationMembers,
  overview,
}: SpaceSettingsPanelProps) {
  const t = useTranslations("spaces.settings");
  const errorT = useTranslations();
  const [errorKey, setErrorKey] = useState<ApiErrorMessageKey | null>(null);
  const canEdit = canManageSpace(currentSpace?.role);
  const space = overview?.space;
  const activeMembers = organizationMembers.filter((member) =>
    isActiveStatus(member.status),
  );
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<UpdateSpaceFormInput, unknown, UpdateSpaceFormValues>({
    defaultValues: toUpdateSpaceDefaults(space),
    resolver: zodResolver(updateSpaceFormSchema),
  });

  useEffect(() => {
    reset(toUpdateSpaceDefaults(space));
  }, [reset, space]);

  async function onSubmit(values: UpdateSpaceFormValues) {
    if (!space) {
      return;
    }

    setErrorKey(null);

    try {
      await updateSpace(space.id, values);
      await onUpdated();
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    }
  }

  return (
    <section className="panel workspace-panel" aria-labelledby="space-settings-title">
      <div className="panel__header">
        <div>
          <h3 id="space-settings-title">{t("title")}</h3>
          <p>{t("description")}</p>
        </div>
        <Settings aria-hidden="true" size={18} strokeWidth={2} />
      </div>

      {!currentSpace ? (
        <p className="muted-text">{t("noSpace")}</p>
      ) : isLoading && !space ? (
        <p className="muted-text">{t("loading")}</p>
      ) : (
        <>
          {errorKey ? (
            <div className="form-alert" role="alert">
              {errorT(errorKey)}
            </div>
          ) : null}
          {!canEdit ? (
            <div className="readonly-note">
              <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
              <span>{t("readOnly")}</span>
            </div>
          ) : null}
          <form className="form-stack" noValidate onSubmit={handleSubmit(onSubmit)}>
            <label className="field" htmlFor="space-settings-name">
              <span>{t("fields.name.label")}</span>
              <input
                aria-invalid={Boolean(errors.name)}
                disabled={!canEdit}
                id="space-settings-name"
                {...register("name")}
              />
              {errors.name ? (
                <small role="alert">{t("fields.name.error")}</small>
              ) : null}
            </label>
            <label className="field" htmlFor="space-settings-code">
              <span>{t("fields.code.label")}</span>
              <input
                aria-invalid={Boolean(errors.code)}
                disabled={!canEdit}
                id="space-settings-code"
                {...register("code")}
              />
              {errors.code ? (
                <small role="alert">{t("fields.code.error")}</small>
              ) : null}
            </label>
            <label className="field" htmlFor="space-settings-description">
              <span>{t("fields.description.label")}</span>
              <textarea
                aria-invalid={Boolean(errors.description)}
                disabled={!canEdit}
                id="space-settings-description"
                rows={3}
                {...register("description")}
              />
              {errors.description ? (
                <small role="alert">{t("fields.description.error")}</small>
              ) : null}
            </label>
            <label className="field" htmlFor="space-settings-owner">
              <span>{t("fields.owner.label")}</span>
              <select
                disabled={!canEdit}
                id="space-settings-owner"
                {...register("ownerId")}
              >
                <option value="">{t("fields.owner.default")}</option>
                {activeMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" htmlFor="space-settings-status">
              <span>{t("fields.status.label")}</span>
              <select
                disabled={!canEdit}
                id="space-settings-status"
                {...register("status")}
              >
                {recordStatuses.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" htmlFor="space-settings-stale-threshold">
              <span>{t("fields.staleThresholdDays.label")}</span>
              <input
                aria-invalid={Boolean(errors.staleThresholdDays)}
                disabled={!canEdit}
                id="space-settings-stale-threshold"
                max={30}
                min={1}
                type="number"
                {...register("staleThresholdDays")}
              />
              {errors.staleThresholdDays ? (
                <small role="alert">{t("fields.staleThresholdDays.error")}</small>
              ) : null}
            </label>
            <button
              className="button button--primary"
              disabled={!canEdit || isSubmitting}
              type="submit"
            >
              {isSubmitting ? t("submitting") : t("submit")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

type SpaceMembersPanelProps = {
  currentSpace: SessionSpaceSummary | undefined;
  errorKey: ApiErrorMessageKey | null;
  isLoading: boolean;
  members: SpaceMemberWithUser[];
  onRefresh: () => Promise<void>;
  organizationMembers: OrganizationMemberWithUser[];
};

function SpaceMembersPanel({
  currentSpace,
  errorKey,
  isLoading,
  members,
  onRefresh,
  organizationMembers,
}: SpaceMembersPanelProps) {
  const t = useTranslations("spaces.members");
  const errorT = useTranslations();
  const [mutationErrorKey, setMutationErrorKey] =
    useState<ApiErrorMessageKey | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const canEdit = canManageSpace(currentSpace?.role);
  const visibleErrorKey = mutationErrorKey ?? errorKey;

  async function updateMember(
    memberId: string,
    input: { role?: SpaceRole; status?: RecordStatus },
  ) {
    if (!currentSpace) {
      return;
    }

    setMutationErrorKey(null);
    setPendingMemberId(memberId);

    try {
      await updateSpaceMember(currentSpace.id, memberId, input);
      await onRefresh();
    } catch (error) {
      setMutationErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPendingMemberId(null);
    }
  }

  if (!currentSpace) {
    return (
      <section className="panel workspace-panel">
        <div className="state-panel state-panel--embedded">
          <div className="state-panel__icon">
            <Users aria-hidden="true" size={18} strokeWidth={2} />
          </div>
          <h2>{t("noSpace.title")}</h2>
          <p>{t("noSpace.description")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel workspace-panel" aria-labelledby="space-members-title">
      <div className="panel__header">
        <div>
          <h3 id="space-members-title">{t("title")}</h3>
          <p>{t("description")}</p>
        </div>
        <span className="panel__badge panel__badge--neutral">
          {t("memberCount", { count: members.length })}
        </span>
      </div>

      {visibleErrorKey ? (
        <div className="form-alert" role="alert">
          {errorT(visibleErrorKey)}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="readonly-note">
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
          <span>{t("readOnly")}</span>
        </div>
      ) : (
        <AddSpaceMemberForm
          members={members}
          onCreated={onRefresh}
          onError={setMutationErrorKey}
          organizationMembers={organizationMembers}
          spaceId={currentSpace.id}
        />
      )}

      <div className="m1-table" role="table" aria-label={t("table.label")}>
        <div className="m1-table__row m1-table__row--head" role="row">
          <span role="columnheader">{t("table.member")}</span>
          <span role="columnheader">{t("table.role")}</span>
          <span role="columnheader">{t("table.status")}</span>
        </div>
        {isLoading ? (
          <div className="m1-table__row" role="row">
            <span role="cell">{t("loading")}</span>
            <span role="cell" />
            <span role="cell" />
          </div>
        ) : null}
        {!isLoading && members.length === 0 ? (
          <div className="m1-table__row" role="row">
            <span role="cell">{t("empty")}</span>
            <span role="cell" />
            <span role="cell" />
          </div>
        ) : null}
        {!isLoading
          ? members.map((member) => (
              <div className="m1-table__row" key={member.id} role="row">
                <span role="cell">
                  <strong>{member.user.name}</strong>
                  <small>{member.user.username}</small>
                </span>
                <span role="cell">
                  {canEdit ? (
                    <select
                      aria-label={t("actions.changeRole", {
                        username: member.user.username,
                      })}
                      className="compact-select"
                      disabled={pendingMemberId === member.id}
                      onChange={(event) =>
                        void updateMember(member.id, {
                          role: event.target.value as SpaceRole,
                        })
                      }
                      value={member.role}
                    >
                      {spaceRoles.map((role) => (
                        <option key={role} value={role}>
                          {t(`roles.${role}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="status-pill status-pill--neutral">
                      {t(`roles.${member.role}`)}
                    </span>
                  )}
                </span>
                <span role="cell">
                  {canEdit ? (
                    <select
                      aria-label={t("actions.changeStatus", {
                        username: member.user.username,
                      })}
                      className="compact-select"
                      disabled={pendingMemberId === member.id}
                      onChange={(event) =>
                        void updateMember(member.id, {
                          status: event.target.value as RecordStatus,
                        })
                      }
                      value={member.status}
                    >
                      {recordStatuses.map((status) => (
                        <option key={status} value={status}>
                          {t(`status.${status}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={
                        member.status === "ACTIVE"
                          ? "status-pill"
                          : "status-pill status-pill--warning"
                      }
                    >
                      {t(`status.${member.status}`)}
                    </span>
                  )}
                </span>
              </div>
            ))
          : null}
      </div>
    </section>
  );
}

type AddSpaceMemberFormProps = {
  members: SpaceMemberWithUser[];
  onCreated: () => Promise<void>;
  onError: (errorKey: ApiErrorMessageKey | null) => void;
  organizationMembers: OrganizationMemberWithUser[];
  spaceId: string;
};

function AddSpaceMemberForm({
  members,
  onCreated,
  onError,
  organizationMembers,
  spaceId,
}: AddSpaceMemberFormProps) {
  const t = useTranslations("spaces.members.add");
  const existingUserIds = useMemo(
    () => new Set(members.map((member) => member.userId)),
    [members],
  );
  const candidates = organizationMembers.filter(
    (member) => isActiveStatus(member.status) && !existingUserIds.has(member.userId),
  );
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<AddSpaceMemberFormInput, unknown, AddSpaceMemberFormValues>({
    defaultValues: {
      role: "MEMBER",
      userId: "",
    },
    resolver: zodResolver(addSpaceMemberFormSchema),
  });

  async function onSubmit(values: AddSpaceMemberFormValues) {
    onError(null);

    try {
      await addSpaceMember(spaceId, toAddSpaceMemberRequest(values));
      reset({ role: "MEMBER", userId: "" });
      await onCreated();
    } catch (error) {
      onError(getApiErrorMessageKey(error));
    }
  }

  return (
    <form className="inline-form" noValidate onSubmit={handleSubmit(onSubmit)}>
      <div className="inline-form__title">
        <Users aria-hidden="true" size={16} strokeWidth={2} />
        <span>{t("title")}</span>
      </div>
      <label className="field" htmlFor="space-member-user">
        <span>{t("user")}</span>
        <select
          aria-invalid={Boolean(errors.userId)}
          disabled={candidates.length === 0}
          id="space-member-user"
          {...register("userId")}
        >
          <option value="">{t("userPlaceholder")}</option>
          {candidates.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.user.name}
            </option>
          ))}
        </select>
        {errors.userId ? <small role="alert">{t("userError")}</small> : null}
        {candidates.length === 0 ? <small>{t("noCandidates")}</small> : null}
      </label>
      <label className="field" htmlFor="space-member-role">
        <span>{t("role")}</span>
        <select id="space-member-role" {...register("role")}>
          {spaceRoles.map((role) => (
            <option key={role} value={role}>
              {t(`roles.${role}`)}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button button--primary"
        disabled={isSubmitting || candidates.length === 0}
        type="submit"
      >
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}

function toUpdateSpaceDefaults(
  space: SpaceOverview["space"] | undefined,
): UpdateSpaceFormInput {
  return {
    code: space?.code ?? "",
    description: space?.description ?? "",
    name: space?.name ?? "",
    ownerId: space?.ownerId ?? "",
    staleThresholdDays: space?.settings.staleThresholdDays ?? 3,
    status: space?.status ?? "ACTIVE",
  };
}
