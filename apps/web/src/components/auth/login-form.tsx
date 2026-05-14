"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useRouter } from "../../i18n/routing";
import {
  loginFormSchema,
  type LoginFormValues,
} from "../../lib/auth-forms";
import {
  getApiErrorMessageKey,
  type ApiErrorMessageKey,
} from "../../lib/api-error-messages";
import { useSession } from "../providers/session-provider";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function LoginForm() {
  const t = useTranslations("auth.login");
  const formT = useTranslations("forms.auth");
  const errorT = useTranslations();
  const router = useRouter();
  const { login } = useSession();
  const [errorKey, setErrorKey] = useState<ApiErrorMessageKey | null>(null);
  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
  } = useForm<LoginFormValues>({
    defaultValues: { password: "", username: "" },
    resolver: zodResolver(loginFormSchema),
  });

  async function onSubmit(values: LoginFormValues) {
    setErrorKey(null);
    try {
      await login(values);
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
          <Label htmlFor="login-username">
            {formT("fields.username.label")}
          </Label>
          <Input
            id="login-username"
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
          <Label htmlFor="login-password">
            {formT("fields.password.label")}
          </Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          {errors.password && (
            <span className="text-[11px] text-destructive" role="alert">
              {formT("fields.password.error")}
            </span>
          )}
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          size="lg"
          className="mt-2 w-full"
          data-testid="login-submit"
        >
          {isSubmitting ? t("form.submitting") : t("form.submit")}
          {!isSubmitting && <ArrowRight className="h-3.5 w-3.5" />}
        </Button>
      </form>
    </div>
  );
}
