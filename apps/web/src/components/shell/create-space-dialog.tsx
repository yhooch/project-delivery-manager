"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import type { ZodIssue } from "zod";

import { useSession } from "../providers/session-provider";
import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createSpaceFormSchema,
  toCreateSpaceRequest,
} from "../../lib/space-forms";
import { createSpace } from "../../lib/space-service";

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
import { Textarea } from "../ui/textarea";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
};

type CreateSpaceField = "code" | "description" | "name";
type CreateSpaceFieldErrors = Partial<Record<CreateSpaceField, string>>;

export function CreateSpaceDialog({ open, onOpenChange, organizationId }: Props) {
  const t = useTranslations("shell.createSpace");
  const tRoot = useTranslations();
  const { refreshSession } = useSession();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [fieldErrorKeys, setFieldErrorKeys] =
    useState<CreateSpaceFieldErrors>({});

  const resetForm = () => {
    setName("");
    setCode("");
    setDescription("");
    setErrorKey(null);
    setFieldErrorKeys({});
  };

  const clearFieldError = (field: CreateSpaceField) => {
    setFieldErrorKeys((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 1) {
      setErrorKey(null);
      setFieldErrorKeys({ name: "errors.nameRequired" });
      return;
    }

    const formResult = createSpaceFormSchema.safeParse({
      code,
      description,
      name,
    });
    if (!formResult.success) {
      setErrorKey(null);
      setFieldErrorKeys(mapCreateSpaceFormErrors(formResult.error.issues));
      return;
    }

    setSubmitting(true);
    setErrorKey(null);
    setFieldErrorKeys({});
    try {
      const space = await createSpace(
        organizationId,
        toCreateSpaceRequest({ code, description, name }),
      );
      await refreshSession(organizationId, space.id);
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setErrorKey(getApiErrorMessageKey(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (submitting) return;
    if (!next) {
      resetForm();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="create-space-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-space-name">{t("nameLabel")}</Label>
            <Input
              id="create-space-name"
              data-testid="create-space-name"
              value={name}
              required
              minLength={1}
              maxLength={120}
              aria-invalid={fieldErrorKeys.name ? "true" : undefined}
              aria-describedby={
                fieldErrorKeys.name ? "create-space-name-error" : undefined
              }
              onChange={(event) => {
                setName(event.target.value);
                clearFieldError("name");
              }}
              placeholder={t("namePlaceholder")}
              disabled={submitting}
            />
            {fieldErrorKeys.name ? (
              <p
                id="create-space-name-error"
                data-testid="create-space-name-error"
                className="text-[11px] text-destructive"
              >
                {t(fieldErrorKeys.name)}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-space-code">{t("codeLabel")}</Label>
            <Input
              id="create-space-code"
              data-testid="create-space-code"
              value={code}
              aria-invalid={fieldErrorKeys.code ? "true" : undefined}
              aria-describedby={
                fieldErrorKeys.code ? "create-space-code-error" : undefined
              }
              onChange={(event) => {
                setCode(event.target.value);
                clearFieldError("code");
              }}
              placeholder={t("codePlaceholder")}
              disabled={submitting}
            />
            {fieldErrorKeys.code ? (
              <p
                id="create-space-code-error"
                data-testid="create-space-code-error"
                className="text-[11px] text-destructive"
              >
                {t(fieldErrorKeys.code)}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-space-description">
              {t("descriptionLabel")}
            </Label>
            <Textarea
              id="create-space-description"
              data-testid="create-space-description"
              value={description}
              maxLength={2000}
              aria-invalid={fieldErrorKeys.description ? "true" : undefined}
              aria-describedby={
                fieldErrorKeys.description
                  ? "create-space-description-error"
                  : undefined
              }
              onChange={(event) => {
                setDescription(event.target.value);
                clearFieldError("description");
              }}
              placeholder={t("descriptionPlaceholder")}
              disabled={submitting}
            />
            {fieldErrorKeys.description ? (
              <p
                id="create-space-description-error"
                data-testid="create-space-description-error"
                className="text-[11px] text-destructive"
              >
                {t(fieldErrorKeys.description)}
              </p>
            ) : null}
          </div>
          {errorKey && (
            <div
              data-testid="create-space-error"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
            >
              {tRoot(errorKey)}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              data-testid="create-space-submit"
              disabled={submitting || name.trim().length < 1}
            >
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function mapCreateSpaceFormErrors(issues: ZodIssue[]): CreateSpaceFieldErrors {
  const errors: CreateSpaceFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (field !== "name" && field !== "code" && field !== "description") {
      continue;
    }
    if (errors[field]) {
      continue;
    }

    if (field === "name") {
      errors.name =
        issue.code === "too_big" ? "errors.nameTooLong" : "errors.nameRequired";
    } else if (field === "code") {
      errors.code = "errors.codeInvalid";
    } else {
      errors.description = "errors.descriptionTooLong";
    }
  }

  return errors;
}
