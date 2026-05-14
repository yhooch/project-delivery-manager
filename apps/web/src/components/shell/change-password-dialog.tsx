"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { ApiClientError } from "../../lib/api-client";
import {
  changePasswordFormSchema,
  type ChangePasswordFormValues,
} from "../../lib/auth-forms";
import { changePassword } from "../../lib/session-service";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FieldErrorKey =
  | "passwordMismatch"
  | "sameAsOld"
  | "tooShort"
  | "required";

type FormErrorKey = "invalidCredentials" | "generic";

const DEFAULT_VALUES: ChangePasswordFormValues = {
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
};

function toFieldErrorKey(message: string | undefined): FieldErrorKey | null {
  if (!message) return null;
  if (message === "passwordMismatch") return "passwordMismatch";
  if (message === "sameAsOld") return "sameAsOld";
  if (message.toLowerCase().includes("least") || message.includes("min")) {
    return "tooShort";
  }
  return "required";
}

export function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const t = useTranslations("shell.changePassword");
  const [errorKey, setErrorKey] = useState<FormErrorKey | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<ChangePasswordFormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: zodResolver(changePasswordFormSchema),
  });

  useEffect(() => {
    if (!open) {
      reset(DEFAULT_VALUES);
      setErrorKey(null);
      setSuccess(false);
    }
  }, [open, reset]);

  async function onSubmit(values: ChangePasswordFormValues) {
    setErrorKey(null);
    setSuccess(false);
    try {
      await changePassword(values);
      setSuccess(true);
      onOpenChange(false);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.error.code === "INVALID_CREDENTIALS"
      ) {
        setErrorKey("invalidCredentials");
      } else {
        setErrorKey("generic");
      }
    }
  }

  const oldErrorKey = toFieldErrorKey(errors.oldPassword?.message);
  const newErrorKey = toFieldErrorKey(errors.newPassword?.message);
  const confirmErrorKey = toFieldErrorKey(errors.confirmPassword?.message);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="change-password-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          {errorKey && (
            <div
              role="alert"
              data-testid="change-password-error"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {t(`errors.${errorKey}`)}
            </div>
          )}

          {success && (
            <div
              role="status"
              data-testid="change-password-success"
              className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
            >
              {t("success")}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-password-old">
              {t("fields.oldPassword")}
            </Label>
            <Input
              id="change-password-old"
              type="password"
              autoComplete="current-password"
              data-testid="change-password-old"
              placeholder={t("placeholders.oldPassword")}
              aria-invalid={Boolean(errors.oldPassword)}
              {...register("oldPassword")}
            />
            {oldErrorKey && (
              <span className="text-[11px] text-destructive" role="alert">
                {t(`errors.${oldErrorKey === "passwordMismatch" || oldErrorKey === "sameAsOld" ? oldErrorKey : "generic"}`)}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-password-new">
              {t("fields.newPassword")}
            </Label>
            <Input
              id="change-password-new"
              type="password"
              autoComplete="new-password"
              data-testid="change-password-new"
              placeholder={t("placeholders.newPassword")}
              aria-invalid={Boolean(errors.newPassword)}
              {...register("newPassword")}
            />
            {newErrorKey && (
              <span
                className="text-[11px] text-destructive"
                role="alert"
                data-testid="change-password-new-error"
              >
                {t(
                  `errors.${
                    newErrorKey === "sameAsOld"
                      ? "sameAsOld"
                      : newErrorKey === "passwordMismatch"
                        ? "mismatch"
                        : "generic"
                  }`,
                )}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="change-password-confirm">
              {t("fields.confirmPassword")}
            </Label>
            <Input
              id="change-password-confirm"
              type="password"
              autoComplete="new-password"
              data-testid="change-password-confirm"
              placeholder={t("placeholders.confirmPassword")}
              aria-invalid={Boolean(errors.confirmPassword)}
              {...register("confirmPassword")}
            />
            {confirmErrorKey && (
              <span
                className="text-[11px] text-destructive"
                role="alert"
                data-testid="change-password-confirm-error"
              >
                {t(
                  `errors.${
                    confirmErrorKey === "passwordMismatch"
                      ? "mismatch"
                      : "generic"
                  }`,
                )}
              </span>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              data-testid="change-password-cancel"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              data-testid="change-password-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
