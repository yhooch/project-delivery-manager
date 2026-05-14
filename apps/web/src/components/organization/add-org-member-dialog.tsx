"use client";

import type {
  OrganizationMemberWithUser,
  OrganizationRole,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { addOrganizationMember } from "../../lib/space-service";

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

const ORG_ROLES: readonly OrganizationRole[] = ["OWNER", "ADMIN", "MEMBER"];

export type AddOrgMemberDialogProps = {
  onClose: () => void;
  onSuccess: (member: OrganizationMemberWithUser) => void;
  open: boolean;
  organizationId: string;
};

export function AddOrgMemberDialog({
  onClose,
  onSuccess,
  open,
  organizationId,
}: AddOrgMemberDialogProps) {
  const t = useTranslations("organization.dialog.addMember");
  const tRoot = useTranslations();

  const [username, setUsername] = useState("");
  const [role, setRole] = useState<OrganizationRole>("MEMBER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setUsername("");
    setRole("MEMBER");
    setErrorKey(null);
    setIsSubmitting(false);
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = username.trim();

    if (trimmed.length === 0) {
      return;
    }

    setIsSubmitting(true);
    setErrorKey(null);

    try {
      const member = await addOrganizationMember(organizationId, {
        username: trimmed,
        role,
      });
      onSuccess(member);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
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

        <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-org-member-username">
              {t("fields.username")}
            </Label>
            <Input
              autoComplete="off"
              autoFocus
              id="add-org-member-username"
              maxLength={64}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t("fields.usernamePlaceholder")}
              required
              value={username}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-org-member-role">{t("fields.role")}</Label>
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              id="add-org-member-role"
              onChange={(event) =>
                setRole(event.target.value as OrganizationRole)
              }
              value={role}
            >
              {ORG_ROLES.map((roleKey) => (
                <option key={roleKey} value={roleKey}>
                  {t(`roles.${roleKey}`)}
                </option>
              ))}
            </select>
          </div>

          {errorKey ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {tRoot(errorKey)}
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
              disabled={isSubmitting || username.trim().length === 0}
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
