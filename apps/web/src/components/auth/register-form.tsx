"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
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
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function RegisterForm() {
  const t = useTranslations("auth.register");
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
    defaultValues: { confirmPassword: "", password: "", username: "" },
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-primary">
          {t("eyebrow")}
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <form
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-3"
      >
        {errorKey && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {errorT(errorKey)}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="register-username">
            {formT("fields.username.label")}
          </Label>
          <Input
            id="register-username"
            autoComplete="username"
            aria-invalid={Boolean(errors.username)}
            {...register("username")}
          />
          {errors.username && (
            <span className="text-[11px] text-destructive" role="alert">
              {formT("fields.username.error")}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="register-password">
            {formT("fields.password.label")}
          </Label>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          {errors.password && (
            <span className="text-[11px] text-destructive" role="alert">
              {formT("fields.password.error")}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="register-confirm-password">
            {formT("fields.confirmPassword.label")}
          </Label>
          <Input
            id="register-confirm-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <span className="text-[11px] text-destructive" role="alert">
              {formT("fields.confirmPassword.error")}
            </span>
          )}
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          size="lg"
          className="mt-2 w-full"
        >
          {isSubmitting ? t("form.submitting") : t("form.submit")}
          {!isSubmitting && <ArrowRight className="h-3.5 w-3.5" />}
        </Button>
      </form>
    </div>
  );
}
