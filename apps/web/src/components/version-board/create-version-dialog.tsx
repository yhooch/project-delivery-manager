"use client";

import type {
  CreateVersionRequest,
  SpaceMemberWithUser,
  Version,
  VersionStatus,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { listSpaceMembers } from "../../lib/space-service";
import { createVersion } from "../../lib/version-service";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

const VERSION_STATUS_OPTIONS: VersionStatus[] = [
  "PLANNED",
  "IN_PROGRESS",
  "RELEASED",
  "ARCHIVED",
];

export type CreateVersionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  organizationId?: string;
  onCreated?: (version: Version) => void;
};

/**
 * Convert an HTML <input type="date"> value (YYYY-MM-DD) into an ISO datetime
 * string acceptable by the backend `IsoDateTimeSchema`. Returns `undefined`
 * for blank input so optional fields are not submitted as the epoch.
 */
function dateToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function CreateVersionDialog({
  open,
  onOpenChange,
  spaceId,
  organizationId,
  onCreated,
}: CreateVersionDialogProps) {
  const t = useTranslations("versionBoard.create");
  const tStatus = useTranslations("versionBoard.status");
  const tRoot = useTranslations();

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [status, setStatus] = useState<VersionStatus>("PLANNED");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [releaseDate, setReleaseDate] = useState("");

  const [nameError, setNameError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [members, setMembers] = useState<SpaceMemberWithUser[]>([]);

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const page = await listSpaceMembers(spaceId);
        if (cancelled) return;
        setMembers(page.items);
      } catch {
        // swallow — owner select stays empty
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, spaceId]);

  function reset() {
    setName("");
    setTarget("");
    setDescription("");
    setOwnerId("");
    setStatus("PLANNED");
    setStartDate("");
    setTargetDate("");
    setReleaseDate("");
    setNameError(false);
    setErrorKey(null);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    const request: CreateVersionRequest = {
      name: trimmed,
      target: target.trim() || undefined,
      description: description.trim() || undefined,
      ownerId: ownerId || undefined,
      status,
      startDate: dateToIso(startDate),
      targetDate: dateToIso(targetDate),
      releaseDate: dateToIso(releaseDate),
    };

    try {
      const version = await createVersion(
        { spaceId, organizationId },
        request,
      );
      onCreated?.(version);
      handleOpenChange(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="create-version-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3"
          noValidate
        >
          {errorKey && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {tRoot(errorKey)}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-version-name">{t("fields.name")}</Label>
            <Input
              id="create-version-name"
              data-testid="create-version-name-input"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) {
                  setNameError(false);
                }
              }}
              maxLength={120}
              autoFocus
              aria-invalid={nameError}
              placeholder={t("placeholders.name")}
            />
            {nameError && (
              <span className="text-[11px] text-destructive" role="alert">
                {t("fields.nameError")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-version-target">{t("fields.target")}</Label>
            <Textarea
              id="create-version-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder={t("placeholders.target")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-version-description">
              {t("fields.description")}
            </Label>
            <Textarea
              id="create-version-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder={t("placeholders.description")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-version-owner">{t("fields.owner")}</Label>
              <select
                id="create-version-owner"
                data-testid="create-version-owner-select"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("placeholders.owner")}</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name || member.user.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-version-status">
                {t("fields.status")}
              </Label>
              <select
                id="create-version-status"
                data-testid="create-version-status-select"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as VersionStatus)
                }
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {VERSION_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {tStatus(s)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-version-start-date">
                {t("fields.startDate")}
              </Label>
              <Input
                id="create-version-start-date"
                data-testid="create-version-start-date-input"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-version-target-date">
                {t("fields.targetDate")}
              </Label>
              <Input
                id="create-version-target-date"
                data-testid="create-version-target-date-input"
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="create-version-release-date">
                {t("fields.releaseDate")}
              </Label>
              <Input
                id="create-version-release-date"
                data-testid="create-version-release-date-input"
                type="date"
                value={releaseDate}
                onChange={(event) => setReleaseDate(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="create-version-cancel"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="create-version-submit"
              disabled={submitting}
            >
              {submitting ? t("submitting") : t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
