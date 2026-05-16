"use client";

import type {
  OrganizationMemberWithUser,
  SpaceMemberWithUser,
  SpaceRole,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { toAddSpaceMemberRequest } from "../../lib/space-forms";
import {
  addSpaceMember,
  listOrganizationMembers,
} from "../../lib/space-service";

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

export type AddSpaceMemberDialogProps = {
  existingUserIds: Set<string>;
  onClose: () => void;
  onSuccess: (member: SpaceMemberWithUser) => void;
  open: boolean;
  organizationId: string;
  spaceId: string;
};

export function AddSpaceMemberDialog({
  existingUserIds,
  onClose,
  onSuccess,
  open,
  organizationId,
  spaceId,
}: AddSpaceMemberDialogProps) {
  const t = useTranslations("spaceSettings.dialog.addMember");
  const tRoles = useTranslations("spaceSettings.members.roles");
  const tRoot = useTranslations();

  const [orgMembers, setOrgMembers] = useState<OrganizationMemberWithUser[]>(
    [],
  );
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [role, setRole] = useState<SpaceRole>("DEVELOPER");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSearch("");
    setSelectedUserId("");
    setRole("DEVELOPER");
    setErrorKey(null);
    setIsSubmitting(false);

    let cancelled = false;
    void (async () => {
      try {
        const page = await listOrganizationMembers(organizationId);
        if (!cancelled) {
          setOrgMembers(page.items);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorKey(getApiErrorMessageKey(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, organizationId]);

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orgMembers.filter((member) => {
      if (existingUserIds.has(member.userId)) {
        return false;
      }
      if (member.status !== "ACTIVE") {
        return false;
      }
      if (query.length === 0) {
        return true;
      }
      return (
        member.user.username.toLowerCase().includes(query) ||
        member.user.name.toLowerCase().includes(query)
      );
    });
  }, [existingUserIds, orgMembers, search]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }

  function selectCandidate(member: OrganizationMemberWithUser) {
    setSelectedUserId(member.userId);
    setSearch(member.user.username);
  }

  function handleCandidateKeyDown(
    member: OrganizationMemberWithUser,
    event: KeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectCandidate(member);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    event.preventDefault();
    const listbox = event.currentTarget.closest('[role="listbox"]');
    const options = Array.from(
      listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    const currentIndex = options.indexOf(event.currentTarget);
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.min(
      Math.max(currentIndex + offset, 0),
      options.length - 1,
    );
    options[nextIndex]?.focus({ preventScroll: true });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedUserId) {
      return;
    }

    setIsSubmitting(true);
    setErrorKey(null);

    try {
      const member = await addSpaceMember(
        spaceId,
        toAddSpaceMemberRequest({ role, userId: selectedUserId }),
      );
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

        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-space-member-username">
              {t("fields.username")}
            </Label>
            <Input
              autoComplete="off"
              autoFocus
              id="add-space-member-username"
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedUserId("");
              }}
              placeholder={t("fields.usernamePlaceholder")}
              value={search}
            />
            <div
              className="max-h-44 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
              role="listbox"
              aria-label={t("fields.username")}
            >
              {candidates.length === 0 ? (
                <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  {t("fields.noMatch")}
                </p>
              ) : (
                <ul role="none">
                  {candidates.map((member, index) => {
                    const selected = selectedUserId === member.userId;
                    return (
                      <li key={member.id} role="none">
                        <div
                          aria-selected={selected}
                          className={
                            "flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring " +
                            (selected ? "bg-muted text-foreground" : "")
                          }
                          onClick={() => {
                            selectCandidate(member);
                          }}
                          onKeyDown={(event) =>
                            handleCandidateKeyDown(member, event)
                          }
                          role="option"
                          tabIndex={
                            selected || (!selectedUserId && index === 0)
                              ? 0
                              : -1
                          }
                        >
                          <span className="font-medium">
                            {member.user.name}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            @{member.user.username}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-space-member-role">{t("fields.role")}</Label>
            <SelectMenu
              className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              id="add-space-member-role"
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
              disabled={isSubmitting || !selectedUserId}
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
