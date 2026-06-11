"use client";

import type {
  OrganizationMemberWithUser,
  OrganizationRole,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { updateOrganizationMember } from "../../lib/space-service";

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
import { Label } from "../ui/label";
import { SelectMenu } from "../ui/select-menu";

const ORG_ROLES: readonly OrganizationRole[] = ["OWNER", "ADMIN", "MEMBER"];

export type EditOrgMemberRoleDialogProps = {
  isLastActiveOwner: boolean;
  member: OrganizationMemberWithUser | null;
  onClose: () => void;
  onSuccess: (member: OrganizationMemberWithUser) => void;
  open: boolean;
  organizationId: string;
};

export function EditOrgMemberRoleDialog({
  isLastActiveOwner,
  member,
  onClose,
  onSuccess,
  open,
  organizationId,
}: EditOrgMemberRoleDialogProps) {
  const t = useTranslations("organization.dialog.editRole");
  const tRoles = useTranslations("organization.members.roles");
  const tRoot = useTranslations();

  const [role, setRole] = useState<OrganizationRole>("MEMBER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ApiErrorDisplayState | null>(null);

  useEffect(() => {
    if (!open || !member) {
      return;
    }

    setRole(member.role);
    setError(null);
    setIsSubmitting(false);
  }, [member, open]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!member || (isLastActiveOwner && role !== "OWNER")) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const updated = await updateOrganizationMember(
        organizationId,
        member.id,
        {
          role,
        },
      );
      onSuccess(updated);
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
          <DialogDescription>
            {t("description", { username: member?.user.username ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-org-member-role">{t("fields.role")}</Label>
            <SelectMenu
              autoFocus
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              id="edit-org-member-role"
              onChange={(event) =>
                setRole(event.target.value as OrganizationRole)
              }
              value={role}
            >
              {ORG_ROLES.map((roleKey) => (
                <option
                  disabled={isLastActiveOwner && roleKey !== "OWNER"}
                  key={roleKey}
                  value={roleKey}
                >
                  {tRoles(roleKey)}
                </option>
              ))}
            </SelectMenu>
          </div>

          {isLastActiveOwner ? (
            <div
              className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
              role="alert"
            >
              {t("lastOwnerWarning")}
            </div>
          ) : null}

          {error ? (
            <div
              className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {formatApiErrorDisplayMessage(
                tRoot(error.messageKey),
                error.detailLines,
              )}
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
              disabled={
                isSubmitting ||
                !member ||
                role === member.role ||
                (isLastActiveOwner && role !== "OWNER")
              }
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
