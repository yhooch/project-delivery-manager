"use client";

import type { AppSession } from "@project-delivery/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Hourglass, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  createOrganizationFormSchema,
  type CreateOrganizationFormInput,
  type CreateOrganizationFormValues,
} from "../../lib/auth-forms";
import {
  getApiErrorMessageKey,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";
import { useSession } from "../providers/session-provider";

type OrganizationOnboardingProps = {
  session: AppSession;
};

export function OrganizationOnboarding({ session }: OrganizationOnboardingProps) {
  const t = useTranslations("onboarding");

  if (!session.capabilities.canCreateOrganization) {
    return (
      <section className="onboarding-grid">
        <div className="state-panel state-panel--wide">
          <div className="state-panel__icon">
            <Hourglass aria-hidden="true" size={18} strokeWidth={2} />
          </div>
          <h2>{t("waiting.title")}</h2>
          <p>{t("waiting.description")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="onboarding-grid">
      <div className="state-panel state-panel--wide">
        <div className="state-panel__icon">
          <Building2 aria-hidden="true" size={18} strokeWidth={2} />
        </div>
        <h2>{t("empty.title")}</h2>
        <p>{t("empty.description")}</p>
        <div className="onboarding-note">
          <strong>{t("waiting.compactTitle")}</strong>
          <span>{t("waiting.compactDescription")}</span>
        </div>
      </div>
      <CreateOrganizationForm />
    </section>
  );
}

function CreateOrganizationForm() {
  const t = useTranslations("onboarding.createOrganization");
  const formT = useTranslations("forms.organization");
  const errorT = useTranslations();
  const { createOrganization } = useSession();
  const [errorKey, setErrorKey] = useState<ApiErrorMessageKey | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<
    CreateOrganizationFormInput,
    unknown,
    CreateOrganizationFormValues
  >({
    defaultValues: {
      code: "",
      name: "",
    },
    resolver: zodResolver(createOrganizationFormSchema),
  });

  async function onSubmit(values: CreateOrganizationFormValues) {
    setErrorKey(null);

    try {
      await createOrganization(values);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    }
  }

  return (
    <form className="form-panel" noValidate onSubmit={handleSubmit(onSubmit)}>
      <div className="form-panel__header">
        <Plus aria-hidden="true" size={18} strokeWidth={2} />
        <div>
          <h3>{t("title")}</h3>
          <p>{t("description")}</p>
        </div>
      </div>

      {errorKey ? (
        <div className="form-alert" role="alert">
          {errorT(errorKey)}
        </div>
      ) : null}

      <div className="field-stack">
        <label className="field" htmlFor="organization-name">
          <span>{formT("fields.name.label")}</span>
          <input
            aria-invalid={Boolean(errors.name)}
            autoComplete="organization"
            id="organization-name"
            {...register("name")}
          />
          {errors.name ? (
            <small role="alert">{formT("fields.name.error")}</small>
          ) : null}
        </label>

        <label className="field" htmlFor="organization-code">
          <span>{formT("fields.code.label")}</span>
          <input
            aria-invalid={Boolean(errors.code)}
            autoComplete="off"
            id="organization-code"
            {...register("code")}
          />
          {errors.code ? (
            <small role="alert">{formT("fields.code.error")}</small>
          ) : null}
        </label>
      </div>

      <button className="button button--primary" disabled={isSubmitting} type="submit">
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
