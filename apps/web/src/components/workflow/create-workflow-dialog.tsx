"use client";

import type {
  WorkflowDefinition,
  WorkflowVersion,
} from "@project-delivery/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";

import { getApiErrorMessageKey } from "../../lib/api-error-messages";
import {
  createWorkflow,
  createWorkflowVersion,
  listWorkflowVersions,
  updateWorkflow,
} from "../../lib/workflow-service";

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

type WorkflowSpaceContext = {
  organizationId?: string;
  spaceId: string;
};

type Mode =
  | { kind: "create" }
  | { kind: "edit"; workflow: WorkflowDefinition }
  | { kind: "copyVersion"; workflow: WorkflowDefinition };

export type CreateWorkflowDialogProps = {
  context: WorkflowSpaceContext;
  mode: Mode;
  onClose: () => void;
  onSuccess: (workflow: WorkflowDefinition) => void;
  open: boolean;
};

export function CreateWorkflowDialog({
  context,
  mode,
  onClose,
  onSuccess,
  open,
}: CreateWorkflowDialogProps) {
  const t = useTranslations("workflow.dialog");
  const tRoot = useTranslations();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [sourceVersionId, setSourceVersionId] = useState<string>("");
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setErrorKey(null);
    setIsSubmitting(false);

    if (mode.kind === "edit") {
      setName(mode.workflow.name);
      setCode(mode.workflow.code);
      setDescription(mode.workflow.description ?? "");
    } else {
      setName("");
      setCode("");
      setDescription("");
    }

    if (mode.kind === "copyVersion") {
      setIsLoadingVersions(true);
      setVersions([]);
      setSourceVersionId("");
      void listWorkflowVersions({
        organizationId: context.organizationId,
        page: 1,
        pageSize: 50,
        spaceId: context.spaceId,
        workflowId: mode.workflow.id,
      })
        .then((page) => {
          const publishedVersions = page.items.filter(
            (version) => version.status === "PUBLISHED",
          );
          const latestPublishedVersion = [...publishedVersions].sort(
            (a, b) => b.version - a.version,
          )[0];
          setVersions(publishedVersions);
          setSourceVersionId(latestPublishedVersion?.id ?? "");
        })
        .catch((error) => {
          setErrorKey(getApiErrorMessageKey(error));
        })
        .finally(() => {
          setIsLoadingVersions(false);
        });
    }
  }, [context.organizationId, context.spaceId, mode, open]);

  const isEdit = mode.kind === "edit";
  const isCopyVersion = mode.kind === "copyVersion";
  const titleKey = isCopyVersion
    ? "copyVersion.title"
    : isEdit
      ? "configure.title"
      : "create.title";
  const descriptionKey = isCopyVersion
    ? "copyVersion.description"
    : isEdit
      ? "configure.description"
      : "create.description";

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    setErrorKey(null);

    try {
      if (mode.kind === "copyVersion") {
        if (!sourceVersionId) {
          setErrorKey("errors.api.WORKFLOW_VERSION_NOT_FOUND");
          setIsSubmitting(false);
          return;
        }
        await createWorkflowVersion(
          {
            organizationId: context.organizationId,
            spaceId: context.spaceId,
            workflowId: mode.workflow.id,
          },
          { sourceWorkflowVersionId: sourceVersionId },
        );
        onSuccess(mode.workflow);
        return;
      }

      const trimmedName = name.trim();
      const trimmedCode = code.trim();
      const trimmedDescription = description.trim();

      let result: WorkflowDefinition;

      if (mode.kind === "edit") {
        result = await updateWorkflow(
          {
            organizationId: context.organizationId,
            spaceId: context.spaceId,
            workflowId: mode.workflow.id,
          },
          {
            name: trimmedName,
            description:
              trimmedDescription.length > 0 ? trimmedDescription : undefined,
          },
        );
      } else {
        const finalCode =
          trimmedCode.length > 0
            ? trimmedCode
            : trimmedName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");

        result = await createWorkflow(
          {
            organizationId: context.organizationId,
            spaceId: context.spaceId,
          },
          {
            name: trimmedName,
            code: finalCode,
            description:
              trimmedDescription.length > 0 ? trimmedDescription : undefined,
          },
        );
      }

      onSuccess(result);
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
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>{t(descriptionKey)}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
          {isCopyVersion ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-dialog-source-version">
                {t("copyVersion.fields.sourceVersion")}
              </Label>
              <select
                aria-label={t("copyVersion.fields.sourceVersion")}
                className="rounded-md border border-input bg-background px-3 py-2 text-xs"
                disabled={isLoadingVersions}
                id="workflow-dialog-source-version"
                onChange={(event) => setSourceVersionId(event.target.value)}
                value={sourceVersionId}
              >
                <option value="" disabled>
                  {t("copyVersion.fields.sourceVersion")}
                </option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {t("copyVersion.fields.versionOption", {
                      version: version.version,
                      status: version.status,
                    })}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                {t("copyVersion.fields.hint")}
              </p>
            </div>
          ) : null}

          {!isCopyVersion ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-dialog-name">
                {t(isEdit ? "configure.fields.name" : "create.fields.name")}
              </Label>
              <Input
                autoFocus
                id="workflow-dialog-name"
                maxLength={120}
                minLength={1}
                onChange={(event) => setName(event.target.value)}
                placeholder={
                  isEdit ? undefined : t("create.fields.namePlaceholder")
                }
                required
                value={name}
              />
            </div>
          ) : null}

          {!isEdit && !isCopyVersion ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-dialog-code">
                {t("create.fields.code")}
              </Label>
              <Input
                id="workflow-dialog-code"
                maxLength={80}
                onChange={(event) => setCode(event.target.value)}
                pattern="[A-Za-z0-9_\\-]*"
                placeholder={t("create.fields.codePlaceholder")}
                value={code}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("create.fields.codeHint")}
              </p>
            </div>
          ) : null}

          {!isCopyVersion ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="workflow-dialog-description">
                {t(
                  isEdit
                    ? "configure.fields.description"
                    : "create.fields.description",
                )}
              </Label>
              <Textarea
                id="workflow-dialog-description"
                maxLength={2000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={
                  isEdit ? undefined : t("create.fields.descriptionPlaceholder")
                }
                value={description}
              />
            </div>
          ) : null}

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
              {t(
                isCopyVersion
                  ? "copyVersion.cancel"
                  : isEdit
                    ? "configure.cancel"
                    : "create.cancel",
              )}
            </Button>
            <Button
              className="text-xs"
              disabled={
                isSubmitting ||
                (isCopyVersion
                  ? isLoadingVersions || !sourceVersionId
                  : name.trim().length === 0)
              }
              size="sm"
              type="submit"
            >
              {isSubmitting
                ? t(
                    isCopyVersion
                      ? "copyVersion.submitting"
                      : isEdit
                        ? "configure.submitting"
                        : "create.submitting",
                  )
                : t(
                    isCopyVersion
                      ? "copyVersion.submit"
                      : isEdit
                        ? "configure.submit"
                        : "create.submit",
                  )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
