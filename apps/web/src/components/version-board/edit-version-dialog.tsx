"use client";

import type {
  SpaceMemberWithUser,
  UpdateVersionRequest,
  Version,
  VersionStatus,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import { listSpaceMembers } from "../../lib/space-service";
import { updateVersion } from "../../lib/version-service";

import {
  Dialog,
  DialogContent,
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

export type EditVersionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The version being edited. The dialog reads initial state from this. */
  version: Version | null;
  spaceId: string;
  organizationId?: string;
  onUpdated?: (version: Version) => void;
};

function dateToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function isoToDate(value: string | undefined): string {
  if (!value) return "";
  // Render in the user's locale day; ISO strings begin with YYYY-MM-DD.
  return value.slice(0, 10);
}

export function EditVersionDialog({
  open,
  onOpenChange,
  version,
  spaceId,
  organizationId,
  onUpdated,
}: EditVersionDialogProps) {
  const t = useTranslations("versionBoard.edit");
  const tCreate = useTranslations("versionBoard.create");
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

  // Reset form state every time the dialog opens or the target version
  // changes, so we don't leak fields from a previous edit.
  useEffect(() => {
    if (!open || !version) return;
    setName(version.name);
    setTarget(version.target ?? "");
    setDescription(version.description ?? "");
    setOwnerId(version.ownerId ?? "");
    setStatus(version.status);
    setStartDate(isoToDate(version.startDate));
    setTargetDate(isoToDate(version.targetDate));
    setReleaseDate(isoToDate(version.releaseDate));
    setNameError(false);
    setErrorKey(null);
    setSubmitting(false);
  }, [open, version]);

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

  function handleOpenChange(next: boolean) {
    if (!next) {
      setErrorKey(null);
      setNameError(false);
      setSubmitting(false);
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!version) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(true);
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    const request: UpdateVersionRequest = {
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
      const updated = await updateVersion(
        { versionId: version.id, spaceId, organizationId },
        request,
      );
      onUpdated?.(updated);
      handleOpenChange(false);
    } catch (error) {
      setErrorKey(getApiErrorMessageKey(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="edit-version-dialog">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
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
            <Label htmlFor="edit-version-name">{tCreate("fields.name")}</Label>
            <Input
              id="edit-version-name"
              data-testid="edit-version-name-input"
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
              placeholder={tCreate("placeholders.name")}
            />
            {nameError && (
              <span className="text-[11px] text-destructive" role="alert">
                {tCreate("fields.nameError")}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-version-target">
              {tCreate("fields.target")}
            </Label>
            <Textarea
              id="edit-version-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder={tCreate("placeholders.target")}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-version-description">
              {tCreate("fields.description")}
            </Label>
            <Textarea
              id="edit-version-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder={tCreate("placeholders.description")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-version-owner">
                {tCreate("fields.owner")}
              </Label>
              <select
                id="edit-version-owner"
                data-testid="edit-version-owner-select"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{tCreate("placeholders.owner")}</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name || member.user.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-version-status">
                {tCreate("fields.status")}
              </Label>
              <select
                id="edit-version-status"
                data-testid="edit-version-status-select"
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
              <Label htmlFor="edit-version-start-date">
                {tCreate("fields.startDate")}
              </Label>
              <Input
                id="edit-version-start-date"
                data-testid="edit-version-start-date-input"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-version-target-date">
                {tCreate("fields.targetDate")}
              </Label>
              <Input
                id="edit-version-target-date"
                data-testid="edit-version-target-date-input"
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-version-release-date">
                {tCreate("fields.releaseDate")}
              </Label>
              <Input
                id="edit-version-release-date"
                data-testid="edit-version-release-date-input"
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
              data-testid="edit-version-cancel"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="edit-version-submit"
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
