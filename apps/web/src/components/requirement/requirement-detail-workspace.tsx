"use client";

import type {
  AttachmentRef,
  Priority,
  Requirement,
  RequirementRelatedWorkItemSummary,
  RequirementStatus,
  SpaceMemberWithUser,
  SpaceRole,
  UpdateRequirementRequest,
  Version,
} from "@project-delivery/shared";
import {
  Archive,
  Bug,
  CircleAlert,
  Clock,
  FileText,
  Loader2,
  Paperclip,
  PenLine,
  Save,
  Split,
  User2,
  Flag,
  GitBranch as GitBranchIcon,
  Hash,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  archiveRequirement,
  getRequirement,
  listRequirementAssignableMembers,
  listRequirementVersions,
  updateRequirement,
} from "../../lib/requirement-service";
import { cn } from "../../lib/utils";
import { useSession } from "../providers/session-provider";
import { Badge, type BadgeProps } from "../ui/badge";
import { Button } from "../ui/button";
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

const STATUS_VARIANT: Record<RequirementStatus, BadgeProps["variant"]> = {
  DRAFT: "outline",
  CONFIRMED: "primary",
  ARCHIVED: "default",
};

const STATUS_DOT: Record<RequirementStatus, string> = {
  DRAFT: "bg-muted-foreground/50",
  CONFIRMED: "bg-primary",
  ARCHIVED: "bg-muted-foreground/30",
};

const PRIORITY_VARIANT: Record<Priority, BadgeProps["variant"]> = {
  LOW: "outline",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "destructive",
};

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
  const locale = useLocale();
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
  const fallbackCanEditRequirement =
    requirement?.status !== "ARCHIVED" &&
    currentSpace !== undefined &&
    REQUIREMENT_WRITER_ROLES.has(currentSpace.role);
  const canEditRequirement =
    requirement?.permissions?.canEdit ?? fallbackCanEditRequirement;
  const canUploadRequirementImages =
    requirement?.permissions?.canUploadAttachment ??
    (fallbackCanEditRequirement && requirement?.status === "DRAFT");
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

  const titleValue = form.title;
  const titlePlaceholder = t("detail.untitledDraft");
  const ownerLabel = formatOwnerName(requirement.ownerId, members);
  const authorLabel = formatOwnerName(requirement.authorId, members);
  const versionLabel = formatVersionName(requirement.versionId, versions);
  const shortId = requirement.id.slice(-8).toUpperCase();
  const lastModifiedLabel = formatTimestamp(requirement.updatedAt, locale);

  return (
    <form className="flex flex-col gap-6" onSubmit={onSave}>
      {/* Notion-style action toolbar (replaces m1 panel header buttons) */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t("detail.eyebrow")}</span>
        </div>
        <div className="flex items-center gap-2">
          {!canEditRequirement ? (
            <span className="text-[11px] text-muted-foreground">
              {t("form.readonly")}
            </span>
          ) : null}
          <Button
            disabled={!canEditRequirement || isArchiving}
            onClick={() => void onArchive()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Archive aria-hidden="true" />
            {isArchiving ? t("detail.archiving") : t("detail.archive")}
          </Button>
          <Button
            disabled={!canEditRequirement || isSaving}
            size="sm"
            type="submit"
          >
            <Save aria-hidden="true" />
            {isSaving ? t("detail.saving") : t("detail.save")}
          </Button>
        </div>
      </div>

      {errorKey ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {tRoot(errorKey)}
        </div>
      ) : null}

      {/* Big Notion-style title */}
      <div className="flex flex-col gap-2 pt-2">
        <input
          aria-label={t("form.title")}
          className={cn(
            "w-full border-0 bg-transparent p-0 text-4xl font-bold tracking-tight text-foreground outline-none",
            "placeholder:text-muted-foreground/40",
            "focus-visible:outline-none focus-visible:ring-0",
            "disabled:cursor-not-allowed disabled:opacity-70",
            "md:text-[2.5rem] md:leading-[1.15]",
          )}
          disabled={!canEditRequirement}
          maxLength={200}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              title: event.target.value,
            }))
          }
          placeholder={titlePlaceholder}
          required
          value={titleValue}
        />

        {/* Notion-style property strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs">
          <PropertyItem icon={<StatusDot status={requirement.status} />} label={t("detail.fields.status")}>
            <Badge variant={STATUS_VARIANT[requirement.status]}>
              {t(`status.${requirement.status}`)}
            </Badge>
          </PropertyItem>

          <PropertyItem icon={<Hash className="h-3.5 w-3.5" />} label={t("detail.fields.id")}>
            <span className="font-mono text-[11px] text-foreground/80">
              {shortId}
            </span>
          </PropertyItem>

          <PropertyItem icon={<GitBranchIcon className="h-3.5 w-3.5" />} label={t("form.version")}>
            <PropertySelect
              ariaLabel={t("form.version")}
              disabled={!canEditRequirement}
              onChange={(value) =>
                setForm((current) => ({ ...current, versionId: value }))
              }
              placeholder={t("form.noVersion")}
              value={form.versionId}
              displayValue={versionLabel ?? null}
            >
              <option value="">{t("form.noVersion")}</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.name}
                </option>
              ))}
            </PropertySelect>
          </PropertyItem>

          <PropertyItem icon={<User2 className="h-3.5 w-3.5" />} label={t("form.owner")}>
            <PropertySelect
              ariaLabel={t("form.owner")}
              disabled={!canEditRequirement}
              onChange={(value) =>
                setForm((current) => ({ ...current, ownerId: value }))
              }
              placeholder={t("form.noOwner")}
              value={form.ownerId}
              displayValue={ownerLabel ?? null}
            >
              <option value="">{t("form.noOwner")}</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {formatMember(member)}
                </option>
              ))}
            </PropertySelect>
          </PropertyItem>

          <PropertyItem icon={<Flag className="h-3.5 w-3.5" />} label={t("form.priority")}>
            <PropertySelect
              ariaLabel={t("form.priority")}
              disabled={!canEditRequirement}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  priority: value as Priority | "",
                }))
              }
              placeholder={t("form.noPriority")}
              value={form.priority}
              displayValue={
                form.priority ? (
                  <Badge variant={PRIORITY_VARIANT[form.priority]}>
                    {t(`priority.${form.priority}`)}
                  </Badge>
                ) : null
              }
            >
              <option value="">{t("form.noPriority")}</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {t(`priority.${priority}`)}
                </option>
              ))}
            </PropertySelect>
          </PropertyItem>

          <PropertyItem icon={<PenLine className="h-3.5 w-3.5" />} label={t("detail.fields.author")}>
            <span className="text-foreground/80">
              {authorLabel ?? t("detail.fields.unknownAuthor")}
            </span>
          </PropertyItem>

          <PropertyItem icon={<Clock className="h-3.5 w-3.5" />} label={t("detail.fields.lastModified")}>
            <span className="text-foreground/80">{lastModifiedLabel}</span>
          </PropertyItem>

          <PropertyItem icon={<Paperclip className="h-3.5 w-3.5" />} label={t("detail.attachments")}>
            <span className="text-foreground/80">
              {requirement.attachments?.length ?? 0}
            </span>
          </PropertyItem>
        </div>
      </div>

      {/* Summary as an inline textarea — soft hairline, no panel */}
      <div className="border-t border-border/60 pt-4">
        <label className="block">
          <span className="sr-only">{t("form.summary")}</span>
          <textarea
            className={cn(
              "w-full resize-y border-0 bg-transparent p-0 text-base leading-relaxed text-foreground/90 outline-none",
              "placeholder:text-muted-foreground/50",
              "focus-visible:outline-none focus-visible:ring-0",
              "disabled:cursor-not-allowed disabled:opacity-70",
            )}
            disabled={!canEditRequirement}
            maxLength={2000}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                summary: event.target.value,
              }))
            }
            placeholder={t("detail.summaryPlaceholder")}
            rows={2}
            value={form.summary}
          />
        </label>
      </div>

      {/* Block-level editor — no card, no border around it */}
      <div className="pt-1">
        <RequirementContentEditorSlot
          attachmentCount={requirement.attachments?.length ?? 0}
          canUploadImages={canEditRequirement && canUploadRequirementImages}
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
      </div>

      {/* Related work items — minimal, flat section */}
      <RelatedWorkItemsSection requirement={requirement} t={t} />
    </form>
  );
}

type PropertyItemProps = {
  icon: ReactNode;
  label: string;
  children: ReactNode;
};

function PropertyItem({ icon, label, children }: PropertyItemProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </span>
      <span className="flex items-center text-foreground/90">{children}</span>
    </div>
  );
}

type PropertySelectProps = {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
  displayValue: ReactNode;
  children: ReactNode;
};

/**
 * Notion-style inline selector: shows a compact label/badge that visually
 * blends with the property strip, but is backed by a native <select> so we
 * keep accessibility and keyboard support without adding new dependencies.
 */
function PropertySelect({
  ariaLabel,
  disabled,
  onChange,
  placeholder,
  value,
  displayValue,
  children,
}: PropertySelectProps) {
  return (
    <span className="relative inline-flex items-center">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
          !disabled && "hover:bg-muted",
          disabled && "opacity-80",
        )}
      >
        {displayValue ?? (
          <span className="text-muted-foreground/80">{placeholder}</span>
        )}
      </span>
      <select
        aria-label={ariaLabel}
        className={cn(
          "absolute inset-0 cursor-pointer opacity-0",
          disabled && "pointer-events-none",
        )}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </span>
  );
}

function StatusDot({ status }: { status: RequirementStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[status])}
    />
  );
}

type RelatedWorkItemsSectionProps = {
  requirement: Requirement;
  t: ReturnType<typeof useTranslations>;
};

function RelatedWorkItemsSection({
  requirement,
  t,
}: RelatedWorkItemsSectionProps) {
  const related = requirement.relatedWorkItems;
  const isEmpty = related.tasks.length === 0 && related.bugs.length === 0;

  return (
    <section
      aria-labelledby="related-work-items-title"
      className="flex flex-col gap-3 border-t border-border/60 pt-6"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2
          className="text-sm font-semibold text-foreground"
          id="related-work-items-title"
        >
          {t("relatedWorkItems.title")}
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {t("relatedWorkItems.tasks")}{" "}
            <strong className="text-foreground">{related.taskCount}</strong>
          </span>
          <span>
            {t("relatedWorkItems.bugs")}{" "}
            <strong className="text-foreground">{related.bugCount}</strong>
          </span>
        </div>
      </header>

      {isEmpty ? (
        <p className="text-xs text-muted-foreground">
          {t("relatedWorkItems.emptyDescription")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/50 rounded-md border border-border/50 bg-background">
          {related.tasks.map((item) => (
            <RelatedWorkItemRow icon="task" item={item} key={item.id} t={t} />
          ))}
          {related.bugs.map((item) => (
            <RelatedWorkItemRow icon="bug" item={item} key={item.id} t={t} />
          ))}
        </ul>
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
    <li className="flex items-center gap-2.5 px-3 py-2 text-sm">
      <Icon
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        strokeWidth={2}
      />
      <span className="flex-1 truncate text-foreground/90">{item.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {item.statusCategory
          ? t(`statusCategory.${item.statusCategory}`)
          : t("relatedWorkItems.noStatus")}
      </span>
    </li>
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
    <section
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/60 bg-background/40 px-6 py-12 text-center"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon
          aria-hidden="true"
          className={cn("h-4 w-4", icon === "loading" && "animate-spin")}
          strokeWidth={2}
        />
      </div>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
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

function formatTimestamp(value: string, locale: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
