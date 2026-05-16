"use client";

import type { SpaceMemberWithUser, SpaceRole } from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { updateSpaceMember } from "../../lib/space-service";

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

const SPACE_ROLES: readonly SpaceRole[] = [
  "SPACE_ADMIN",
  "PM",
  "DEVELOPER",
  "TESTER",
  "REQUIREMENT",
  "MEMBER",
  "VIEWER",
];

export type EditSpaceMemberRoleDialogProps = {
  member: SpaceMemberWithUser | null;
  onClose: () => void;
  onSuccess: (member: SpaceMemberWithUser) => void;
  open: boolean;
  spaceId: string;
};

export function EditSpaceMemberRoleDialog({
  member,
  onClose,
  onSuccess,
  open,
  spaceId,
}: EditSpaceMemberRoleDialogProps) {
  const t = useTranslations("spaceSettings.dialog.editRole");
  const tRoles = useTranslations("spaceSettings.members.roles");
  const tRoot = useTranslations();

  const [role, setRole] = useState<SpaceRole>("DEVELOPER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !member) {
      return;
    }

    setRole(member.role);
    setErrorKey(null);
    setIsSubmitting(false);
  }, [member, open]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!member) {
      return;
    }

    setIsSubmitting(true);
    setErrorKey(null);

    try {
      const updated = await updateSpaceMember(spaceId, member.id, { role });
      onSuccess(updated);
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
            <Label htmlFor="edit-space-member-role">{t("fields.role")}</Label>
            <SelectMenu
              autoFocus
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              id="edit-space-member-role"
              onChange={(event) => setRole(event.target.value as SpaceRole)}
              value={role}
            >
              {SPACE_ROLES.map((roleKey) => (
                <option key={roleKey} value={roleKey}>
                  {tRoles(roleKey)}
                </option>
              ))}
            </SelectMenu>
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
              disabled={isSubmitting || !member || role === member.role}
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
