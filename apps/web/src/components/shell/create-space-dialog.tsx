"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { useSession } from "../providers/session-provider";
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

export function CreateSpaceDialog({ open, onOpenChange, organizationId }: Props) {
  const t = useTranslations("shell.createSpace");
  const { refreshSession } = useSession();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setCode("");
    setDescription("");
    setError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 1) return;

    setSubmitting(true);
    setError(null);
    try {
      const trimmedCode = code.trim();
      const trimmedDescription = description.trim();
      const space = await createSpace(organizationId, {
        name: trimmedName,
        ...(trimmedCode ? { code: trimmedCode } : {}),
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      });
      await refreshSession(organizationId, space.id);
      resetForm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
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
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-space-code">{t("codeLabel")}</Label>
            <Input
              id="create-space-code"
              data-testid="create-space-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={t("codePlaceholder")}
              disabled={submitting}
            />
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
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("descriptionPlaceholder")}
              disabled={submitting}
            />
          </div>
          {error && (
            <div
              data-testid="create-space-error"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
            >
              {error}
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
