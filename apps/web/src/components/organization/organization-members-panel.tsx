"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type {
  OrganizationMemberWithUser,
  OrganizationRole,
  RecordStatus,
  SessionOrganizationSummary,
} from "@project-delivery/shared";
import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  getApiErrorMessageKey,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";
import {
  addOrganizationMemberFormSchema,
  toAddOrganizationMemberRequest,
  type AddOrganizationMemberFormInput,
  type AddOrganizationMemberFormValues,
} from "../../lib/space-forms";
import {
  addOrganizationMember,
  canManageOrganization,
  updateOrganizationMember,
} from "../../lib/space-service";

const organizationRoles = ["OWNER", "ADMIN", "MEMBER"] as const;
const recordStatuses = ["ACTIVE", "DISABLED"] as const;

type OrganizationMembersPanelProps = {
  errorKey: ApiErrorMessageKey | null;
  isLoading: boolean;
  members: OrganizationMemberWithUser[];
  onRefresh: () => Promise<void>;
  organization: SessionOrganizationSummary;
};

export function OrganizationMembersPanel({
  errorKey,
  isLoading,
  members,
  onRefresh,
  organization,
}: OrganizationMembersPanelProps) {
  const t = useTranslations("organizationMembers");
  const errorT = useTranslations();
  const [mutationErrorKey, setMutationErrorKey] =
    useState<ApiErrorMessageKey | null>(null);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const canManage = canManageOrganization(organization.role);
  const visibleErrorKey = mutationErrorKey ?? errorKey;

  async function onUpdateRole(
    member: OrganizationMemberWithUser,
    role: OrganizationRole,
  ) {
    await updateMember(member.id, { role });
  }

  async function onUpdateStatus(
    member: OrganizationMemberWithUser,
    status: RecordStatus,
  ) {
    await updateMember(member.id, { status });
  }

  async function updateMember(
    memberId: string,
    input: { role?: OrganizationRole; status?: RecordStatus },
  ) {
    setMutationErrorKey(null);
    setPendingMemberId(memberId);

    try {
      await updateOrganizationMember(organization.id, memberId, input);
      await onRefresh();
    } catch (error) {
      setMutationErrorKey(getApiErrorMessageKey(error));
    } finally {
      setPendingMemberId(null);
    }
  }

  return (
    <section className="panel workspace-panel" aria-labelledby="organization-members-title">
      <div className="panel__header">
        <div>
          <h3 id="organization-members-title">{t("title")}</h3>
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

      {!canManage ? (
        <div className="readonly-note">
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
          <span>{t("readOnly")}</span>
        </div>
      ) : (
        <AddOrganizationMemberForm
          organizationId={organization.id}
          onCreated={onRefresh}
          onError={setMutationErrorKey}
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
                  {canManage ? (
                    <select
                      aria-label={t("actions.changeRole", {
                        username: member.user.username,
                      })}
                      className="compact-select"
                      disabled={pendingMemberId === member.id}
                      onChange={(event) =>
                        void onUpdateRole(
                          member,
                          event.target.value as OrganizationRole,
                        )
                      }
                      value={member.role}
                    >
                      {organizationRoles.map((role) => (
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
                  {canManage ? (
                    <select
                      aria-label={t("actions.changeStatus", {
                        username: member.user.username,
                      })}
                      className="compact-select"
                      disabled={pendingMemberId === member.id}
                      onChange={(event) =>
                        void onUpdateStatus(
                          member,
                          event.target.value as RecordStatus,
                        )
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

type AddOrganizationMemberFormProps = {
  onCreated: () => Promise<void>;
  onError: (errorKey: ApiErrorMessageKey | null) => void;
  organizationId: string;
};

function AddOrganizationMemberForm({
  onCreated,
  onError,
  organizationId,
}: AddOrganizationMemberFormProps) {
  const t = useTranslations("organizationMembers.add");
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<
    AddOrganizationMemberFormInput,
    unknown,
    AddOrganizationMemberFormValues
  >({
    defaultValues: {
      role: "MEMBER",
      username: "",
    },
    resolver: zodResolver(addOrganizationMemberFormSchema),
  });

  async function onSubmit(values: AddOrganizationMemberFormValues) {
    onError(null);

    try {
      await addOrganizationMember(
        organizationId,
        toAddOrganizationMemberRequest(values),
      );
      reset({ role: "MEMBER", username: "" });
      await onCreated();
    } catch (error) {
      onError(getApiErrorMessageKey(error));
    }
  }

  return (
    <form className="inline-form" noValidate onSubmit={handleSubmit(onSubmit)}>
      <div className="inline-form__title">
        <UserPlus aria-hidden="true" size={16} strokeWidth={2} />
        <span>{t("title")}</span>
      </div>
      <label className="field" htmlFor="organization-member-username">
        <span>{t("username")}</span>
        <input
          aria-invalid={Boolean(errors.username)}
          autoComplete="off"
          id="organization-member-username"
          {...register("username")}
        />
        {errors.username ? <small role="alert">{t("usernameError")}</small> : null}
      </label>
      <label className="field" htmlFor="organization-member-role">
        <span>{t("role")}</span>
        <select id="organization-member-role" {...register("role")}>
          {organizationRoles.map((role) => (
            <option key={role} value={role}>
              {t(`roles.${role}`)}
            </option>
          ))}
        </select>
      </label>
      <button className="button button--primary" disabled={isSubmitting} type="submit">
        <Users aria-hidden="true" size={16} strokeWidth={2} />
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
