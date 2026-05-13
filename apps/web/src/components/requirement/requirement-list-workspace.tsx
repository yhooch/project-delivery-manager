"use client";

import type {
  Requirement,
  RequirementStatus,
  SessionSpaceSummary,
  SpaceMemberWithUser,
  SpaceRole,
  Version,
} from "@project-delivery/shared";
import {
  CircleAlert,
  FilePlus2,
  GitBranch,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { Link, useRouter } from "../../i18n/routing";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createRequirementDraft,
  listRequirementAssignableMembers,
  listRequirements,
  listRequirementVersions,
} from "../../lib/requirement-service";
import { useSession } from "../providers/session-provider";

const REQUIREMENT_STATUSES: RequirementStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "ARCHIVED",
];

const REQUIREMENT_WRITER_ROLES = new Set<SpaceRole>([
  "SPACE_ADMIN",
  "PM",
  "REQUIREMENT",
]);

type RequirementListWorkspaceProps = {
  initialVersionId?: string;
  spaceId: string;
};

export function RequirementListWorkspace({
  initialVersionId,
  spaceId,
}: RequirementListWorkspaceProps) {
  const t = useTranslations("requirements");
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { session, status } = useSession();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);
  const [versionFilter, setVersionFilter] = useState(initialVersionId ?? "");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequirementStatus | "ALL">(
    "ALL",
  );
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const currentSpace = useMemo(
    () => session?.spaces.find((space) => space.id === spaceId),
    [session, spaceId],
  );
  const organizationId =
    currentSpace?.organizationId ?? session?.defaultOrganizationId;
  const canCreateRequirement =
    currentSpace !== undefined &&
    REQUIREMENT_WRITER_ROLES.has(currentSpace.role);
  const requestKey = useMemo(
    () =>
      [
        organizationId ?? "no-organization",
        spaceId,
        versionFilter || "all-versions",
        ownerFilter || "all-owners",
        statusFilter,
        includeDrafts ? "drafts" : "published",
      ].join(":"),
    [
      includeDrafts,
      organizationId,
      ownerFilter,
      spaceId,
      statusFilter,
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
        const [requirementPage, versionPage, memberPage] = await Promise.all([
          listRequirements({
            includeDrafts,
            organizationId,
            ownerId: ownerFilter || undefined,
            page: 1,
            pageSize: 100,
            spaceId,
            status: statusFilter === "ALL" ? undefined : statusFilter,
            versionId: versionFilter || undefined,
          }),
          listRequirementVersions({
            organizationId,
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

        setRequirements(requirementPage.items);
        setVersions(versionPage.items);
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
    includeDrafts,
    organizationId,
    ownerFilter,
    requestKey,
    spaceId,
    status,
    statusFilter,
    versionFilter,
  ]);

  async function refreshRequirements() {
    if (status !== "authenticated") {
      return;
    }

    setIsLoading(true);
    setErrorKey(null);

    try {
      const requirementPage = await listRequirements({
        includeDrafts,
        organizationId,
        ownerId: ownerFilter || undefined,
        page: 1,
        pageSize: 100,
        spaceId,
        status: statusFilter === "ALL" ? undefined : statusFilter,
        versionId: versionFilter || undefined,
      });
      setRequirements(requirementPage.items);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function onCreateDraft() {
    if (!canCreateRequirement) {
      return;
    }

    setIsCreatingDraft(true);
    setErrorKey(null);

    try {
      const draft = await createRequirementDraft(
        {
          organizationId,
          spaceId,
        },
        {
          versionId: versionFilter || undefined,
        },
      );
      router.push(`/requirements/${draft.id}`);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setIsCreatingDraft(false);
    }
  }

  function showMyDrafts() {
    setIncludeDrafts(true);
    setStatusFilter("DRAFT");
    setOwnerFilter("");
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

  return (
    <div className="workbench-page">
      <section className="page-heading" aria-labelledby="requirements-heading">
        <div>
          <p className="page-heading__eyebrow">{t("page.eyebrow")}</p>
          <h2 className="page-heading__title" id="requirements-heading">
            {t("page.title")}
          </h2>
        </div>
        <div className="page-heading__meta">
          <span>{formatSpaceScope(currentSpace, t("page.unknownSpace"))}</span>
          <button
            className="button button--secondary"
            disabled={isLoading}
            onClick={() => void refreshRequirements()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={2} />
            {t("actions.refresh")}
          </button>
          <button
            className="button button--primary"
            disabled={!canCreateRequirement || isCreatingDraft}
            onClick={() => void onCreateDraft()}
            type="button"
          >
            <FilePlus2 aria-hidden="true" size={16} strokeWidth={2} />
            {isCreatingDraft
              ? t("actions.creatingDraft")
              : t("actions.createDraft")}
          </button>
        </div>
      </section>

      {errorKey ? <div className="form-alert">{tRoot(errorKey)}</div> : null}

      <section className="toolbar-panel" aria-label={t("filters.label")}>
        <label className="field">
          <span>{t("filters.version")}</span>
          <select
            onChange={(event) => setVersionFilter(event.target.value)}
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
        <label className="field">
          <span>{t("filters.status")}</span>
          <select
            onChange={(event) =>
              setStatusFilter(event.target.value as RequirementStatus | "ALL")
            }
            value={statusFilter}
          >
            <option value="ALL">{t("filters.allStatuses")}</option>
            {REQUIREMENT_STATUSES.map((item) => (
              <option key={item} value={item}>
                {t(`status.${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle-field">
          <input
            checked={includeDrafts}
            onChange={(event) => setIncludeDrafts(event.target.checked)}
            type="checkbox"
          />
          <span>{t("filters.includeDrafts")}</span>
        </label>
        <button
          className="button button--secondary"
          onClick={showMyDrafts}
          type="button"
        >
          {t("actions.myDrafts")}
        </button>
      </section>

      <section className="panel panel--wide" aria-labelledby="requirement-list-title">
        <div className="panel__header">
          <div>
            <h3 id="requirement-list-title">{t("list.title")}</h3>
            <p>{t("list.subtitle", { count: requirements.length })}</p>
          </div>
        </div>
        {isLoading ? (
          <InlineState label={t("states.loadingList")} />
        ) : requirements.length === 0 ? (
          <EmptyState
            title={t("states.empty.title")}
            description={t("states.empty.description")}
          />
        ) : (
          <div className="business-table" role="table" aria-label={t("list.title")}>
            <div className="business-table__row business-table__row--head" role="row">
              <span role="columnheader">{t("list.columns.title")}</span>
              <span role="columnheader">{t("list.columns.version")}</span>
              <span role="columnheader">{t("list.columns.owner")}</span>
              <span role="columnheader">{t("list.columns.priority")}</span>
              <span role="columnheader">{t("list.columns.status")}</span>
              <span role="columnheader">{t("list.columns.related")}</span>
            </div>
            {requirements.map((requirement) => (
              <Link
                className="business-table__row business-table__row--link"
                href={`/requirements/${requirement.id}`}
                key={requirement.id}
                role="row"
              >
                <span role="cell">
                  {requirement.title || t("list.untitledDraft")}
                </span>
                <span role="cell">
                  {formatVersionName(requirement.versionId, versions) ??
                    t("list.noVersion")}
                </span>
                <span role="cell">
                  {formatOwnerName(requirement.ownerId, members) ??
                    t("list.noOwner")}
                </span>
                <span role="cell">
                  {requirement.priority
                    ? t(`priority.${requirement.priority}`)
                    : t("list.noPriority")}
                </span>
                <span role="cell">
                  <span className="status-pill">
                    {t(`status.${requirement.status}`)}
                  </span>
                </span>
                <span role="cell">
                  {t("list.relatedCounts", {
                    bugs: requirement.relatedWorkItems.bugCount,
                    tasks: requirement.relatedWorkItems.taskCount,
                  })}
                </span>
              </Link>
            ))}
          </div>
        )}
        <div className="panel-footnote">
          <GitBranch aria-hidden="true" size={15} strokeWidth={2} />
          <span>{t("list.draftRule")}</span>
        </div>
        <div className="panel-footnote">
          <span>{t("list.updated", { date: formatNow(locale) })}</span>
        </div>
      </section>
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

function formatSpaceScope(
  space: SessionSpaceSummary | undefined,
  fallback: string,
) {
  return space ? `${space.name} / ${space.code}` : fallback;
}

function formatNow(locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}
