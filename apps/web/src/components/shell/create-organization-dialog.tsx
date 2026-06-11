"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { useSession } from "../providers/session-provider";

import {
  formatApiErrorDisplayMessage,
  getApiErrorDisplay,
  type ApiErrorDisplayState,
} from "./api-error-display";
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

export function CreateOrganizationDialog({ open, onOpenChange }: Props) {
  const t = useTranslations("shell.createOrg");
  const tRoot = useTranslations();
  const { createOrganization } = useSession();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiErrorDisplayState | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createOrganization({ name: name.trim(), code: code.trim() || undefined });
      setName("");
      setCode("");
      onOpenChange(false);
    } catch (err) {
      setError(getApiErrorDisplay(err, tRoot("errors.apiDetails.requestId")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="create-org-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-name">{t("nameLabel")}</Label>
            <Input
              id="org-name"
              data-testid="create-org-name-input"
              value={name}
              required
              minLength={2}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="org-code">{t("codeLabel")}</Label>
            <Input
              id="org-code"
              data-testid="create-org-code-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t("codePlaceholder")}
              disabled={submitting}
            />
          </div>
          {error && (
            <div
              data-testid="create-org-error"
              className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
            >
              {formatApiErrorDisplayMessage(
                tRoot(error.messageKey),
                error.detailLines,
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              data-testid="create-org-submit"
              disabled={submitting || name.trim().length < 2}
            >
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
