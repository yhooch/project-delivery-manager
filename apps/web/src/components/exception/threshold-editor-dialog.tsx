"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { updateSpace } from "../../lib/space-service";
import { parseThresholdDays } from "../../lib/threshold-normalizer";
import {
  formatApiErrorDisplayMessage,
  getApiErrorDisplay,
  type ApiErrorDisplayState,
} from "../shell/api-error-display";

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

export type ThresholdEditorDialogProps = {
  initialValue: number;
  onClose: () => void;
  onSaved: (nextValue: number) => void;
  open: boolean;
  spaceId: string;
};

export function ThresholdEditorDialog({
  initialValue,
  onClose,
  onSaved,
  open,
  spaceId,
}: ThresholdEditorDialogProps) {
  const t = useTranslations("spaceExceptions.threshold");
  const tRoot = useTranslations();

  const [value, setValue] = useState<string>(String(initialValue));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ApiErrorDisplayState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValue(String(initialValue));
    setIsSubmitting(false);
    setError(null);
    setValidationError(null);
  }, [initialValue, open]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = parseThresholdDays(value);
    if (parsed === null) {
      setValidationError("field.error");
      return;
    }
    setValidationError(null);
    setError(null);
    setIsSubmitting(true);

    try {
      const updated = await updateSpace(spaceId, {
        staleThresholdDays: parsed,
      });
      onSaved(updated.settings.staleThresholdDays);
    } catch (error) {
      setError(
        getApiErrorDisplay(error, tRoot("errors.apiDetails.requestId")),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exceptions-threshold-input">
              {t("field.label")}
            </Label>
            <Input
              id="exceptions-threshold-input"
              data-testid="exceptions-threshold-dialog-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                if (validationError) setValidationError(null);
              }}
              aria-invalid={validationError ? "true" : undefined}
            />
            {validationError ? (
              <p className="text-[11px] text-destructive">
                {t(validationError)}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {t("field.hint")}
              </p>
            )}
          </div>

          {error ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              <p className="whitespace-pre-line">
                {formatApiErrorDisplayMessage(
                  tRoot(error.messageKey),
                  error.detailLines,
                )}
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              className="text-xs"
              disabled={isSubmitting}
              onClick={onClose}
              size="sm"
              type="button"
              variant="outline"
            >
              {t("cancel")}
            </Button>
            <Button
              className="text-xs"
              data-testid="exceptions-threshold-dialog-submit"
              disabled={isSubmitting}
              size="sm"
              type="submit"
            >
              {isSubmitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
