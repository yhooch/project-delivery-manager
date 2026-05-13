"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useRouter } from "../../i18n/routing";
import {
  registerFormSchema,
  type RegisterFormValues,
} from "../../lib/auth-forms";
import {
  getApiErrorMessageKey,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";
import { useSession } from "../providers/session-provider";

export function RegisterForm() {
  const t = useTranslations("auth.register.form");
  const formT = useTranslations("forms.auth");
  const errorT = useTranslations();
  const router = useRouter();
  const { register: registerAccount } = useSession();
  const [errorKey, setErrorKey] = useState<ApiErrorMessageKey | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<RegisterFormValues>({
    defaultValues: {
      confirmPassword: "",
      password: "",
      username: "",
    },
    resolver: zodResolver(registerFormSchema),
  });

  async function onSubmit(values: RegisterFormValues) {
    setErrorKey(null);

    try {
      await registerAccount(values);
      router.replace("/");
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={handleSubmit(onSubmit)}>
      <div className="form-panel__header">
        <UserPlus aria-hidden="true" size={18} strokeWidth={2} />
        <div>
          <h2>{t("title")}</h2>
          <p>{t("description")}</p>
        </div>
      </div>

      {errorKey ? (
        <div className="form-alert" role="alert">
          {errorT(errorKey)}
        </div>
      ) : null}

      <div className="field-stack">
        <label className="field" htmlFor="register-username">
          <span>{formT("fields.username.label")}</span>
          <input
            aria-invalid={Boolean(errors.username)}
            autoComplete="username"
            id="register-username"
            {...register("username")}
          />
          {errors.username ? (
            <small role="alert">{formT("fields.username.error")}</small>
          ) : null}
        </label>

        <label className="field" htmlFor="register-password">
          <span>{formT("fields.password.label")}</span>
          <input
            aria-invalid={Boolean(errors.password)}
            autoComplete="new-password"
            id="register-password"
            type="password"
            {...register("password")}
          />
          {errors.password ? (
            <small role="alert">{formT("fields.password.error")}</small>
          ) : null}
        </label>

        <label className="field" htmlFor="register-confirm-password">
          <span>{formT("fields.confirmPassword.label")}</span>
          <input
            aria-invalid={Boolean(errors.confirmPassword)}
            autoComplete="new-password"
            id="register-confirm-password"
            type="password"
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <small role="alert">{formT("fields.confirmPassword.error")}</small>
          ) : null}
        </label>
      </div>

      <button className="button button--primary" disabled={isSubmitting} type="submit">
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
